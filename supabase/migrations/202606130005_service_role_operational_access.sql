begin;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.customers to service_role;
grant select, insert, update, delete on public.vessels to service_role;
grant select, insert, update, delete on public.estimates to service_role;
grant select, insert, update, delete on public.estimate_materials to service_role;
grant select, insert, update, delete on public.estimate_labor to service_role;
grant select, insert, update, delete on public.estimate_versions to service_role;
grant select, insert, update, delete on public.estimate_documents to service_role;

grant usage, select on sequence public.estimate_number_sequence to service_role;
grant execute on function public.is_active_user() to service_role;
grant execute on function public.save_estimate(
  uuid, uuid, uuid, text, text, text, text, bigint, numeric, integer, jsonb, jsonb
) to service_role;

commit;
