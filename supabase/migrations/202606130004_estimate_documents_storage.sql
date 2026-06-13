begin;

create table public.estimate_documents (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  storage_path text not null unique,
  generated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (estimate_id, version_number)
);

create index estimate_documents_estimate_id_idx
on public.estimate_documents (estimate_id, version_number desc);

alter table public.estimate_documents enable row level security;
revoke all on public.estimate_documents from anon;
grant select, insert, update on public.estimate_documents to authenticated;

create policy "active users can read estimate documents"
on public.estimate_documents
for select
to authenticated
using ((select public.is_active_user()));

create policy "active users can create estimate documents"
on public.estimate_documents
for insert
to authenticated
with check (
  (select public.is_active_user())
  and generated_by = (select auth.uid())
);

create policy "active users can update estimate documents"
on public.estimate_documents
for update
to authenticated
using ((select public.is_active_user()))
with check (
  (select public.is_active_user())
  and generated_by = (select auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'estimate-pdfs',
  'estimate-pdfs',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "active users can read estimate pdfs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'estimate-pdfs'
  and (select public.is_active_user())
);

create policy "active users can create estimate pdfs"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'estimate-pdfs'
  and (select public.is_active_user())
);

create policy "active users can replace estimate pdfs"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'estimate-pdfs'
  and (select public.is_active_user())
)
with check (
  bucket_id = 'estimate-pdfs'
  and (select public.is_active_user())
);

commit;
