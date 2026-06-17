begin;

create or replace function public.sync_appointment_request_pipeline_progression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' then
    if new.pipeline_id is not null then
      update public.sales_pipeline
      set stage = 'appointment_scheduled'::public.sales_pipeline_stage
      where id = new.pipeline_id
        and stage in ('lead'::public.sales_pipeline_stage, 'qualified'::public.sales_pipeline_stage);
    end if;

    if new.conversation_id is not null then
      update public.natalie_conversations
      set
        status = 'appointment_requested',
        current_stage = 'Appointment Scheduled'
      where id = new.conversation_id;
    end if;
  end if;

  return new;
end;
$$;

commit;
