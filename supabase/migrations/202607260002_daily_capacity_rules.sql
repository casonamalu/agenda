-- Reglas configurables de capacidad diaria · Agenda Casona Malú
--
-- Reglas iniciales:
--   * Prueba 1 + Prueba 2: máximo conjunto de 2 citas diarias.
--   * Entrega: máximo de 2 citas diarias.
--   * Venta: sin máximo diario adicional; utiliza todos sus bloques activos.
--   * Pruebas y entregas comparten su capacidad simultánea.
--   * Ventas no consumen la capacidad del espacio de pruebas y entregas.

begin;

insert into public.app_settings(setting_key, setting_value, description) values
  ('shared_space_capacity', '1'::jsonb, 'Capacidad simultánea del espacio de pruebas y entregas'),
  ('daily_trial_limit', '2'::jsonb, 'Máximo diario conjunto de Prueba 1 y Prueba 2'),
  ('daily_delivery_limit', '2'::jsonb, 'Máximo diario de entregas')
on conflict (setting_key) do nothing;

update public.app_settings
set description = 'Configuración anterior reemplazada por daily_trial_limit y daily_delivery_limit'
where setting_key = 'daily_trial_delivery_limit';

create or replace function public.slot_availability_reason(
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
  p_exclude_appointment_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_duration integer;
  v_end_time time;
  v_category public.appointment_category;
  v_type_capacity integer;
  v_shared_capacity integer := public.setting_int('shared_space_capacity', 1);
  v_daily_trial_limit integer := public.setting_int('daily_trial_limit', 2);
  v_daily_delivery_limit integer := public.setting_int('daily_delivery_limit', 2);
  v_overlap_count integer;
  v_type_overlap_count integer;
  v_daily_count integer;
begin
  select duration_minutes, category, capacity_per_slot
    into v_duration, v_category, v_type_capacity
  from public.appointment_types
  where id = p_appointment_type_id and active;

  if v_duration is null then return 'Tipo de cita no disponible'; end if;
  if extract(isodow from p_date) not between 1 and 6 then return 'Día no laborable'; end if;

  v_end_time := p_start_time + make_interval(mins => v_duration);
  if public.is_closed_at(p_date, p_start_time, v_end_time) then return 'Feriado o cierre'; end if;

  -- Pruebas y entregas comparten espacio entre sí.
  -- Las ventas mantienen su disponibilidad independiente.
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
      return 'Espacio de pruebas y entregas ocupado';
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
    return 'Capacidad del tipo de cita completa';
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

create or replace function public.assert_appointment_allowed(
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
  p_allow_out_of_slot boolean,
  p_allow_overbook boolean,
  p_exclude_appointment_id uuid default null
)
returns table(end_time time, is_regular_slot boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duration integer;
  v_reason text;
  v_slot_exists boolean;
  v_is_admin boolean := public.is_admin();
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;

  select duration_minutes
    into v_duration
  from public.appointment_types
  where id = p_appointment_type_id and active;

  if v_duration is null then raise exception 'Tipo de cita no válido'; end if;
  if extract(isodow from p_date) not between 1 and 6 then
    raise exception 'Las citas solo pueden agendarse de lunes a sábado';
  end if;

  select exists(
    select 1
    from public.appointment_slots s
    where s.appointment_type_id = p_appointment_type_id
      and s.active
      and s.weekday = extract(isodow from p_date)::smallint
      and s.start_time = p_start_time
      and (s.valid_from is null or s.valid_from <= p_date)
      and (s.valid_to is null or s.valid_to >= p_date)
  ) into v_slot_exists;

  if not v_slot_exists and not (v_is_admin and p_allow_out_of_slot) then
    raise exception 'El horario no corresponde a un bloque configurado';
  end if;

  v_reason := public.slot_availability_reason(
    p_appointment_type_id,
    p_date,
    p_start_time,
    p_exclude_appointment_id
  );

  if v_reason is not null then
    -- Los máximos diarios son obligatorios, incluso para el Administrador.
    if v_reason in (
      'Feriado o cierre',
      'Día no laborable',
      'Límite diario de pruebas alcanzado',
      'Límite diario de entregas alcanzado'
    ) then
      raise exception '%', v_reason;
    end if;

    if not (v_is_admin and p_allow_overbook) then
      raise exception '%', v_reason;
    end if;
  end if;

  return query
  select p_start_time + make_interval(mins => v_duration), v_slot_exists;
end;
$$;

commit;

select
  public.setting_int('daily_trial_limit', 2) as maximo_diario_pruebas,
  public.setting_int('daily_delivery_limit', 2) as maximo_diario_entregas,
  public.setting_int('shared_space_capacity', 1) as capacidad_simultanea_pruebas_entregas;
