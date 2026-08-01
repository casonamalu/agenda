-- Backlog operativo · Agenda Casona Malú
-- Ejecutar después de 202607270001_system_improvements.sql.
--
-- Esta migración conserva usuarios, clientes, citas, correos y configuraciones.
-- Agrega nuevas funciones con sufijo _v2 para no interrumpir el frontend
-- publicado mientras se completa el despliegue de esta versión.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'commercial_outcome'
  ) then
    create type public.commercial_outcome as enum ('completed_sale', 'rejected_sale', 'potential_sale');
  end if;
end;
$$;

begin;

alter table public.clients
  add column if not exists instagram text,
  add column if not exists active boolean not null default true,
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists marketing_consent_source text;

alter table public.appointments
  add column if not exists commercial_outcome public.commercial_outcome,
  add column if not exists commercial_outcome_at timestamptz,
  add column if not exists commercial_outcome_by uuid references public.profiles(id) on delete set null;

create index if not exists clients_instagram_idx
on public.clients (lower(instagram))
where instagram is not null;

create index if not exists appointments_commercial_outcome_idx
on public.appointments (appointment_date, commercial_outcome)
where commercial_outcome is not null;

insert into public.app_settings(setting_key, setting_value, description) values
  ('appointment_duration_step_minutes', '15'::jsonb, 'Incremento permitido para extender una cita'),
  ('appointment_max_duration_minutes', '240'::jsonb, 'Duración máxima de una cita extendida'),
  ('business_day_start', '"10:00"'::jsonb, 'Inicio de la jornada'),
  ('business_day_end', '"19:00"'::jsonb, 'Término de la jornada'),
  ('business_break_start', '"14:00"'::jsonb, 'Inicio del horario de almuerzo'),
  ('business_break_end', '"15:00"'::jsonb, 'Término del horario de almuerzo')
on conflict (setting_key) do nothing;

create or replace function public.setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select setting_value #>> '{}' from public.app_settings where setting_key = p_key),
    p_default
  );
$$;

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
  v_break_start time := public.setting_text('business_break_start', '14:00')::time;
  v_break_end time := public.setting_text('business_break_end', '15:00')::time;
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

  if p_start_time < v_break_end and v_end_time > v_break_start then
    return format(
      'La cita se cruza con el horario de almuerzo de %s a %s',
      to_char(v_break_start, 'HH24:MI'),
      to_char(v_break_end, 'HH24:MI')
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

create or replace function public.get_available_slots_v2(
  p_appointment_type_id uuid,
  p_date date,
  p_duration_minutes integer,
  p_exclude_appointment_id uuid default null
)
returns table(start_time time, end_time time, available boolean, reason text, regular_slot boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.start_time,
    s.start_time + make_interval(mins => p_duration_minutes) as end_time,
    public.slot_availability_reason_v2(
      t.id,
      p_date,
      s.start_time,
      p_duration_minutes,
      p_exclude_appointment_id
    ) is null as available,
    public.slot_availability_reason_v2(
      t.id,
      p_date,
      s.start_time,
      p_duration_minutes,
      p_exclude_appointment_id
    ) as reason,
    true as regular_slot
  from public.appointment_slots s
  join public.appointment_types t on t.id = s.appointment_type_id
  where s.appointment_type_id = p_appointment_type_id
    and s.active
    and t.active
    and s.weekday = extract(isodow from p_date)::smallint
    and (s.valid_from is null or s.valid_from <= p_date)
    and (s.valid_to is null or s.valid_to >= p_date)
  order by s.start_time;
$$;

create or replace function public.assert_appointment_allowed_v2(
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
  p_duration_minutes integer,
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
  v_reason text;
  v_slot_exists boolean;
  v_is_admin boolean := public.is_admin();
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;
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

  v_reason := public.slot_availability_reason_v2(
    p_appointment_type_id,
    p_date,
    p_start_time,
    p_duration_minutes,
    p_exclude_appointment_id
  );

  if v_reason is not null then
    if v_reason = 'Feriado o cierre'
      or v_reason = 'Día no laborable'
      or v_reason like 'La duración%'
      or v_reason like 'La cita debe%'
      or v_reason like 'La cita se cruza%'
      or v_reason like 'Límite diario%' then
      raise exception '%', v_reason;
    end if;

    if not (v_is_admin and p_allow_overbook) then
      raise exception '%', v_reason;
    end if;
  end if;

  return query
  select
    p_start_time + make_interval(mins => p_duration_minutes),
    v_slot_exists;
end;
$$;

create or replace function public.create_appointment_v2(
  p_existing_client_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_instagram text,
  p_client_type_id uuid,
  p_marketing_consent boolean,
  p_marketing_consent_source text,
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
  p_duration_minutes integer,
  p_internal_notes text default null,
  p_allow_out_of_slot boolean default false,
  p_allow_overbook boolean default false,
  p_exception_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_end_time time;
  v_regular boolean;
  v_appointment_id uuid;
  v_instagram text := nullif(regexp_replace(trim(coalesce(p_instagram, '')), '^@', ''), '');
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;
  if (p_allow_out_of_slot or p_allow_overbook)
    and (not public.is_admin() or nullif(trim(p_exception_reason), '') is null) then
    raise exception 'La excepción requiere perfil Administrador y un motivo';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_date::text));
  select allowed.end_time, allowed.is_regular_slot
    into v_end_time, v_regular
  from public.assert_appointment_allowed_v2(
    p_appointment_type_id,
    p_date,
    p_start_time,
    p_duration_minutes,
    p_allow_out_of_slot,
    p_allow_overbook,
    null
  ) allowed;

  if p_existing_client_id is not null then
    select id into v_client_id
    from public.clients
    where id = p_existing_client_id and active;
    if v_client_id is null then raise exception 'Cliente no encontrado o inactivo'; end if;
  else
    if nullif(trim(p_first_name), '') is null or nullif(trim(p_last_name), '') is null then
      raise exception 'Nombre y apellido son obligatorios';
    end if;
    if nullif(trim(p_email), '') is null or position('@' in p_email) <= 1 then
      raise exception 'Correo inválido';
    end if;
    if length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 8 then
      raise exception 'Número de contacto inválido';
    end if;

    select id into v_client_id
    from public.clients
    where lower(email) = lower(trim(p_email))
       or public.normalize_phone(phone) = public.normalize_phone(p_phone)
    order by case when lower(email) = lower(trim(p_email)) then 0 else 1 end
    limit 1;

    if v_client_id is null then
      insert into public.clients(
        first_name,
        last_name,
        email,
        phone,
        instagram,
        client_type_id,
        marketing_consent,
        marketing_consent_at,
        marketing_consent_source,
        created_by,
        updated_by
      )
      values (
        trim(p_first_name),
        trim(p_last_name),
        lower(trim(p_email)),
        trim(p_phone),
        v_instagram,
        p_client_type_id,
        coalesce(p_marketing_consent, false),
        case when coalesce(p_marketing_consent, false) then now() else null end,
        case
          when coalesce(p_marketing_consent, false)
            then coalesce(nullif(trim(p_marketing_consent_source), ''), 'Registro interno')
          else null
        end,
        auth.uid(),
        auth.uid()
      )
      returning id into v_client_id;
    end if;
  end if;

  perform set_config('app.audit_reason', coalesce(p_exception_reason, 'Creación de cita'), true);
  insert into public.appointments(
    client_id,
    appointment_type_id,
    appointment_date,
    start_time,
    end_time,
    status,
    internal_notes,
    is_overbook,
    is_out_of_slot,
    exception_reason,
    created_by,
    updated_by
  )
  values (
    v_client_id,
    p_appointment_type_id,
    p_date,
    p_start_time,
    v_end_time,
    'scheduled',
    nullif(trim(p_internal_notes), ''),
    p_allow_overbook,
    not v_regular,
    nullif(trim(p_exception_reason), ''),
    auth.uid(),
    auth.uid()
  )
  returning id into v_appointment_id;

  insert into public.appointment_history(
    appointment_id,
    action,
    new_date,
    new_start_time,
    new_status,
    reason,
    changed_by
  )
  values (
    v_appointment_id,
    'created',
    p_date,
    p_start_time,
    'scheduled',
    p_exception_reason,
    auth.uid()
  );

  return v_appointment_id;
end;
$$;

create or replace function public.reschedule_appointment_v2(
  p_appointment_id uuid,
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
  p_duration_minutes integer,
  p_internal_notes text default null,
  p_allow_out_of_slot boolean default false,
  p_allow_overbook boolean default false,
  p_exception_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.appointments%rowtype;
  v_end_time time;
  v_regular boolean;
  v_status public.appointment_status;
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;
  if (p_allow_out_of_slot or p_allow_overbook)
    and (not public.is_admin() or nullif(trim(p_exception_reason), '') is null) then
    raise exception 'La excepción requiere perfil Administrador y un motivo';
  end if;

  select * into v_old
  from public.appointments
  where id = p_appointment_id
  for update;
  if not found then raise exception 'Cita no encontrada'; end if;

  perform pg_advisory_xact_lock(hashtext(p_date::text));
  select allowed.end_time, allowed.is_regular_slot
    into v_end_time, v_regular
  from public.assert_appointment_allowed_v2(
    p_appointment_type_id,
    p_date,
    p_start_time,
    p_duration_minutes,
    p_allow_out_of_slot,
    p_allow_overbook,
    p_appointment_id
  ) allowed;

  v_status := case
    when v_old.appointment_date <> p_date
      or v_old.start_time <> p_start_time
      or v_old.end_time <> v_end_time
      or v_old.appointment_type_id <> p_appointment_type_id
      then 'rescheduled'::public.appointment_status
    else v_old.status
  end;

  perform set_config('app.audit_reason', coalesce(p_exception_reason, 'Modificación de cita'), true);
  update public.appointments
  set
    appointment_type_id = p_appointment_type_id,
    appointment_date = p_date,
    start_time = p_start_time,
    end_time = v_end_time,
    internal_notes = nullif(trim(p_internal_notes), ''),
    is_overbook = p_allow_overbook,
    is_out_of_slot = not v_regular,
    exception_reason = nullif(trim(p_exception_reason), ''),
    status = v_status,
    updated_by = auth.uid()
  where id = p_appointment_id;

  insert into public.appointment_history(
    appointment_id,
    action,
    old_date,
    old_start_time,
    new_date,
    new_start_time,
    old_status,
    new_status,
    reason,
    changed_by
  )
  values (
    p_appointment_id,
    'updated',
    v_old.appointment_date,
    v_old.start_time,
    p_date,
    p_start_time,
    v_old.status,
    v_status,
    p_exception_reason,
    auth.uid()
  );
end;
$$;

create or replace function public.set_appointment_commercial_outcome(
  p_appointment_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments%rowtype;
  v_category public.appointment_category;
  v_timezone text := public.setting_text('timezone', 'America/Santiago');
  v_local_now timestamp;
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;

  select a.*
    into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
  for update;

  if not found then raise exception 'Cita no encontrada'; end if;

  select category
    into v_category
  from public.appointment_types
  where id = v_appointment.appointment_type_id;

  if v_category <> 'sale' then raise exception 'El resultado comercial solo aplica a citas de Venta'; end if;
  if v_appointment.status in ('cancelled', 'no_show') then
    raise exception 'No se puede registrar una venta en una cita cancelada o no asistida';
  end if;

  v_local_now := now() at time zone v_timezone;
  if (v_appointment.appointment_date::timestamp + v_appointment.start_time) > v_local_now then
    raise exception 'El resultado comercial se registra después de iniciar la cita';
  end if;

  if p_outcome is not null
    and p_outcome not in ('completed_sale', 'rejected_sale', 'potential_sale') then
    raise exception 'Resultado comercial no válido';
  end if;

  perform set_config('app.audit_reason', 'Actualización del resultado comercial', true);
  update public.appointments
  set
    commercial_outcome = case
      when p_outcome is null then null
      else p_outcome::public.commercial_outcome
    end,
    commercial_outcome_at = case when p_outcome is null then null else now() end,
    commercial_outcome_by = case when p_outcome is null then null else auth.uid() end,
    updated_by = auth.uid()
  where id = p_appointment_id;
end;
$$;

create or replace function public.log_client_export(
  p_format text,
  p_filters jsonb,
  p_exported_count integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo Administrador puede exportar la base de clientes';
  end if;
  if p_format not in ('csv', 'xlsx') then raise exception 'Formato no permitido'; end if;
  if p_exported_count < 0 then raise exception 'Cantidad no válida'; end if;

  insert into public.audit_logs(
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    reason,
    changed_by
  )
  values (
    'clients',
    null,
    'EXPORT',
    null,
    jsonb_build_object(
      'format', p_format,
      'filters', coalesce(p_filters, '{}'::jsonb),
      'exported_count', p_exported_count
    ),
    'Exportación administrativa de clientes',
    auth.uid()
  );
end;
$$;

-- La variable {{horario}} permite mostrar el término de las citas extendidas.
update public.email_templates
set body_html = replace(body_html, '{{hora}}', '{{horario}}')
where template_key in ('appointment_created', 'reminder', 'rescheduled', 'cancelled', 'no_show')
  and body_html like '%{{hora}}%';

-- Reemplaza el trigger para que un cambio de duración también genere aviso de
-- reprogramación y reprograme el recordatorio.
create or replace function public.appointment_email_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_reminder timestamptz;
  v_reminder_hours integer := greatest(1, public.setting_int('notification_reminder_hours', 24));
  v_timezone text := public.setting_text('timezone', 'America/Santiago');
begin
  if tg_op = 'INSERT' then
    v_start := (new.appointment_date::text || ' ' || new.start_time::text)::timestamp at time zone v_timezone;
    v_reminder := v_start - make_interval(hours => v_reminder_hours);
    if new.source = 'manual' then
      perform public.queue_appointment_email(new.id, 'appointment_created', now());
    end if;
    if v_reminder > now() then
      perform public.queue_appointment_email(new.id, 'reminder', v_reminder);
    end if;
    return new;
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.email_queue
    set status = 'cancelled'
    where appointment_id = new.id
      and status in ('pending', 'retry')
      and kind = 'reminder';
    perform public.queue_appointment_email(new.id, 'cancelled', now());
    return new;
  end if;

  if new.status = 'no_show' and old.status <> 'no_show' then
    update public.email_queue
    set status = 'cancelled'
    where appointment_id = new.id
      and status in ('pending', 'retry')
      and kind = 'reminder';
    perform public.queue_appointment_email(new.id, 'no_show', now());
    return new;
  end if;

  if new.appointment_date <> old.appointment_date
    or new.start_time <> old.start_time
    or new.end_time <> old.end_time
    or new.appointment_type_id <> old.appointment_type_id then
    update public.email_queue
    set status = 'cancelled'
    where appointment_id = new.id
      and status in ('pending', 'retry')
      and kind = 'reminder';
    perform public.queue_appointment_email(new.id, 'rescheduled', now());
    v_start := (new.appointment_date::text || ' ' || new.start_time::text)::timestamp at time zone v_timezone;
    v_reminder := v_start - make_interval(hours => v_reminder_hours);
    if v_reminder > now() then
      perform public.queue_appointment_email(new.id, 'reminder', v_reminder);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.get_available_slots_v2(uuid,date,integer,uuid) from public, anon, authenticated;
revoke all on function public.create_appointment_v2(uuid,text,text,text,text,text,uuid,boolean,text,uuid,date,time,integer,text,boolean,boolean,text) from public, anon, authenticated;
revoke all on function public.reschedule_appointment_v2(uuid,uuid,date,time,integer,text,boolean,boolean,text) from public, anon, authenticated;
revoke all on function public.set_appointment_commercial_outcome(uuid,text) from public, anon, authenticated;
revoke all on function public.log_client_export(text,jsonb,integer) from public, anon, authenticated;
revoke all on function public.setting_text(text,text) from public, anon, authenticated;
revoke all on function public.slot_availability_reason_v2(uuid,date,time,integer,uuid) from public, anon, authenticated;
revoke all on function public.assert_appointment_allowed_v2(uuid,date,time,integer,boolean,boolean,uuid) from public, anon, authenticated;
revoke all on function public.appointment_email_trigger() from public, anon, authenticated;

grant execute on function public.get_available_slots_v2(uuid,date,integer,uuid) to authenticated;
grant execute on function public.create_appointment_v2(uuid,text,text,text,text,text,uuid,boolean,text,uuid,date,time,integer,text,boolean,boolean,text) to authenticated;
grant execute on function public.reschedule_appointment_v2(uuid,uuid,date,time,integer,text,boolean,boolean,text) to authenticated;
grant execute on function public.set_appointment_commercial_outcome(uuid,text) to authenticated;
grant execute on function public.log_client_export(text,jsonb,integer) to authenticated;

commit;

select
  public.setting_int('appointment_duration_step_minutes', 15) as incremento_duracion,
  public.setting_int('appointment_max_duration_minutes', 240) as duracion_maxima,
  public.setting_text('business_break_start', '14:00') as inicio_almuerzo,
  public.setting_text('business_break_end', '15:00') as fin_almuerzo;
