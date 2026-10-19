begin;

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.set_appointment_event_date_v1(
  p_appointment_id uuid,
  p_event_date date,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_internal_user() then
    raise exception 'Usuario no autorizado';
  end if;

  if not exists (
    select 1 from public.appointments where id = p_appointment_id
  ) then
    raise exception 'Cita no encontrada';
  end if;

  if exists (
    select 1
    from public.appointments
    where id = p_appointment_id
      and event_date is distinct from p_event_date
  ) then
    perform set_config('app.audit_reason', p_reason, true);
    update public.appointments
    set event_date = p_event_date
    where id = p_appointment_id;
  end if;
end;
$$;

revoke all on function private.set_appointment_event_date_v1(uuid,date,text) from public, anon, authenticated;
grant execute on function private.set_appointment_event_date_v1(uuid,date,text) to authenticated;

create or replace function public.create_appointment_v3(
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
  p_event_date date default null,
  p_internal_notes text default null,
  p_allow_out_of_slot boolean default false,
  p_allow_overbook boolean default false,
  p_exception_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_appointment_id uuid;
begin
  v_appointment_id := public.create_appointment_v2(
    p_existing_client_id,
    p_first_name,
    p_last_name,
    p_email,
    p_phone,
    p_instagram,
    p_client_type_id,
    p_marketing_consent,
    p_marketing_consent_source,
    p_appointment_type_id,
    p_date,
    p_start_time,
    p_duration_minutes,
    p_internal_notes,
    p_allow_out_of_slot,
    p_allow_overbook,
    p_exception_reason
  );

  perform private.set_appointment_event_date_v1(
    v_appointment_id,
    p_event_date,
    'Fecha de evento registrada al crear cita'
  );

  return v_appointment_id;
end;
$$;

create or replace function public.reschedule_appointment_v3(
  p_appointment_id uuid,
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
  p_duration_minutes integer,
  p_event_date date default null,
  p_internal_notes text default null,
  p_allow_out_of_slot boolean default false,
  p_allow_overbook boolean default false,
  p_exception_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  perform public.reschedule_appointment_v2(
    p_appointment_id,
    p_appointment_type_id,
    p_date,
    p_start_time,
    p_duration_minutes,
    p_internal_notes,
    p_allow_out_of_slot,
    p_allow_overbook,
    p_exception_reason
  );

  perform private.set_appointment_event_date_v1(
    p_appointment_id,
    p_event_date,
    'Fecha de evento actualizada desde la cita'
  );
end;
$$;

create or replace function public.create_group_sale_appointment_v2(
  p_primary_client jsonb,
  p_companion_client jsonb,
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
  p_event_date date default null,
  p_internal_notes text default null,
  p_allow_out_of_slot boolean default false,
  p_allow_overbook boolean default false,
  p_exception_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_appointment_id uuid;
begin
  v_appointment_id := public.create_group_sale_appointment_v1(
    p_primary_client,
    p_companion_client,
    p_appointment_type_id,
    p_date,
    p_start_time,
    p_internal_notes,
    p_allow_out_of_slot,
    p_allow_overbook,
    p_exception_reason
  );

  perform private.set_appointment_event_date_v1(
    v_appointment_id,
    p_event_date,
    'Fecha de evento registrada al crear cita grupal'
  );

  return v_appointment_id;
end;
$$;

commit;
