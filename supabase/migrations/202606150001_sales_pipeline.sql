begin;

create type public.sales_pipeline_stage as enum (
  'lead',
  'qualified',
  'appointment_scheduled',
  'estimate_sent',
  'won',
  'lost'
);

create table public.sales_pipeline (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  vessel_id uuid references public.vessels(id) on delete set null,
  estimate_id uuid references public.estimates(id) on delete set null,
  stage public.sales_pipeline_stage not null default 'lead',
  source text not null default 'manual' check (char_length(trim(source)) between 2 and 120),
  assigned_to uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sales_pipeline_estimate_id_unique_idx
on public.sales_pipeline (estimate_id)
where estimate_id is not null;

create index sales_pipeline_stage_updated_idx
on public.sales_pipeline (stage, updated_at desc);

create index sales_pipeline_customer_id_idx
on public.sales_pipeline (customer_id);

create index sales_pipeline_vessel_id_idx
on public.sales_pipeline (vessel_id);

create index sales_pipeline_assigned_to_idx
on public.sales_pipeline (assigned_to);

create trigger sales_pipeline_set_updated_at
before update on public.sales_pipeline
for each row execute function public.set_updated_at();

create or replace function public.validate_sales_pipeline_relationships()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.vessel_id is not null and not exists (
    select 1
    from public.vessels
    where id = new.vessel_id
      and customer_id = new.customer_id
      and archived_at is null
  ) then
    raise exception 'Selected vessel does not belong to the selected customer';
  end if;

  if new.estimate_id is not null and not exists (
    select 1
    from public.estimates
    where id = new.estimate_id
      and customer_id = new.customer_id
      and (new.vessel_id is null or vessel_id = new.vessel_id)
  ) then
    raise exception 'Selected estimate does not belong to the selected customer and vessel';
  end if;

  return new;
end;
$$;

create trigger sales_pipeline_validate_relationships
before insert or update of customer_id, vessel_id, estimate_id
on public.sales_pipeline
for each row execute function public.validate_sales_pipeline_relationships();

create or replace function public.sync_pipeline_stage_from_sent_estimate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_pipeline_id uuid;
begin
  if new.status <> 'sent'::public.estimate_status then
    return new;
  end if;

  update public.sales_pipeline
  set
    customer_id = new.customer_id,
    vessel_id = new.vessel_id,
    estimate_id = new.id,
    stage = 'estimate_sent'::public.sales_pipeline_stage,
    source = coalesce(nullif(source, ''), 'estimate_email'),
    assigned_to = coalesce(assigned_to, new.updated_by, new.created_by)
  where id = (
    select id
    from public.sales_pipeline
    where estimate_id = new.id
       or (
         estimate_id is null
         and customer_id = new.customer_id
         and (vessel_id is null or vessel_id = new.vessel_id)
         and stage not in ('won'::public.sales_pipeline_stage, 'lost'::public.sales_pipeline_stage)
       )
    order by
      case when estimate_id = new.id then 0 else 1 end,
      updated_at desc
    limit 1
  )
  returning id into target_pipeline_id;

  if target_pipeline_id is null then
    insert into public.sales_pipeline (
      customer_id,
      vessel_id,
      estimate_id,
      stage,
      source,
      assigned_to,
      notes
    )
    values (
      new.customer_id,
      new.vessel_id,
      new.id,
      'estimate_sent'::public.sales_pipeline_stage,
      'estimate_email',
      coalesce(new.updated_by, new.created_by),
      'Automatically moved to Estimate Sent after quote email delivery.'
    )
    on conflict (estimate_id) do update
    set
      stage = 'estimate_sent'::public.sales_pipeline_stage,
      customer_id = excluded.customer_id,
      vessel_id = excluded.vessel_id,
      assigned_to = coalesce(public.sales_pipeline.assigned_to, excluded.assigned_to);
  end if;

  return new;
end;
$$;

create trigger estimates_sync_pipeline_on_sent
after update of status on public.estimates
for each row
when (new.status = 'sent'::public.estimate_status)
execute function public.sync_pipeline_stage_from_sent_estimate();

alter table public.sales_pipeline enable row level security;
revoke all on public.sales_pipeline from anon;
grant select, insert, update, delete on public.sales_pipeline to authenticated;
grant select, insert, update, delete on public.sales_pipeline to service_role;

create policy "active users can read sales pipeline"
on public.sales_pipeline
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create sales pipeline"
on public.sales_pipeline
for insert
to authenticated
with check ((select public.is_active_user()));

create policy "active users can update sales pipeline"
on public.sales_pipeline
for update
to authenticated
using ((select public.is_active_user()))
with check ((select public.is_active_user()));

create policy "admins can delete sales pipeline"
on public.sales_pipeline
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active = true
      and role = 'admin'
  )
);

alter publication supabase_realtime add table public.sales_pipeline;

commit;
