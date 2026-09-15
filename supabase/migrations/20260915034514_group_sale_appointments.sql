begin;

-- Una cita grupal continúa siendo una sola reserva. La clienta principal se
-- conserva en appointments.client_id y solo las acompañantes viven aquí, por
-- lo que no es necesario reescribir citas ni clientes existentes.
create table public.appointment_participants (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  position smallint not null default 2 check (position between 2 and 4),
  commercial_outcome public.commercial_outcome,
  commercial_outcome_at timestamptz,
  commercial_outcome_by uuid references public.profiles(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, client_id),
  unique (appointment_id, position),
  constraint appointment_participant_outcome_date_check check (
    (commercial_outcome is null and commercial_outcome_at is null)
    or (commercial_outcome is not null and commercial_outcome_at is not null)
  )
);

comment on table public.appointment_participants is
  'Clientas adicionales que comparten una cita; la clienta principal permanece en appointments.client_id.';

create index appointment_participants_client_idx
  on public.appointment_participants(client_id, appointment_id);

create table public.appointment_participant_decision_history (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.appointment_participants(id) on delete cascade,
  previous_outcome public.commercial_outcome,
  new_outcome public.commercial_outcome,
  effective_date date,
  notes text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint participant_decision_effective_date_check check (
    (new_outcome is null and effective_date is null)
    or (new_outcome is not null and effective_date is not null)
  )
);

create index participant_decision_history_changed_idx
  on public.appointment_participant_decision_history(participant_id, changed_at desc);

create trigger appointment_participants_updated_at
before update on public.appointment_participants
for each row execute function public.set_updated_at();

create trigger audit_appointment_participants
after insert or update or delete on public.appointment_participants
for each row execute function public.audit_row_change();

alter table public.appointment_participants enable row level security;
alter table public.appointment_participant_decision_history enable row level security;

create policy appointment_participants_select_internal
  on public.appointment_participants for select to authenticated
  using (public.is_internal_user());

create policy participant_decision_history_select_internal
  on public.appointment_participant_decision_history for select to authenticated
  using (public.is_internal_user());

revoke all on table public.appointment_participants from public, anon, authenticated;
revoke all on table public.appointment_participant_decision_history from public, anon, authenticated;
grant select on table public.appointment_participants to authenticated;
grant select on table public.appointment_participant_decision_history to authenticated;

create or replace function public.resolve_group_client_v1(p_client jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_client_id uuid;
  v_existing_id uuid;
  v_email text := lower(trim(coalesce(p_client->>'email', '')));
  v_phone text := trim(coalesce(p_client->>'phone', ''));
  v_instagram text := nullif(regexp_replace(trim(coalesce(p_client->>'instagram', '')), '^@+', ''), '');
  v_type_id uuid;
  v_marketing boolean := coalesce((p_client->>'marketing_consent')::boolean, false);
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;
  if p_client is null or jsonb_typeof(p_client) <> 'object' then
    raise exception 'Los datos de la cliente no son válidos';
  end if;

  if nullif(p_client->>'existing_client_id', '') is not null then
    begin
      v_existing_id := (p_client->>'existing_client_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'La cliente seleccionada no es válida';
    end;
    select client.id into v_client_id
    from public.clients client
    where client.id = v_existing_id and client.active;
    if v_client_id is null then raise exception 'Cliente no encontrada o inactiva'; end if;
    return v_client_id;
  end if;

  if nullif(trim(p_client->>'first_name'), '') is null
     or nullif(trim(p_client->>'last_name'), '') is null then
    raise exception 'Nombre y apellido son obligatorios para ambas personas';
  end if;
  if v_email = '' or position('@' in v_email) <= 1 then
    raise exception 'El correo de ambas personas debe ser válido';
  end if;
  if length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 8 then
    raise exception 'El número de contacto de ambas personas debe ser válido';
  end if;
  begin
    v_type_id := nullif(p_client->>'client_type_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Selecciona el tipo de cliente de ambas personas';
  end;
  if v_type_id is null or not exists (
    select 1 from public.client_types where id = v_type_id and active
  ) then raise exception 'Selecciona el tipo de cliente de ambas personas'; end if;

  select client.id into v_client_id
  from public.clients client
  where lower(client.email) = v_email
     or public.normalize_phone(client.phone) = public.normalize_phone(v_phone)
  order by case when lower(client.email) = v_email then 0 else 1 end
  limit 1;

  if v_client_id is null then
    insert into public.clients(
      first_name, last_name, email, phone, instagram, client_type_id,
      marketing_consent, marketing_consent_at, marketing_consent_source,
      created_by, updated_by
    ) values (
      trim(p_client->>'first_name'), trim(p_client->>'last_name'), v_email,
      v_phone, v_instagram, v_type_id, v_marketing,
      case when v_marketing then now() else null end,
      case when v_marketing then coalesce(nullif(trim(p_client->>'marketing_consent_source'), ''), 'Registro interno') else null end,
      auth.uid(), auth.uid()
    ) returning id into v_client_id;
  end if;

  return v_client_id;
end;
$$;

-- La cola se amplía para que reprogramaciones, cancelaciones y recordatorios
-- lleguen a todas las personas de una misma cita.
create or replace function public.queue_appointment_email(
  p_appointment_id uuid,
  p_kind text,
  p_scheduled_for timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text;
begin
  for v_email in
    select lower(recipient.email)
    from (
      select primary_client.email
      from public.appointments appointment
      join public.clients primary_client on primary_client.id = appointment.client_id
      where appointment.id = p_appointment_id
      union
      select companion.email
      from public.appointment_participants participant
      join public.clients companion on companion.id = participant.client_id
      where participant.appointment_id = p_appointment_id
    ) recipient
  loop
    if not exists (
      select 1 from public.email_queue queued
      where queued.appointment_id = p_appointment_id
        and queued.kind = p_kind
        and queued.scheduled_for = p_scheduled_for
        and lower(queued.recipient) = v_email
        and queued.status <> 'cancelled'
    ) then
      insert into public.email_queue(appointment_id, recipient, kind, scheduled_for)
      values (p_appointment_id, v_email, p_kind, p_scheduled_for);
    end if;
  end loop;
end;
$$;

create or replace function public.create_group_sale_appointment_v1(
  p_primary_client jsonb,
  p_companion_client jsonb,
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
  p_internal_notes text default null,
  p_allow_out_of_slot boolean default false,
  p_allow_overbook boolean default false,
  p_exception_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_primary_id uuid;
  v_companion_id uuid;
  v_appointment_id uuid;
  v_category public.appointment_category;
  v_created_scheduled timestamptz;
  v_reminder_scheduled timestamptz;
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;
  select category into v_category
  from public.appointment_types
  where id = p_appointment_type_id and active;
  if v_category is distinct from 'sale' then
    raise exception 'La atención de dos personas solo está disponible para citas de Venta';
  end if;

  v_primary_id := public.resolve_group_client_v1(p_primary_client);
  v_companion_id := public.resolve_group_client_v1(p_companion_client);
  if v_primary_id = v_companion_id then
    raise exception 'Selecciona dos personas distintas';
  end if;

  v_appointment_id := public.create_appointment_v2(
    v_primary_id, null, null, null, null, null, null, false, null,
    p_appointment_type_id, p_date, p_start_time, 90, p_internal_notes,
    p_allow_out_of_slot, p_allow_overbook, p_exception_reason
  );

  insert into public.appointment_participants(
    appointment_id, client_id, position, created_by, updated_by
  ) values (
    v_appointment_id, v_companion_id, 2, auth.uid(), auth.uid()
  );

  -- El trigger de appointments alcanzó a encolar a la principal antes de que
  -- existiera la acompañante. Estas llamadas completan solo el correo faltante.
  select min(scheduled_for) into v_created_scheduled
  from public.email_queue
  where appointment_id = v_appointment_id and kind = 'appointment_created' and status <> 'cancelled';
  perform public.queue_appointment_email(v_appointment_id, 'appointment_created', coalesce(v_created_scheduled, now()));

  select min(scheduled_for) into v_reminder_scheduled
  from public.email_queue
  where appointment_id = v_appointment_id and kind = 'reminder' and status <> 'cancelled';
  if v_reminder_scheduled is not null then
    perform public.queue_appointment_email(v_appointment_id, 'reminder', v_reminder_scheduled);
  end if;

  return v_appointment_id;
end;
$$;

create or replace function public.set_participant_commercial_outcome_v1(
  p_participant_id uuid,
  p_outcome text,
  p_effective_date date default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_participant public.appointment_participants%rowtype;
  v_appointment public.appointments%rowtype;
  v_category public.appointment_category;
  v_timezone text := public.setting_text('timezone', 'America/Santiago');
  v_local_now timestamp;
  v_previous_date date;
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;

  select * into v_participant
  from public.appointment_participants
  where id = p_participant_id
  for update;
  if not found then raise exception 'Participante no encontrada'; end if;

  select * into v_appointment
  from public.appointments
  where id = v_participant.appointment_id;
  select category into v_category from public.appointment_types where id = v_appointment.appointment_type_id;
  if v_category is distinct from 'sale' then raise exception 'La decisión comercial solo aplica a citas de Venta'; end if;
  if v_appointment.status in ('cancelled', 'no_show') then
    raise exception 'No se puede registrar una decisión en una cita cancelada o no asistida';
  end if;

  v_local_now := now() at time zone v_timezone;
  if (v_appointment.appointment_date::timestamp + v_appointment.start_time) > v_local_now then
    raise exception 'La decisión comercial se registra después de iniciar la cita';
  end if;
  if p_outcome is not null and p_outcome not in ('completed_sale', 'rejected_sale', 'potential_sale') then
    raise exception 'Resultado comercial no válido';
  end if;
  if p_outcome is not null and p_effective_date is null then
    raise exception 'La fecha efectiva de la decisión es obligatoria';
  end if;
  if p_outcome is not null
     and (p_effective_date < v_appointment.appointment_date or p_effective_date > v_local_now::date) then
    raise exception 'La fecha de decisión debe estar entre la fecha de la cita y hoy';
  end if;

  v_previous_date := case when v_participant.commercial_outcome_at is null then null
    else (v_participant.commercial_outcome_at at time zone v_timezone)::date end;
  if v_participant.commercial_outcome::text is not distinct from p_outcome
     and v_previous_date is not distinct from p_effective_date
     and nullif(trim(p_notes), '') is null then return; end if;

  perform set_config('app.audit_reason', coalesce(nullif(trim(p_notes), ''), 'Actualización de decisión de participante'), true);
  update public.appointment_participants
  set commercial_outcome = case when p_outcome is null then null else p_outcome::public.commercial_outcome end,
      commercial_outcome_at = case when p_outcome is null then null else (p_effective_date + time '12:00') at time zone v_timezone end,
      commercial_outcome_by = case when p_outcome is null then null else auth.uid() end,
      updated_by = auth.uid()
  where id = p_participant_id;

  insert into public.appointment_participant_decision_history(
    participant_id, previous_outcome, new_outcome, effective_date, notes, changed_by
  ) values (
    p_participant_id, v_participant.commercial_outcome,
    case when p_outcome is null then null else p_outcome::public.commercial_outcome end,
    case when p_outcome is null then null else p_effective_date end,
    nullif(trim(p_notes), ''), auth.uid()
  );
end;
$$;

revoke all on function public.resolve_group_client_v1(jsonb) from public, anon, authenticated;
revoke all on function public.queue_appointment_email(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.create_group_sale_appointment_v1(jsonb,jsonb,uuid,date,time,text,boolean,boolean,text) from public, anon, authenticated;
revoke all on function public.set_participant_commercial_outcome_v1(uuid,text,date,text) from public, anon, authenticated;

grant execute on function public.create_group_sale_appointment_v1(jsonb,jsonb,uuid,date,time,text,boolean,boolean,text) to authenticated;
grant execute on function public.set_participant_commercial_outcome_v1(uuid,text,date,text) to authenticated;

commit;
