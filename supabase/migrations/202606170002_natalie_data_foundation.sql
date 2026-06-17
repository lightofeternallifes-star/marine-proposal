begin;

create type public.conversation_channel as enum (
  'whatsapp',
  'sms',
  'web',
  'email',
  'phone'
);

create type public.conversation_status as enum (
  'active',
  'waiting_on_customer',
  'qualified',
  'appointment_requested',
  'escalated',
  'closed',
  'archived'
);

create type public.qualification_state as enum (
  'started',
  'location_type_requested',
  'vessel_type_requested',
  'vessel_name_requested',
  'service_type_requested',
  'operability_requested',
  'location_details_requested',
  'appointment_requested',
  'complete'
);

create type public.message_direction as enum (
  'inbound',
  'outbound'
);

create type public.message_sender_type as enum (
  'customer',
  'natalie',
  'staff',
  'system'
);

create type public.message_delivery_status as enum (
  'queued',
  'sent',
  'delivered',
  'read',
  'failed'
);

create type public.appointment_status as enum (
  'requested',
  'confirmed',
  'reschedule_requested',
  'completed',
  'cancelled'
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  vessel_id uuid references public.vessels(id) on delete set null,
  pipeline_id uuid references public.sales_pipeline(id) on delete set null,
  channel public.conversation_channel not null default 'web',
  external_conversation_id text,
  external_contact_id text,
  status public.conversation_status not null default 'active',
  qualification_state public.qualification_state not null default 'started',
  current_question_key text,
  assigned_to uuid references public.profiles(id) on delete set null,
  qualification_summary jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_external_conversation_length check (
    external_conversation_id is null
    or char_length(trim(external_conversation_id)) between 2 and 240
  ),
  constraint conversations_external_contact_length check (
    external_contact_id is null
    or char_length(trim(external_contact_id)) between 2 and 240
  ),
  constraint conversations_current_question_length check (
    current_question_key is null
    or char_length(trim(current_question_key)) between 2 and 120
  ),
  constraint conversations_qualification_summary_object
    check (jsonb_typeof(qualification_summary) = 'object')
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  direction public.message_direction not null,
  sender_type public.message_sender_type not null,
  channel public.conversation_channel not null default 'web',
  external_message_id text,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  structured_payload jsonb not null default '{}'::jsonb,
  delivery_status public.message_delivery_status,
  error_message text,
  created_at timestamptz not null default now(),
  constraint messages_structured_payload_object
    check (jsonb_typeof(structured_payload) = 'object'),
  constraint messages_external_message_length check (
    external_message_id is null
    or char_length(trim(external_message_id)) between 2 and 240
  )
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  vessel_id uuid references public.vessels(id) on delete set null,
  pipeline_id uuid references public.sales_pipeline(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  requested_start_at timestamptz,
  requested_end_at timestamptz,
  requested_time_text text,
  timezone text,
  location_type text,
  marina_name text,
  city text,
  state_province text,
  country text,
  status public.appointment_status not null default 'requested',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_requested_window check (
    requested_end_at is null
    or requested_start_at is null
    or requested_end_at > requested_start_at
  ),
  constraint appointments_requested_time_length check (
    requested_time_text is null
    or char_length(trim(requested_time_text)) between 2 and 240
  ),
  constraint appointments_timezone_length check (
    timezone is null
    or char_length(trim(timezone)) between 2 and 80
  ),
  constraint appointments_location_type_length check (
    location_type is null
    or char_length(trim(location_type)) between 2 and 80
  ),
  constraint appointments_marina_name_length check (
    marina_name is null
    or char_length(trim(marina_name)) between 2 and 160
  ),
  constraint appointments_city_length check (
    city is null
    or char_length(trim(city)) between 2 and 120
  ),
  constraint appointments_state_length check (
    state_province is null
    or char_length(trim(state_province)) between 2 and 120
  ),
  constraint appointments_country_length check (
    country is null
    or char_length(trim(country)) between 2 and 120
  )
);

create index conversations_lead_id_idx on public.conversations (lead_id);
create index conversations_customer_id_idx on public.conversations (customer_id);
create index conversations_vessel_id_idx on public.conversations (vessel_id);
create index conversations_pipeline_id_idx on public.conversations (pipeline_id);
create index conversations_status_updated_idx on public.conversations (status, updated_at desc);
create index conversations_channel_external_idx on public.conversations (channel, external_contact_id);
create index conversations_last_message_idx on public.conversations (last_message_at desc);
create index conversations_assigned_to_idx on public.conversations (assigned_to);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index messages_customer_created_idx on public.messages (customer_id, created_at desc);
create index messages_lead_created_idx on public.messages (lead_id, created_at desc);
create index messages_external_message_idx on public.messages (external_message_id);
create index messages_delivery_status_idx on public.messages (delivery_status);

create index appointments_customer_id_idx on public.appointments (customer_id);
create index appointments_vessel_id_idx on public.appointments (vessel_id);
create index appointments_pipeline_id_idx on public.appointments (pipeline_id);
create index appointments_conversation_id_idx on public.appointments (conversation_id);
create index appointments_status_start_idx on public.appointments (status, requested_start_at);
create index appointments_created_idx on public.appointments (created_at desc);

create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function public.set_updated_at();

create or replace function public.sync_conversation_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_sync_conversation_last_message
after insert on public.messages
for each row execute function public.sync_conversation_last_message_at();

create or replace function public.validate_natalie_relationships()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.vessel_id is not null and new.customer_id is not null and not exists (
    select 1
    from public.vessels
    where id = new.vessel_id
      and customer_id = new.customer_id
      and archived_at is null
  ) then
    raise exception 'Selected vessel does not belong to the selected customer';
  end if;

  if new.pipeline_id is not null and new.customer_id is not null and not exists (
    select 1
    from public.sales_pipeline
    where id = new.pipeline_id
      and customer_id = new.customer_id
      and (new.vessel_id is null or vessel_id is null or vessel_id = new.vessel_id)
  ) then
    raise exception 'Selected pipeline record does not belong to the selected customer and vessel';
  end if;

  if new.lead_id is not null and new.customer_id is not null and not exists (
    select 1
    from public.leads
    where id = new.lead_id
      and (customer_id is null or customer_id = new.customer_id)
  ) then
    raise exception 'Selected lead does not belong to the selected customer';
  end if;

  return new;
end;
$$;

create trigger conversations_validate_relationships
before insert or update of lead_id, customer_id, vessel_id, pipeline_id
on public.conversations
for each row execute function public.validate_natalie_relationships();

create trigger appointments_validate_relationships
before insert or update of lead_id, customer_id, vessel_id, pipeline_id
on public.appointments
for each row execute function public.validate_natalie_relationships();

create or replace function public.validate_message_relationships()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  conversation_record record;
begin
  select lead_id, customer_id, channel
  into conversation_record
  from public.conversations
  where id = new.conversation_id;

  if not found then
    raise exception 'Conversation not found';
  end if;

  if new.lead_id is not null and conversation_record.lead_id is not null and new.lead_id <> conversation_record.lead_id then
    raise exception 'Message lead does not match conversation lead';
  end if;

  if new.customer_id is not null and conversation_record.customer_id is not null and new.customer_id <> conversation_record.customer_id then
    raise exception 'Message customer does not match conversation customer';
  end if;

  if new.lead_id is null then
    new.lead_id = conversation_record.lead_id;
  end if;

  if new.customer_id is null then
    new.customer_id = conversation_record.customer_id;
  end if;

  if new.channel is null then
    new.channel = conversation_record.channel;
  end if;

  return new;
end;
$$;

create trigger messages_validate_relationships
before insert or update of conversation_id, lead_id, customer_id
on public.messages
for each row execute function public.validate_message_relationships();

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.appointments enable row level security;

revoke all on public.conversations from anon;
revoke all on public.messages from anon;
revoke all on public.appointments from anon;

grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;

grant select, insert, update, delete on public.conversations to service_role;
grant select, insert, update, delete on public.messages to service_role;
grant select, insert, update, delete on public.appointments to service_role;

create policy "active users can read conversations"
on public.conversations
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create conversations"
on public.conversations
for insert
to authenticated
with check ((select public.is_active_user()));

create policy "active users can update conversations"
on public.conversations
for update
to authenticated
using ((select public.is_active_user()))
with check ((select public.is_active_user()));

create policy "admins can delete conversations"
on public.conversations
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

create policy "active users can read messages"
on public.messages
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create messages"
on public.messages
for insert
to authenticated
with check ((select public.is_active_user()));

create policy "active users can update messages"
on public.messages
for update
to authenticated
using ((select public.is_active_user()))
with check ((select public.is_active_user()));

create policy "admins can delete messages"
on public.messages
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

create policy "active users can read appointments"
on public.appointments
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create appointments"
on public.appointments
for insert
to authenticated
with check ((select public.is_active_user()));

create policy "active users can update appointments"
on public.appointments
for update
to authenticated
using ((select public.is_active_user()))
with check ((select public.is_active_user()));

create policy "admins can delete appointments"
on public.appointments
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

alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.appointments;

commit;
