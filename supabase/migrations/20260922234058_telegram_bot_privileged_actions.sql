create or replace function public.telegram_execute_action_v1(
  p_actor_id uuid,
  p_action text,
  p_request_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_claim_role text;
  v_claims jsonb;
  v_result jsonb;
  v_record_id uuid;
  v_appointment_id uuid;
  v_queue_id uuid;
begin
  v_claim_role := nullif(current_setting('request.jwt.claim.role', true), '');
  if v_claim_role is null then
    begin
      v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
      v_claim_role := v_claims->>'role';
    exception when others then
      v_claim_role := null;
    end;
  end if;
  if v_claim_role is distinct from 'service_role' then
    raise exception 'Esta función es exclusiva del servicio de Telegram';
  end if;

  if nullif(trim(p_request_key), '') is null then
    raise exception 'Identificador de solicitud obligatorio';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and active and role = 'admin'
  ) then
    raise exception 'Administrador no válido o inactivo';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);

  if p_action = 'availability' then
    select jsonb_build_object(
      'slots',
      coalesce(jsonb_agg(to_jsonb(s) order by s.start_time), '[]'::jsonb)
    )
    into v_result
    from public.get_available_slots_v2(
      (p_payload->>'appointment_type_id')::uuid,
      (p_payload->>'date')::date,
      (p_payload->>'duration_minutes')::integer,
      null
    ) s;
    return v_result;
  end if;

  perform pg_advisory_xact_lock(hashtext('telegram:' || p_request_key));
  select new_data
  into v_result
  from public.audit_logs
  where table_name = 'telegram_action'
    and reason = p_request_key
  order by changed_at desc
  limit 1;
  if found then return v_result; end if;

  if p_action = 'create_appointment' then
    v_appointment_id := public.create_appointment_v2(
      null,
      p_payload->>'first_name',
      p_payload->>'last_name',
      p_payload->>'email',
      p_payload->>'phone',
      nullif(p_payload->>'instagram', ''),
      (p_payload->>'client_type_id')::uuid,
      false,
      null,
      (p_payload->>'appointment_type_id')::uuid,
      (p_payload->>'date')::date,
      (p_payload->>'start_time')::time,
      (p_payload->>'duration_minutes')::integer,
      nullif(p_payload->>'internal_notes', ''),
      false,
      false,
      null
    );
    v_record_id := v_appointment_id;
    v_result := jsonb_build_object('ok', true, 'appointment_id', v_appointment_id);
  elsif p_action = 'resend_email' then
    v_queue_id := public.resend_appointment_email((p_payload->>'queue_id')::uuid);
    v_record_id := v_queue_id;
    v_result := jsonb_build_object('ok', true, 'queue_id', v_queue_id);
  else
    raise exception 'Acción de Telegram no permitida';
  end if;

  insert into public.audit_logs(
    table_name, record_id, action, old_data, new_data, reason, changed_by
  ) values (
    'telegram_action', v_record_id, p_action, null, v_result, p_request_key, p_actor_id
  );
  return v_result;
end;
$$;

revoke all on function public.telegram_execute_action_v1(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.telegram_execute_action_v1(uuid,text,text,jsonb) to service_role;
grant execute on function public.get_available_slots_v2(uuid,date,integer,uuid) to service_role;
grant execute on function public.create_appointment_v2(uuid,text,text,text,text,text,uuid,boolean,text,uuid,date,time,integer,text,boolean,boolean,text) to service_role;
grant execute on function public.resend_appointment_email(uuid) to service_role;
