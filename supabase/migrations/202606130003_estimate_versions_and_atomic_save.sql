begin;

create table public.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (estimate_id, version_number),
  constraint estimate_versions_snapshot_object
    check (jsonb_typeof(snapshot) = 'object')
);

create index estimate_versions_estimate_id_idx
on public.estimate_versions (estimate_id, version_number desc);

alter table public.estimate_versions enable row level security;
revoke all on public.estimate_versions from anon;
grant select, insert on public.estimate_versions to authenticated;

create policy "active users can read estimate versions"
on public.estimate_versions
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create estimate versions"
on public.estimate_versions
for insert
to authenticated
with check (
  (select public.is_active_user())
  and created_by = (select auth.uid())
);

create or replace function public.save_estimate(
  p_estimate_id uuid,
  p_customer_id uuid,
  p_vessel_id uuid,
  p_job_description text,
  p_recommended_work text,
  p_customer_notes text,
  p_internal_notes text,
  p_discount_cents bigint,
  p_tax_rate numeric,
  p_validity_days integer,
  p_materials jsonb,
  p_labor jsonb
)
returns public.estimates
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid;
  saved_estimate public.estimates;
  next_version integer;
  snapshot_data jsonb;
begin
  actor_id := auth.uid();
  if actor_id is null or not public.is_active_user() then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(p_materials) <> 'array' or jsonb_typeof(p_labor) <> 'array' then
    raise exception 'Materials and labor must be arrays';
  end if;

  if p_estimate_id is null then
    insert into public.estimates (
      estimate_number,
      customer_id,
      vessel_id,
      status,
      job_description,
      recommended_work,
      customer_notes,
      internal_notes,
      discount_cents,
      tax_rate,
      validity_days,
      created_by,
      updated_by
    )
    values (
      null,
      p_customer_id,
      p_vessel_id,
      'draft',
      nullif(trim(p_job_description), ''),
      nullif(trim(p_recommended_work), ''),
      nullif(trim(p_customer_notes), ''),
      nullif(trim(p_internal_notes), ''),
      greatest(p_discount_cents, 0),
      p_tax_rate,
      p_validity_days,
      actor_id,
      actor_id
    )
    returning * into saved_estimate;
  else
    update public.estimates
    set
      customer_id = p_customer_id,
      vessel_id = p_vessel_id,
      status = 'draft',
      job_description = nullif(trim(p_job_description), ''),
      recommended_work = nullif(trim(p_recommended_work), ''),
      customer_notes = nullif(trim(p_customer_notes), ''),
      internal_notes = nullif(trim(p_internal_notes), ''),
      discount_cents = greatest(p_discount_cents, 0),
      tax_rate = p_tax_rate,
      validity_days = p_validity_days,
      generated_at = null,
      updated_by = actor_id
    where id = p_estimate_id
    returning * into saved_estimate;

    if saved_estimate.id is null then
      raise exception 'Estimate not found';
    end if;
  end if;

  delete from public.estimate_materials where estimate_id = saved_estimate.id;
  delete from public.estimate_labor where estimate_id = saved_estimate.id;

  insert into public.estimate_materials (
    estimate_id,
    description,
    quantity,
    unit,
    unit_price_cents,
    markup_percent,
    sort_order
  )
  select
    saved_estimate.id,
    trim(item.description),
    item.quantity,
    trim(item.unit),
    item.unit_price_cents,
    item.markup_percent,
    item.sort_order
  from jsonb_to_recordset(p_materials) as item(
    description text,
    quantity numeric,
    unit text,
    unit_price_cents bigint,
    markup_percent numeric,
    sort_order integer
  );

  insert into public.estimate_labor (
    estimate_id,
    description,
    hours,
    hourly_rate_cents,
    sort_order
  )
  select
    saved_estimate.id,
    trim(item.description),
    item.hours,
    item.hourly_rate_cents,
    item.sort_order
  from jsonb_to_recordset(p_labor) as item(
    description text,
    hours numeric,
    hourly_rate_cents bigint,
    sort_order integer
  );

  update public.estimates
  set
    current_version = current_version + 1,
    updated_by = actor_id
  where id = saved_estimate.id
  returning * into saved_estimate;

  next_version := saved_estimate.current_version;

  select jsonb_build_object(
    'estimate', to_jsonb(e),
    'materials', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.sort_order)
      from public.estimate_materials m
      where m.estimate_id = e.id
    ), '[]'::jsonb),
    'labor', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.sort_order)
      from public.estimate_labor l
      where l.estimate_id = e.id
    ), '[]'::jsonb)
  )
  into snapshot_data
  from public.estimates e
  where e.id = saved_estimate.id;

  insert into public.estimate_versions (
    estimate_id,
    version_number,
    snapshot,
    created_by
  )
  values (
    saved_estimate.id,
    next_version,
    snapshot_data,
    actor_id
  );

  return saved_estimate;
end;
$$;

revoke all on function public.save_estimate(
  uuid, uuid, uuid, text, text, text, text, bigint, numeric, integer, jsonb, jsonb
) from public;

grant execute on function public.save_estimate(
  uuid, uuid, uuid, text, text, text, text, bigint, numeric, integer, jsonb, jsonb
) to authenticated;

commit;
