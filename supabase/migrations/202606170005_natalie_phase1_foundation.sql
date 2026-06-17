begin;

create table public.natalie_conversations (
  id uuid primary key default gen_random_uuid(),
  lead_intake_id uuid references public.lead_intake(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  vessel_id uuid references public.vessels(id) on delete set null,
  pipeline_id uuid references public.sales_pipeline(id) on delete set null,
  status text not null default 'active' check (
    status in ('active', 'waiting_on_customer', 'qualified', 'appointment_requested', 'completed', 'archived')
  ),
  current_stage text not null default 'Lead' check (
    current_stage in ('Lead', 'Qualified', 'Appointment Scheduled', 'Completed', 'Archived')
  ),
  assigned_to uuid references public.profiles(id) on delete set null,
  intake_summary jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  qualified_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint natalie_conversations_summary_object
    check (jsonb_typeof(intake_summary) = 'object')
);

create table public.natalie_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.natalie_conversations(id) on delete cascade,
  lead_intake_id uuid references public.lead_intake(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_type text not null check (sender_type in ('customer', 'natalie', 'staff', 'system')),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint natalie_messages_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create table public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.natalie_conversations(id) on delete set null,
  lead_intake_id uuid references public.lead_intake(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  vessel_id uuid references public.vessels(id) on delete set null,
  pipeline_id uuid references public.sales_pipeline(id) on delete set null,
  location_type text check (
    location_type is null or location_type in ('marina', 'private_residence', 'boatyard', 'other')
  ),
  requested_window text check (
    requested_window is null or char_length(trim(requested_window)) between 2 and 120
  ),
  requested_date date,
  requested_time time,
  marina text check (marina is null or char_length(trim(marina)) between 2 and 160),
  city text check (city is null or char_length(trim(city)) between 2 and 120),
  state_province text check (state_province is null or char_length(trim(state_province)) between 2 and 120),
  country text check (country is null or char_length(trim(country)) between 2 and 120),
  status text not null default 'requested' check (
    status in ('requested', 'confirmed', 'reschedule_requested', 'completed', 'cancelled')
  ),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index natalie_conversations_status_updated_idx
on public.natalie_conversations (status, updated_at desc);

create index natalie_conversations_customer_id_idx
on public.natalie_conversations (customer_id);

create index natalie_conversations_pipeline_id_idx
on public.natalie_conversations (pipeline_id);

create index natalie_conversations_lead_intake_id_idx
on public.natalie_conversations (lead_intake_id);

create index natalie_messages_conversation_created_idx
on public.natalie_messages (conversation_id, created_at desc);

create index natalie_messages_customer_created_idx
on public.natalie_messages (customer_id, created_at desc);

create index appointment_requests_conversation_id_idx
on public.appointment_requests (conversation_id);

create index appointment_requests_customer_id_idx
on public.appointment_requests (customer_id);

create index appointment_requests_status_created_idx
on public.appointment_requests (status, created_at desc);

create trigger natalie_conversations_set_updated_at
before update on public.natalie_conversations
for each row execute function public.set_updated_at();

create trigger appointment_requests_set_updated_at
before update on public.appointment_requests
for each row execute function public.set_updated_at();

create or replace function public.sync_natalie_conversation_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.natalie_conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger natalie_messages_sync_conversation_last_message
after insert on public.natalie_messages
for each row execute function public.sync_natalie_conversation_last_message_at();

create or replace function public.sync_natalie_pipeline_progression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pipeline_id is not null and new.status = 'qualified' then
    update public.sales_pipeline
    set stage = 'qualified'::public.sales_pipeline_stage
    where id = new.pipeline_id
      and stage = 'lead'::public.sales_pipeline_stage;
  end if;

  return new;
end;
$$;

create trigger natalie_conversations_sync_pipeline_progression
after insert or update of status on public.natalie_conversations
for each row execute function public.sync_natalie_pipeline_progression();

create or replace function public.sync_appointment_request_pipeline_progression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pipeline_id is not null and new.status = 'confirmed' then
    update public.sales_pipeline
    set stage = 'appointment_scheduled'::public.sales_pipeline_stage
    where id = new.pipeline_id
      and stage in ('lead'::public.sales_pipeline_stage, 'qualified'::public.sales_pipeline_stage);
  end if;

  return new;
end;
$$;

create trigger appointment_requests_sync_pipeline_progression
after insert or update of status on public.appointment_requests
for each row execute function public.sync_appointment_request_pipeline_progression();

create or replace function public.create_natalie_conversation_for_lead_intake(target_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead_record public.lead_intake%rowtype;
  conversation_id uuid;
  actor_id uuid;
begin
  select * into lead_record
  from public.lead_intake
  where id = target_lead_id;

  if lead_record.id is null then
    raise exception 'Lead intake record not found';
  end if;

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

  select id into conversation_id
  from public.natalie_conversations
  where lead_intake_id = lead_record.id
  order by created_at desc
  limit 1;

  if conversation_id is not null then
    return conversation_id;
  end if;

  insert into public.natalie_conversations (
    lead_intake_id,
    customer_id,
    vessel_id,
    pipeline_id,
    status,
    current_stage,
    assigned_to,
    intake_summary
  )
  values (
    lead_record.id,
    lead_record.customer_id,
    lead_record.vessel_id,
    lead_record.pipeline_id,
    'active',
    'Lead',
    actor_id,
    jsonb_build_object(
      'full_name', lead_record.full_name,
      'phone', lead_record.phone,
      'email', lead_record.email,
      'vessel_name', lead_record.vessel_name,
      'manufacturer', lead_record.manufacturer,
      'model', lead_record.model,
      'marina', lead_record.marina,
      'city', lead_record.city,
      'country', lead_record.country,
      'service_type', lead_record.service_type,
      'description', lead_record.description
    )
  )
  returning id into conversation_id;

  insert into public.natalie_messages (
    conversation_id,
    lead_intake_id,
    customer_id,
    direction,
    sender_type,
    body,
    metadata
  )
  values (
    conversation_id,
    lead_record.id,
    lead_record.customer_id,
    'outbound',
    'natalie',
    'Natalie conversation opened for this new lead. Waiting for customer qualification.',
    jsonb_build_object('event', 'conversation_created_from_lead_intake')
  );

  return conversation_id;
end;
$$;

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
  target_conversation_id uuid;
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

  select public.create_natalie_conversation_for_lead_intake(new.id)
  into target_conversation_id;

  return new;
end;
$$;

do $$
declare
  existing_lead record;
begin
  for existing_lead in
    select li.id
    from public.lead_intake li
    where li.pipeline_id is not null
      and not exists (
        select 1
        from public.natalie_conversations nc
        where nc.lead_intake_id = li.id
      )
  loop
    perform public.create_natalie_conversation_for_lead_intake(existing_lead.id);
  end loop;
end $$;

alter table public.natalie_conversations enable row level security;
alter table public.natalie_messages enable row level security;
alter table public.appointment_requests enable row level security;

revoke all on public.natalie_conversations from anon;
revoke all on public.natalie_messages from anon;
revoke all on public.appointment_requests from anon;

grant select, insert, update, delete on public.natalie_conversations to authenticated;
grant select, insert, update, delete on public.natalie_messages to authenticated;
grant select, insert, update, delete on public.appointment_requests to authenticated;

grant select, insert, update, delete on public.natalie_conversations to service_role;
grant select, insert, update, delete on public.natalie_messages to service_role;
grant select, insert, update, delete on public.appointment_requests to service_role;

create policy "active users can read natalie conversations"
on public.natalie_conversations
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create natalie conversations"
on public.natalie_conversations
for insert
to authenticated
with check ((select public.is_active_user()));

create policy "active users can update natalie conversations"
on public.natalie_conversations
for update
to authenticated
using ((select public.is_active_user()))
with check ((select public.is_active_user()));

create policy "admins can delete natalie conversations"
on public.natalie_conversations
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

create policy "active users can read natalie messages"
on public.natalie_messages
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create natalie messages"
on public.natalie_messages
for insert
to authenticated
with check ((select public.is_active_user()));

create policy "active users can update natalie messages"
on public.natalie_messages
for update
to authenticated
using ((select public.is_active_user()))
with check ((select public.is_active_user()));

create policy "admins can delete natalie messages"
on public.natalie_messages
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

create policy "active users can read appointment requests"
on public.appointment_requests
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create appointment requests"
on public.appointment_requests
for insert
to authenticated
with check ((select public.is_active_user()));

create policy "active users can update appointment requests"
on public.appointment_requests
for update
to authenticated
using ((select public.is_active_user()))
with check ((select public.is_active_user()));

create policy "admins can delete appointment requests"
on public.appointment_requests
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

alter publication supabase_realtime add table public.natalie_conversations;
alter publication supabase_realtime add table public.natalie_messages;
alter publication supabase_realtime add table public.appointment_requests;

commit;
