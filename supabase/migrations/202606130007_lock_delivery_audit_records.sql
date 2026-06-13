begin;

revoke insert, update on public.estimate_deliveries from authenticated;

drop policy "active users can queue estimate deliveries"
on public.estimate_deliveries;

drop policy "requesting users can update estimate deliveries"
on public.estimate_deliveries;

commit;
