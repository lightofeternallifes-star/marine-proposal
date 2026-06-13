begin;

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'estimator');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  role public.app_role not null default 'estimator',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_name text check (
    company_name is null or char_length(trim(company_name)) between 2 and 160
  ),
  contact_name text not null check (char_length(trim(contact_name)) between 2 and 160),
  email text check (
    email is null or email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  phone text check (phone is null or char_length(trim(phone)) between 7 and 40),
  billing_address jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint customers_billing_address_object
    check (jsonb_typeof(billing_address) = 'object')
);

create table public.vessels (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  vessel_name text check (
    vessel_name is null or char_length(trim(vessel_name)) between 1 and 160
  ),
  vessel_type text check (
    vessel_type is null or char_length(trim(vessel_type)) between 2 and 100
  ),
  manufacturer text check (
    manufacturer is null or char_length(trim(manufacturer)) between 2 and 120
  ),
  model text check (model is null or char_length(trim(model)) between 1 and 120),
  year integer check (year is null or year between 1900 and 2100),
  length_feet numeric(7, 2) check (length_feet is null or length_feet > 0),
  registration_number text check (
    registration_number is null
    or char_length(trim(registration_number)) between 2 and 80
  ),
  location text check (
    location is null or char_length(trim(location)) between 2 and 240
  ),
  notes text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint vessels_identifiable check (
    vessel_name is not null
    or registration_number is not null
    or (manufacturer is not null and model is not null)
  )
);

create index customers_contact_name_idx on public.customers (lower(contact_name));
create index customers_company_name_idx on public.customers (lower(company_name));
create index vessels_customer_id_idx on public.vessels (customer_id);
create index vessels_vessel_name_idx on public.vessels (lower(vessel_name));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

create trigger vessels_set_updated_at
before update on public.vessels
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    'estimator'::public.app_role
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active = true
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.vessels enable row level security;

revoke all on public.profiles from anon;
revoke all on public.customers from anon;
revoke all on public.vessels from anon;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.vessels to authenticated;

create policy "active users can read own profile"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()) and active = true);

create policy "active users can read customers"
on public.customers
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create customers"
on public.customers
for insert
to authenticated
with check (
  (select public.is_active_user())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

create policy "active users can update customers"
on public.customers
for update
to authenticated
using ((select public.is_active_user()))
with check (
  (select public.is_active_user())
  and updated_by = (select auth.uid())
);

create policy "admins can delete customers"
on public.customers
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

create policy "active users can read vessels"
on public.vessels
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create vessels"
on public.vessels
for insert
to authenticated
with check (
  (select public.is_active_user())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

create policy "active users can update vessels"
on public.vessels
for update
to authenticated
using ((select public.is_active_user()))
with check (
  (select public.is_active_user())
  and updated_by = (select auth.uid())
);

create policy "admins can delete vessels"
on public.vessels
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
