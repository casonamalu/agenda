begin;

alter table public.scheduled_reports
  add column if not exists output_format text not null default 'xlsx';

alter table public.scheduled_reports
  drop constraint if exists scheduled_reports_output_format_check;

alter table public.scheduled_reports
  add constraint scheduled_reports_output_format_check
  check (output_format in ('xlsx', 'pdf'));

commit;
