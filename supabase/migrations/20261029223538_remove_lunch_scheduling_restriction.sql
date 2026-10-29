-- Permite agendar durante el antiguo horario de almuerzo.
-- Mantiene jornada, cierres, capacidad simultánea y límites diarios.

create or replace function public.slot_availability_reason_v2(
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
  p_duration_minutes integer,
  p_exclude_appointment_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base_duration integer;
  v_max_duration integer := public.setting_int('appointment_max_duration_minutes', 240);
  v_duration_step integer := public.setting_int('appointment_duration_step_minutes', 15);
  v_category public.appointment_category;
  v_type_capacity integer;
  v_shared_capacity integer := public.setting_int('shared_space_capacity', 1);
  v_daily_trial_limit integer := public.setting_int('daily_trial_limit', 2);
  v_daily_delivery_limit integer := public.setting_int('daily_delivery_limit', 2);
  v_day_start time := public.setting_text('business_day_start', '10:00')::time;
  v_day_end time := public.setting_text('business_day_end', '19:00')::time;
  v_start_timestamp timestamp;
  v_end_timestamp timestamp;
  v_end_time time;
  v_overlap_count integer;
  v_type_overlap_count integer;
  v_daily_count integer;
begin
  select duration_minutes, category, capacity_per_slot
    into v_base_duration, v_category, v_type_capacity
  from public.appointment_types
  where id = p_appointment_type_id and active;

  if v_base_duration is null then return 'Tipo de cita no disponible'; end if;
  if extract(isodow from p_date) not between 1 and 6 then return 'Día no laborable'; end if;
  if p_duration_minutes is null or p_duration_minutes < v_base_duration then
    return format('La duración mínima es %s minutos', v_base_duration);
  end if;
  if p_duration_minutes > v_max_duration then
    return format('La duración máxima es %s minutos', v_max_duration);
  end if;
  if v_duration_step < 1 or mod(p_duration_minutes - v_base_duration, v_duration_step) <> 0 then
    return format('La duración debe aumentar en intervalos de %s minutos', greatest(v_duration_step, 1));
  end if;

  v_start_timestamp := p_date::timestamp + p_start_time;
  v_end_timestamp := v_start_timestamp + make_interval(mins => p_duration_minutes);
  if v_end_timestamp::date <> p_date then return 'La cita debe terminar el mismo día'; end if;
  v_end_time := v_end_timestamp::time;

  if p_start_time < v_day_start or v_end_time > v_day_end then
    return format(
      'La cita debe quedar dentro de la jornada de %s a %s',
      to_char(v_day_start, 'HH24:MI'),
      to_char(v_day_end, 'HH24:MI')
    );
  end if;

  if public.is_closed_at(p_date, p_start_time, v_end_time) then
    return 'Feriado o cierre';
  end if;

  if v_category in ('trial', 'delivery') then
    select count(*) into v_overlap_count
    from public.appointments a
    join public.appointment_types overlap_type on overlap_type.id = a.appointment_type_id
    where a.appointment_date = p_date
      and a.status <> 'cancelled'
      and overlap_type.category in ('trial', 'delivery')
      and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
      and a.start_time < v_end_time
      and a.end_time > p_start_time;

    if v_overlap_count >= v_shared_capacity then
      return 'Espacio de pruebas y entregas ocupado durante parte del tramo';
    end if;
  end if;

  select count(*) into v_type_overlap_count
  from public.appointments a
  where a.appointment_date = p_date
    and a.appointment_type_id = p_appointment_type_id
    and a.status <> 'cancelled'
    and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
    and a.start_time < v_end_time
    and a.end_time > p_start_time;

  if v_type_overlap_count >= v_type_capacity then
    return 'Capacidad del tipo de cita completa durante parte del tramo';
  end if;

  if v_category = 'trial' then
    select count(*) into v_daily_count
    from public.appointments a
    join public.appointment_types t on t.id = a.appointment_type_id
    where a.appointment_date = p_date
      and a.status <> 'cancelled'
      and t.category = 'trial'
      and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id);

    if v_daily_count >= v_daily_trial_limit then
      return 'Límite diario de pruebas alcanzado';
    end if;
  elsif v_category = 'delivery' then
    select count(*) into v_daily_count
    from public.appointments a
    join public.appointment_types t on t.id = a.appointment_type_id
    where a.appointment_date = p_date
      and a.status <> 'cancelled'
      and t.category = 'delivery'
      and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id);

    if v_daily_count >= v_daily_delivery_limit then
      return 'Límite diario de entregas alcanzado';
    end if;
  end if;

  return null;
end;
$$;

-- Los bloques siguen la cadencia existente: ventas a la hora y
-- pruebas/entregas a los 45 minutos.
insert into public.appointment_slots (appointment_type_id, weekday, start_time)
select
  t.id,
  d.weekday,
  case when t.category = 'sale' then time '14:00' else time '14:45' end
from public.appointment_types t
cross join (values (1), (2), (3), (4), (5), (6)) as d(weekday)
where t.active
  and not exists (
    select 1
    from public.appointment_slots s
    where s.appointment_type_id = t.id
      and s.weekday = d.weekday
      and s.start_time = case when t.category = 'sale' then time '14:00' else time '14:45' end
      and s.valid_from is null
      and s.valid_to is null
  );
