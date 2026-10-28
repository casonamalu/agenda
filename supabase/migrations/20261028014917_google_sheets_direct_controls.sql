begin;

create or replace function public.apply_google_sheet_action_v1(
  p_actor_id uuid,
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_appointment_id uuid;
begin
  if not exists (
    select 1
    from public.profiles
    where id = p_actor_id
      and active = true
      and role = 'admin'
  ) then
    raise exception 'Solo Administrador puede sincronizar Google Drive';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_actor_id, 'role', 'authenticated')::text,
    true
  );

  if p_action = 'create' then
    v_appointment_id := public.create_appointment_v3(
      nullif(p_payload->>'clientId', '')::uuid,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      null,
      nullif(p_payload->>'appointmentTypeId', '')::uuid,
      (p_payload->>'appointmentDate')::date,
      (p_payload->>'startTime')::time,
      (p_payload->>'durationMinutes')::integer,
      nullif(p_payload->>'eventDate', '')::date,
      nullif(p_payload->>'internalNotes', ''),
      coalesce((p_payload->>'allowOutOfSlot')::boolean, false),
      coalesce((p_payload->>'allowOverbook')::boolean, false),
      nullif(p_payload->>'exceptionReason', '')
    );
  elsif p_action = 'reschedule' then
    v_appointment_id := (p_payload->>'appointmentId')::uuid;
    perform public.reschedule_appointment_v3(
      v_appointment_id,
      (p_payload->>'appointmentTypeId')::uuid,
      (p_payload->>'appointmentDate')::date,
      (p_payload->>'startTime')::time,
      (p_payload->>'durationMinutes')::integer,
      nullif(p_payload->>'eventDate', '')::date,
      nullif(p_payload->>'internalNotes', ''),
      coalesce((p_payload->>'allowOutOfSlot')::boolean, false),
      coalesce((p_payload->>'allowOverbook')::boolean, false),
      nullif(p_payload->>'exceptionReason', '')
    );
  elsif p_action = 'status' then
    v_appointment_id := (p_payload->>'appointmentId')::uuid;
    perform public.change_appointment_status(
      v_appointment_id,
      (p_payload->>'status')::public.appointment_status,
      nullif(p_payload->>'reason', '')
    );
  elsif p_action = 'fields' then
    v_appointment_id := (p_payload->>'appointmentId')::uuid;
    perform public.update_appointment_spreadsheet_fields(
      v_appointment_id,
      nullif(p_payload->>'workshopObservation', ''),
      nullif(p_payload->>'spreadsheetStatus', ''),
      nullif(p_payload->>'internalNotes', ''),
      nullif(p_payload->>'eventDate', '')::date
    );
  else
    raise exception 'Acción de sincronización no válida';
  end if;

  return jsonb_build_object('appointmentId', v_appointment_id);
end;
$$;

revoke all on function public.apply_google_sheet_action_v1(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_google_sheet_action_v1(uuid,text,jsonb)
  to service_role;

commit;