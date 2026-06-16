begin;

alter type public.estimate_approval_action add value if not exists 'notification_sent';
alter type public.estimate_approval_action add value if not exists 'notification_failed';

commit;
