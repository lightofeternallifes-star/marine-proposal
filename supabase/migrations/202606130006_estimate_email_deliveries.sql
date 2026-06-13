begin;

create type public.estimate_delivery_status as enum ('queued', 'sent', 'failed');

create table public.estimate_deliveries (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  document_id uuid not null references public.estimate_documents(id) on delete restrict,
  recipient_email text not null check (
    recipient_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  status public.estimate_delivery_status not null default 'queued',
  provider text not null default 'resend',
  provider_message_id text,
  error_message text,
  requested_by uuid not null references public.profiles(id),
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimate_deliveries_status_fields check (
    (status = 'queued' and sent_at is null and failed_at is null)
    or (status = 'sent' and sent_at is not null and failed_at is null)
    or (status = 'failed' and sent_at is null and failed_at is not null)
  )
);

create index estimate_deliveries_estimate_id_idx
on public.estimate_deliveries (estimate_id, created_at desc);

create index estimate_deliveries_status_idx
on public.estimate_deliveries (status, queued_at);

create trigger estimate_deliveries_set_updated_at
before update on public.estimate_deliveries
for each row execute function public.set_updated_at();

alter table public.estimate_deliveries enable row level security;
revoke all on public.estimate_deliveries from anon;
grant select, insert, update on public.estimate_deliveries to authenticated;
grant select, insert, update, delete on public.estimate_deliveries to service_role;

create policy "active users can read estimate deliveries"
on public.estimate_deliveries
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can queue estimate deliveries"
on public.estimate_deliveries
for insert
to authenticated
with check (
  (select public.is_active_user())
  and requested_by = (select auth.uid())
  and status = 'queued'
);

create policy "requesting users can update estimate deliveries"
on public.estimate_deliveries
for update
to authenticated
using (
  (select public.is_active_user())
  and requested_by = (select auth.uid())
)
with check (
  (select public.is_active_user())
  and requested_by = (select auth.uid())
);

commit;
