begin;

do $$
begin
  alter table public.sales_pipeline
    add constraint sales_pipeline_estimate_id_unique
    unique (estimate_id);
exception
  when duplicate_object then null;
end;
$$;

commit;
