begin;

alter table public.estimate_deliveries
alter column provider set default 'zoho_smtp';

commit;
