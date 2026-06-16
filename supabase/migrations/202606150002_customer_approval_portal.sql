begin;

alter type public.estimate_status add value if not exists 'approved';
alter type public.estimate_status add value if not exists 'rejected';
alter type public.sales_pipeline_stage add value if not exists 'approved';

commit;
begin;

create type public.estimate_approval_action as enum ('viewed', 'approved', 'rejected');

create table public.estimate_approval_tokens (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  document_id uuid not null references public.estimate_documents(id) on delete restrict,
  token_hash text not null unique check (char_length(token_hash) = 64),
  recipient_email text not null check (
    recipient_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint estimate_approval_tokens_lifecycle check (
    used_at is null or revoked_at is null
  )
);

create table public.estimate_approval_events (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  approval_token_id uuid references public.estimate_approval_tokens(id) on delete set null,
  action public.estimate_approval_action not null,
  recipient_email text not null check (
    recipient_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  customer_note text,
  user_agent text,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index estimate_approval_tokens_estimate_id_idx
on public.estimate_approval_tokens (estimate_id, created_at desc);

create index estimate_approval_tokens_active_idx
on public.estimate_approval_tokens (token_hash, expires_at)
where used_at is null and revoked_at is null;

create index estimate_approval_events_estimate_id_idx
on public.estimate_approval_events (estimate_id, created_at desc);

alter table public.estimate_approval_tokens enable row level security;
alter table public.estimate_approval_events enable row level security;

revoke all on public.estimate_approval_tokens from anon;
revoke all on public.estimate_approval_events from anon;

grant select on public.estimate_approval_tokens to authenticated;
grant select on public.estimate_approval_events to authenticated;
grant select, insert, update, delete on public.estimate_approval_tokens to service_role;
grant select, insert, update, delete on public.estimate_approval_events to service_role;

create policy "active users can read approval tokens"
on public.estimate_approval_tokens
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can read approval events"
on public.estimate_approval_events
for select
to authenticated
using ((select public.is_active_user()));

create or replace function public.sync_pipeline_stage_from_customer_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_stage public.sales_pipeline_stage;
  target_pipeline_id uuid;
begin
  if new.status = 'approved'::public.estimate_status then
    next_stage := 'approved'::public.sales_pipeline_stage;
  elsif new.status = 'rejected'::public.estimate_status then
    next_stage := 'lost'::public.sales_pipeline_stage;
  else
    return new;
  end if;

  update public.sales_pipeline
  set
    customer_id = new.customer_id,
    vessel_id = new.vessel_id,
    estimate_id = new.id,
    stage = next_stage,
    source = coalesce(nullif(source, ''), 'customer_approval_portal'),
    assigned_to = coalesce(assigned_to, new.updated_by, new.created_by)
  where id = (
    select id
    from public.sales_pipeline
    where estimate_id = new.id
       or (
         estimate_id is null
         and customer_id = new.customer_id
         and (vessel_id is null or vessel_id = new.vessel_id)
         and stage not in ('approved'::public.sales_pipeline_stage, 'lost'::public.sales_pipeline_stage)
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
      next_stage,
      'customer_approval_portal',
      coalesce(new.updated_by, new.created_by),
      case
        when next_stage = 'approved'::public.sales_pipeline_stage
          then 'Automatically moved to Approved after customer approval.'
        else 'Automatically moved to Lost after customer rejection.'
      end
    )
    on conflict (estimate_id) do update
    set
      stage = excluded.stage,
      customer_id = excluded.customer_id,
      vessel_id = excluded.vessel_id,
      assigned_to = coalesce(public.sales_pipeline.assigned_to, excluded.assigned_to);
  end if;

  return new;
end;
$$;

create trigger estimates_sync_pipeline_on_customer_decision
after update of status on public.estimates
for each row
when (
  new.status in ('approved'::public.estimate_status, 'rejected'::public.estimate_status)
)
execute function public.sync_pipeline_stage_from_customer_decision();

commit;
