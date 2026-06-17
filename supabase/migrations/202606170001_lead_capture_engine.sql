begin;

create type public.lead_status as enum (
  'new',
  'converted',
  'spam',
  'archived'
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  phone text not null check (char_length(trim(phone)) between 7 and 40),
  email text not null check (
    email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    and char_length(trim(email)) <= 254
  ),
  vessel_name text check (
    vessel_name is null or char_length(trim(vessel_name)) between 1 and 160
  ),
  boat_type text check (
    boat_type is null or char_length(trim(boat_type)) between 2 and 100
  ),
  marina_name text check (
    marina_name is null or char_length(trim(marina_name)) between 2 and 160
  ),
  city text check (
    city is null or char_length(trim(city)) between 2 and 120
  ),
  service_type text not null check (
    service_type in (
      'electrical_issue',
      'electronics_issue',
      'generator',
      'battery_bank',
      'inverter',
      'shore_power',
      'corrosion',
      'navigation_system',
      'other'
    )
  ),
  problem_description text not null check (
    char_length(trim(problem_description)) between 10 and 3000
  ),
  priority text not null check (
    priority in ('emergency', 'within_24_hours', 'this_week', 'no_rush')
  ),
  source text not null default 'website_lead_form' check (
    char_length(trim(source)) between 2 and 120
  ),
  status public.lead_status not null default 'new',
  customer_id uuid references public.customers(id) on delete set null,
  vessel_id uuid references public.vessels(id) on delete set null,
  pipeline_id uuid references public.sales_pipeline(id) on delete set null,
  ip_address inet,
  user_agent text,
  honeypot_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_created_at_idx on public.leads (created_at desc);
create index leads_status_created_idx on public.leads (status, created_at desc);
create index leads_email_idx on public.leads (lower(email));
create index leads_phone_idx on public.leads (phone);
create index leads_customer_id_idx on public.leads (customer_id);
create index leads_pipeline_id_idx on public.leads (pipeline_id);
create index leads_ip_recent_idx on public.leads (ip_address, created_at desc);

create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

revoke all on public.leads from anon;
grant select, update on public.leads to authenticated;
grant select, insert, update, delete on public.leads to service_role;

create policy "active users can read leads"
on public.leads
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can update leads"
on public.leads
for update
to authenticated
using ((select public.is_active_user()))
with check ((select public.is_active_user()));

create policy "admins can delete leads"
on public.leads
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

commit;
