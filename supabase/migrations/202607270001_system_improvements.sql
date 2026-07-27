-- Navegación, cierres, indicadores y reportes · Agenda Casona Malú
-- Ejecutar después de 202607260002_daily_capacity_rules.sql.

begin;

-- Elimina únicamente duplicados exactos de bloqueos activos, conservando el
-- registro más antiguo. Las eliminaciones quedan registradas por auditoría.
delete from public.closures
where public.closures.active
  and exists (
    select 1
    from public.closures original
    where original.active
      and public.closures.start_date = original.start_date
      and public.closures.end_date = original.end_date
      and public.closures.all_day = original.all_day
      and coalesce(public.closures.start_time, time '00:00') = coalesce(original.start_time, time '00:00')
      and coalesce(public.closures.end_time, time '23:59') = coalesce(original.end_time, time '23:59')
      and (public.closures.created_at, public.closures.id) > (original.created_at, original.id)
  );

create unique index if not exists closures_active_period_unique
on public.closures (
  start_date,
  end_date,
  all_day,
  coalesce(start_time, time '00:00'),
  coalesce(end_time, time '23:59')
)
where active;

-- Capacidad mensual separada en Venta, Pruebas y Entrega.
create or replace function public.get_capacity_by_type_in_range(
  p_from date,
  p_to date
)
returns table(
  category_key text,
  label text,
  color text,
  total_capacity bigint,
  booked bigint,
  available bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with dates as (
    select day::date as day
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') day
    where extract(isodow from day) between 1 and 6
  ),
  sale_capacity as (
    select coalesce(sum(t.capacity_per_slot), 0)::bigint as total
    from dates d
    join public.appointment_slots s
      on s.weekday = extract(isodow from d.day)::smallint
     and s.active
     and (s.valid_from is null or s.valid_from <= d.day)
     and (s.valid_to is null or s.valid_to >= d.day)
    join public.appointment_types t
      on t.id = s.appointment_type_id
     and t.active
     and t.category = 'sale'
    where not public.is_closed_at(
      d.day,
      s.start_time,
      s.start_time + make_interval(mins => t.duration_minutes)
    )
  ),
  trial_capacity_by_day as (
    select
      d.day,
      least(
        public.setting_int('daily_trial_limit', 2)::bigint,
        count(distinct s.start_time)
      )::bigint as total
    from dates d
    left join (
      select
        s.weekday,
        s.start_time,
        s.valid_from,
        s.valid_to,
        t.duration_minutes
      from public.appointment_slots s
      join public.appointment_types t
        on t.id = s.appointment_type_id
       and t.active
       and t.category = 'trial'
      where s.active
    ) s
      on s.weekday = extract(isodow from d.day)::smallint
     and (s.valid_from is null or s.valid_from <= d.day)
     and (s.valid_to is null or s.valid_to >= d.day)
    where s.start_time is null
       or not public.is_closed_at(
         d.day,
         s.start_time,
         s.start_time + make_interval(mins => s.duration_minutes)
       )
    group by d.day
  ),
  delivery_capacity_by_day as (
    select
      d.day,
      least(
        public.setting_int('daily_delivery_limit', 2)::bigint,
        count(distinct s.start_time)
      )::bigint as total
    from dates d
    left join (
      select
        s.weekday,
        s.start_time,
        s.valid_from,
        s.valid_to,
        t.duration_minutes
      from public.appointment_slots s
      join public.appointment_types t
        on t.id = s.appointment_type_id
       and t.active
       and t.category = 'delivery'
      where s.active
    ) s
      on s.weekday = extract(isodow from d.day)::smallint
     and (s.valid_from is null or s.valid_from <= d.day)
     and (s.valid_to is null or s.valid_to >= d.day)
    where s.start_time is null
       or not public.is_closed_at(
         d.day,
         s.start_time,
         s.start_time + make_interval(mins => s.duration_minutes)
       )
    group by d.day
  ),
  capacity as (
    select 'sale'::text as category_key, (select total from sale_capacity) as total
    union all
    select 'trial', coalesce(sum(total), 0)::bigint from trial_capacity_by_day
    union all
    select 'delivery', coalesce(sum(total), 0)::bigint from delivery_capacity_by_day
  ),
  booked as (
    select
      t.category::text as category_key,
      count(*)::bigint as total
    from public.appointments a
    join public.appointment_types t on t.id = a.appointment_type_id
    where a.appointment_date between p_from and p_to
      and a.status <> 'cancelled'
    group by t.category
  ),
  definitions(category_key, label, fallback_color, display_order) as (
    values
      ('sale'::text, 'Venta'::text, '#7f3f52'::text, 1),
      ('trial', 'Pruebas (1 y 2)', '#b66f83', 2),
      ('delivery', 'Entrega', '#3f7f70', 3)
  )
  select
    definitions.category_key,
    definitions.label,
    coalesce(
      (
        select t.color
        from public.appointment_types t
        where t.category::text = definitions.category_key
        order by t.sort_order
        limit 1
      ),
      definitions.fallback_color
    ) as color,
    coalesce(capacity.total, 0)::bigint as total_capacity,
    coalesce(booked.total, 0)::bigint as booked,
    greatest(coalesce(capacity.total, 0) - coalesce(booked.total, 0), 0)::bigint as available
  from definitions
  left join capacity using (category_key)
  left join booked using (category_key)
  order by definitions.display_order;
$$;

revoke all on function public.get_capacity_by_type_in_range(date, date) from public;
grant execute on function public.get_capacity_by_type_in_range(date, date) to authenticated;

-- Relación entre la cola de correo y una programación de reporte.
alter table public.email_queue
  add column if not exists report_id uuid references public.scheduled_reports(id) on delete set null,
  add column if not exists report_run_date date;

create index if not exists email_queue_report_idx
on public.email_queue(report_id, report_run_date);

create unique index if not exists email_queue_report_recipient_unique
on public.email_queue(report_id, report_run_date, lower(recipient))
where kind = 'report' and report_id is not null and report_run_date is not null;

drop trigger if exists audit_scheduled_reports on public.scheduled_reports;
create trigger audit_scheduled_reports
after insert or update or delete on public.scheduled_reports
for each row execute function public.audit_row_change();

-- Genera, una sola vez por día y destinatario, los reportes que ya cumplieron
-- su día y hora configurados.
create or replace function public.queue_due_scheduled_reports(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text := coalesce(
    (select setting_value #>> '{}' from public.app_settings where setting_key = 'timezone'),
    'America/Santiago'
  );
  v_local timestamp;
  v_report public.scheduled_reports%rowtype;
  v_recipient text;
  v_inserted integer := 0;
  v_row_count integer;
begin
  v_local := p_now at time zone v_timezone;

  for v_report in
    select *
    from public.scheduled_reports
    where active
      and extract(isodow from v_local)::smallint = any(weekdays)
      and send_time <= v_local::time
  loop
    foreach v_recipient in array v_report.recipients
    loop
      insert into public.email_queue(
        report_id,
        report_run_date,
        recipient,
        kind,
        scheduled_for,
        status
      )
      values (
        v_report.id,
        v_local::date,
        lower(trim(v_recipient)),
        'report',
        p_now,
        'pending'
      )
      on conflict do nothing;

      get diagnostics v_row_count = row_count;
      v_inserted := v_inserted + v_row_count;
    end loop;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.queue_due_scheduled_reports(timestamptz) from public;

commit;

select
  (select count(*) from public.closures where active) as bloqueos_activos,
  public.setting_int('daily_trial_limit', 2) as maximo_diario_pruebas,
  public.setting_int('daily_delivery_limit', 2) as maximo_diario_entregas;
