create or replace function public.resend_appointment_email(p_queue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.email_queue%rowtype;
  v_new_id uuid;
  v_appointment_status text;
  v_appointment_start timestamptz;
  v_timezone text := coalesce(
    (select setting_value #>> '{}' from public.app_settings where setting_key = 'timezone'),
    'America/Santiago'
  );
begin
  if not public.is_admin() then
    raise exception 'Solo Administrador puede reenviar correos';
  end if;

  select *
  into v_source
  from public.email_queue
  where id = p_queue_id;

  if not found then
    raise exception 'Correo no encontrado';
  end if;

  if v_source.appointment_id is null
     or v_source.kind not in ('appointment_created', 'reminder') then
    raise exception 'Solo se pueden reenviar confirmaciones y recordatorios de citas';
  end if;

  if v_source.status in ('pending', 'processing') then
    raise exception 'El correo ya está pendiente o en procesamiento';
  end if;

  select
    a.status::text,
    ((a.appointment_date::text || ' ' || a.start_time::text)::timestamp at time zone v_timezone)
  into v_appointment_status, v_appointment_start
  from public.appointments a
  where a.id = v_source.appointment_id;

  if not found then
    raise exception 'La cita asociada ya no existe';
  end if;

  if v_appointment_status in ('cancelled', 'no_show') then
    raise exception 'No se puede reenviar un correo de una cita cancelada o marcada como inasistencia';
  end if;

  if v_appointment_start <= now() then
    raise exception 'No se puede reenviar un correo de una cita que ya comenzó';
  end if;

  insert into public.email_queue (
    appointment_id,
    recipient,
    kind,
    scheduled_for,
    status,
    attempts,
    last_error,
    provider_message_id,
    sent_at,
    idempotency_key
  )
  values (
    v_source.appointment_id,
    lower(trim(v_source.recipient)),
    v_source.kind,
    now(),
    'pending',
    0,
    null,
    null,
    null,
    gen_random_uuid()
  )
  returning id into v_new_id;

  insert into public.audit_logs (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    reason,
    changed_by
  )
  values (
    'email_queue',
    v_new_id,
    'manual_resend',
    jsonb_build_object(
      'source_queue_id', v_source.id,
      'source_status', v_source.status,
      'source_sent_at', v_source.sent_at
    ),
    jsonb_build_object(
      'recipient', v_source.recipient,
      'kind', v_source.kind,
      'appointment_id', v_source.appointment_id
    ),
    'Reenvío manual solicitado desde el módulo Correos',
    auth.uid()
  );

  return v_new_id;
end;
$$;

revoke all on function public.resend_appointment_email(uuid) from public, anon;
grant execute on function public.resend_appointment_email(uuid) to authenticated;
