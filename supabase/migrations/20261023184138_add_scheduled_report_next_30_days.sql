begin;

alter table public.scheduled_reports
  drop constraint if exists scheduled_reports_period_type_check;

alter table public.scheduled_reports
  add constraint scheduled_reports_period_type_check
  check (period_type in ('today', 'tomorrow', 'week', 'fortnight', 'next_30_days', 'next_31_days', 'custom'));

commit;
