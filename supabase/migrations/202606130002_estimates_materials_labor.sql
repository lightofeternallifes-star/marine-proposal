begin;

create type public.estimate_status as enum ('draft', 'generated', 'sent');

create sequence public.estimate_number_sequence;

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  vessel_id uuid not null references public.vessels(id) on delete restrict,
  status public.estimate_status not null default 'draft',
  job_description text,
  recommended_work text,
  customer_notes text,
  internal_notes text,
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  materials_subtotal_cents bigint not null default 0 check (materials_subtotal_cents >= 0),
  labor_subtotal_cents bigint not null default 0 check (labor_subtotal_cents >= 0),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_rate numeric(7, 4) not null default 0 check (tax_rate between 0 and 100),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  validity_days integer not null default 30 check (validity_days between 1 and 365),
  current_version integer not null default 0 check (current_version >= 0),
  generated_at timestamptz,
  sent_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.estimate_materials (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  description text not null check (char_length(trim(description)) between 2 and 240),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text not null default 'each' check (char_length(trim(unit)) between 1 and 40),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  markup_percent numeric(7, 4) not null default 0 check (markup_percent between 0 and 1000),
  line_total_cents bigint generated always as (
    round(quantity * unit_price_cents * (1 + markup_percent / 100))::bigint
  ) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.estimate_labor (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  description text not null check (char_length(trim(description)) between 2 and 240),
  hours numeric(10, 2) not null check (hours > 0),
  hourly_rate_cents bigint not null check (hourly_rate_cents >= 0),
  line_total_cents bigint generated always as (
    round(hours * hourly_rate_cents)::bigint
  ) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index estimates_customer_id_idx on public.estimates (customer_id);
create index estimates_vessel_id_idx on public.estimates (vessel_id);
create index estimates_status_updated_idx on public.estimates (status, updated_at desc);
create index estimate_materials_estimate_id_idx on public.estimate_materials (estimate_id);
create index estimate_labor_estimate_id_idx on public.estimate_labor (estimate_id);

create or replace function public.assign_estimate_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estimate_number is null or trim(new.estimate_number) = '' then
    new.estimate_number :=
      'MCE-' || to_char(current_date, 'YYYY') || '-'
      || lpad(nextval('public.estimate_number_sequence')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger estimates_assign_number
before insert on public.estimates
for each row execute function public.assign_estimate_number();

create or replace function public.validate_estimate_vessel_customer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.vessels
    where id = new.vessel_id
      and customer_id = new.customer_id
      and archived_at is null
  ) then
    raise exception 'Selected vessel does not belong to the selected customer';
  end if;
  return new;
end;
$$;

create trigger estimates_validate_vessel_customer
before insert or update of customer_id, vessel_id on public.estimates
for each row execute function public.validate_estimate_vessel_customer();

create or replace function public.calculate_estimate_totals()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  material_total bigint;
  labor_total bigint;
  taxable_total bigint;
begin
  select coalesce(sum(line_total_cents), 0)
  into material_total
  from public.estimate_materials
  where estimate_id = new.id;

  select coalesce(sum(line_total_cents), 0)
  into labor_total
  from public.estimate_labor
  where estimate_id = new.id;

  taxable_total := greatest(material_total + labor_total - new.discount_cents, 0);
  new.materials_subtotal_cents := material_total;
  new.labor_subtotal_cents := labor_total;
  new.subtotal_cents := material_total + labor_total;
  new.tax_cents := round(taxable_total * new.tax_rate / 100)::bigint;
  new.total_cents := taxable_total + new.tax_cents;
  return new;
end;
$$;

create trigger estimates_calculate_totals
before insert or update on public.estimates
for each row execute function public.calculate_estimate_totals();

create or replace function public.refresh_estimate_after_line_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_estimate_id uuid;
begin
  target_estimate_id := coalesce(new.estimate_id, old.estimate_id);
  update public.estimates
  set updated_at = now()
  where id = target_estimate_id;
  return coalesce(new, old);
end;
$$;

create trigger estimate_materials_refresh_total
after insert or update or delete on public.estimate_materials
for each row execute function public.refresh_estimate_after_line_change();

create trigger estimate_labor_refresh_total
after insert or update or delete on public.estimate_labor
for each row execute function public.refresh_estimate_after_line_change();

create trigger estimates_set_updated_at
before update on public.estimates
for each row execute function public.set_updated_at();

create trigger estimate_materials_set_updated_at
before update on public.estimate_materials
for each row execute function public.set_updated_at();

create trigger estimate_labor_set_updated_at
before update on public.estimate_labor
for each row execute function public.set_updated_at();

alter table public.estimates enable row level security;
alter table public.estimate_materials enable row level security;
alter table public.estimate_labor enable row level security;

revoke all on public.estimates from anon;
revoke all on public.estimate_materials from anon;
revoke all on public.estimate_labor from anon;
revoke all on sequence public.estimate_number_sequence from anon;

grant select, insert, update, delete on public.estimates to authenticated;
grant select, insert, update, delete on public.estimate_materials to authenticated;
grant select, insert, update, delete on public.estimate_labor to authenticated;

create policy "active users can read estimates"
on public.estimates
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create estimates"
on public.estimates
for insert
to authenticated
with check (
  (select public.is_active_user())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

create policy "active users can update estimates"
on public.estimates
for update
to authenticated
using ((select public.is_active_user()))
with check (
  (select public.is_active_user())
  and updated_by = (select auth.uid())
);

create policy "admins can delete estimates"
on public.estimates
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

create policy "active users can manage estimate materials"
on public.estimate_materials
for all
to authenticated
using (
  (select public.is_active_user())
  and exists (
    select 1 from public.estimates
    where estimates.id = estimate_materials.estimate_id
  )
)
with check (
  (select public.is_active_user())
  and exists (
    select 1 from public.estimates
    where estimates.id = estimate_materials.estimate_id
  )
);

create policy "active users can manage estimate labor"
on public.estimate_labor
for all
to authenticated
using (
  (select public.is_active_user())
  and exists (
    select 1 from public.estimates
    where estimates.id = estimate_labor.estimate_id
  )
)
with check (
  (select public.is_active_user())
  and exists (
    select 1 from public.estimates
    where estimates.id = estimate_labor.estimate_id
  )
);

commit;
