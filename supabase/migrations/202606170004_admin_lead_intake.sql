begin;

create table public.lead_intake (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  phone text check (phone is null or char_length(trim(phone)) between 7 and 40),
  email text check (
    email is null
    or (
      email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
      and char_length(trim(email)) <= 254
    )
  ),
  vessel_name text check (
    vessel_name is null or char_length(trim(vessel_name)) between 1 and 160
  ),
  manufacturer text check (
    manufacturer is null or char_length(trim(manufacturer)) between 2 and 120
  ),
  model text check (
    model is null or char_length(trim(model)) between 1 and 120
  ),
  length numeric(7, 2) check (length is null or length > 0),
  marina text check (
    marina is null or char_length(trim(marina)) between 2 and 160
  ),
  city text check (
    city is null or char_length(trim(city)) between 2 and 120
  ),
  country text check (
    country is null or char_length(trim(country)) between 2 and 120
  ),
  service_type text not null check (char_length(trim(service_type)) between 2 and 120),
  description text not null check (char_length(trim(description)) between 5 and 3000),
  status text not null default 'Lead' check (
    status in ('Lead', 'Qualified', 'Appointment Requested', 'Converted', 'Lost', 'Archived')
  ),
  customer_id uuid references public.customers(id) on delete set null,
  vessel_id uuid references public.vessels(id) on delete set null,
  pipeline_id uuid references public.sales_pipeline(id) on delete set null
);

create index lead_intake_created_at_idx on public.lead_intake (created_at desc);
create index lead_intake_status_created_idx on public.lead_intake (status, created_at desc);
create index lead_intake_email_idx on public.lead_intake (lower(email));
create index lead_intake_phone_idx on public.lead_intake (phone);
create index lead_intake_pipeline_id_idx on public.lead_intake (pipeline_id);

create trigger lead_intake_set_updated_at
before update on public.lead_intake
for each row execute function public.set_updated_at();

create or replace function public.sync_admin_lead_intake_to_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  target_customer_id uuid;
  target_vessel_id uuid;
  target_pipeline_id uuid;
  vessel_location text;
begin
  select coalesce(
    (select auth.uid()),
    (
      select id
      from public.profiles
      where active = true
      order by case when role = 'admin'::public.app_role then 0 else 1 end, created_at
      limit 1
    )
  ) into actor_id;

  if actor_id is null then
    raise exception 'No active MarineQuote user available for lead assignment';
  end if;

  if new.email is not null then
    select id into target_customer_id
    from public.customers
    where archived_at is null
      and lower(email) = lower(new.email)
    order by updated_at desc
    limit 1;
  end if;

  if target_customer_id is null and new.phone is not null then
    select id into target_customer_id
    from public.customers
    where archived_at is null
      and phone = new.phone
    order by updated_at desc
    limit 1;
  end if;

  if target_customer_id is null then
    insert into public.customers (
      contact_name,
      email,
      phone,
      billing_address,
      notes,
      created_by,
      updated_by
    )
    values (
      new.full_name,
      new.email,
      new.phone,
      jsonb_build_object(
        'city', new.city,
        'country', new.country,
        'marina', new.marina
      ),
      'Created from admin Lead Intake. Service: ' || new.service_type,
      actor_id,
      actor_id
    )
    returning id into target_customer_id;
  end if;

  vessel_location := array_to_string(array_remove(array[new.marina, new.city, new.country], null), ', ');

  if new.vessel_name is not null or (new.manufacturer is not null and new.model is not null) then
    select id into target_vessel_id
    from public.vessels
    where customer_id = target_customer_id
      and archived_at is null
      and (
        (new.vessel_name is not null and lower(coalesce(vessel_name, '')) = lower(new.vessel_name))
        or (
          new.manufacturer is not null
          and new.model is not null
          and lower(coalesce(manufacturer, '')) = lower(new.manufacturer)
          and lower(coalesce(model, '')) = lower(new.model)
        )
      )
    order by updated_at desc
    limit 1;

    if target_vessel_id is null then
      insert into public.vessels (
        customer_id,
        vessel_name,
        vessel_type,
        manufacturer,
        model,
        length_feet,
        location,
        notes,
        created_by,
        updated_by
      )
      values (
        target_customer_id,
        new.vessel_name,
        null,
        new.manufacturer,
        new.model,
        new.length,
        nullif(vessel_location, ''),
        'Created from admin Lead Intake.',
        actor_id,
        actor_id
      )
      returning id into target_vessel_id;
    end if;
  end if;

  insert into public.sales_pipeline (
    customer_id,
    vessel_id,
    stage,
    source,
    assigned_to,
    notes
  )
  values (
    target_customer_id,
    target_vessel_id,
    'lead'::public.sales_pipeline_stage,
    'admin_lead_intake',
    actor_id,
    'Lead Intake: ' || new.service_type || E'\n' || new.description
  )
  returning id into target_pipeline_id;

  update public.lead_intake
  set
    customer_id = target_customer_id,
    vessel_id = target_vessel_id,
    pipeline_id = target_pipeline_id
  where id = new.id;

  return new;
end;
$$;

create trigger lead_intake_sync_to_pipeline
after insert on public.lead_intake
for each row execute function public.sync_admin_lead_intake_to_pipeline();

alter table public.lead_intake enable row level security;

revoke all on public.lead_intake from anon;
grant select, insert, update, delete on public.lead_intake to authenticated;
grant select, insert, update, delete on public.lead_intake to service_role;

create policy "active users can read lead intake"
on public.lead_intake
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create lead intake"
on public.lead_intake
for insert
to authenticated
with check ((select public.is_active_user()));

create policy "active users can update lead intake"
on public.lead_intake
for update
to authenticated
using ((select public.is_active_user()))
with check ((select public.is_active_user()));

create policy "admins can delete lead intake"
on public.lead_intake
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

alter publication supabase_realtime add table public.lead_intake;

commit;
