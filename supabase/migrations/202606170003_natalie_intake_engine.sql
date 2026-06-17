begin;

alter table public.conversations
add column intake_stage text not null default 'NEW_LEAD',
add column intake_data jsonb not null default '{}'::jsonb;

alter table public.conversations
add constraint conversations_intake_stage_allowed check (
  intake_stage in (
    'NEW_LEAD',
    'LOCATION',
    'VESSEL_INFO',
    'PROBLEM_DESCRIPTION',
    'QUALIFIED',
    'APPOINTMENT_REQUESTED',
    'COMPLETED'
  )
);

alter table public.conversations
add constraint conversations_intake_data_object
check (jsonb_typeof(intake_data) = 'object');

alter table public.appointments
add column customer_name text,
add column vessel_type text,
add column manufacturer text,
add column model text,
add column problem_description text,
add column preferred_inspection_window text;

alter table public.appointments
add constraint appointments_customer_name_length check (
  customer_name is null
  or char_length(trim(customer_name)) between 2 and 160
);

alter table public.appointments
add constraint appointments_vessel_type_length check (
  vessel_type is null
  or char_length(trim(vessel_type)) between 2 and 120
);

alter table public.appointments
add constraint appointments_manufacturer_length check (
  manufacturer is null
  or char_length(trim(manufacturer)) between 2 and 120
);

alter table public.appointments
add constraint appointments_model_length check (
  model is null
  or char_length(trim(model)) between 1 and 120
);

alter table public.appointments
add constraint appointments_problem_description_length check (
  problem_description is null
  or char_length(trim(problem_description)) between 5 and 3000
);

alter table public.appointments
add constraint appointments_preferred_window_length check (
  preferred_inspection_window is null
  or char_length(trim(preferred_inspection_window)) between 2 and 120
);

create index conversations_intake_stage_updated_idx
on public.conversations (intake_stage, updated_at desc);

create index appointments_preferred_window_idx
on public.appointments (preferred_inspection_window);

commit;
