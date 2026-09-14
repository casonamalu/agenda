begin;

alter table public.scheduled_reports
  drop constraint if exists scheduled_reports_period_type_check;

alter table public.scheduled_reports
  add constraint scheduled_reports_period_type_check
  check (period_type in ('today', 'tomorrow', 'week', 'fortnight', 'custom'));

create table if not exists public.commercial_decision_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  previous_outcome public.commercial_outcome,
  new_outcome public.commercial_outcome,
  effective_date date,
  notes text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  constraint commercial_decision_effective_date_check
    check (
      (new_outcome is null and effective_date is null)
      or (new_outcome is not null and effective_date is not null)
    )
);

comment on table public.commercial_decision_history is
  'Historial inmutable de decisiones comerciales asociado a citas de venta.';

create index if not exists commercial_decision_history_appointment_changed_idx
  on public.commercial_decision_history(appointment_id, changed_at desc);

alter table public.commercial_decision_history enable row level security;

drop policy if exists commercial_decision_history_select_internal
  on public.commercial_decision_history;

create policy commercial_decision_history_select_internal
  on public.commercial_decision_history
  for select
  to authenticated
  using (public.is_internal_user());

revoke all on table public.commercial_decision_history from public, anon, authenticated;
grant select on table public.commercial_decision_history to authenticated;

insert into public.commercial_decision_history(
  appointment_id,
  previous_outcome,
  new_outcome,
  effective_date,
  notes,
  changed_by,
  changed_at
)
select
  appointment.id,
  null,
  appointment.commercial_outcome,
  (appointment.commercial_outcome_at at time zone public.setting_text('timezone', 'America/Santiago'))::date,
  'Registro inicial migrado desde el resultado comercial vigente',
  coalesce(appointment.commercial_outcome_by, appointment.updated_by, appointment.created_by),
  appointment.commercial_outcome_at
from public.appointments appointment
where appointment.commercial_outcome is not null
  and appointment.commercial_outcome_at is not null
  and not exists (
    select 1
    from public.commercial_decision_history history
    where history.appointment_id = appointment.id
  );

create or replace function public.set_appointment_commercial_outcome_v2(
  p_appointment_id uuid,
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
  v_appointment public.appointments%rowtype;
  v_category public.appointment_category;
  v_timezone text := public.setting_text('timezone', 'America/Santiago');
  v_local_now timestamp;
  v_local_today date;
  v_previous_effective_date date;
begin
  if not public.is_internal_user() then
    raise exception 'Usuario no autorizado';
  end if;

  select appointment.*
    into v_appointment
  from public.appointments appointment
  where appointment.id = p_appointment_id
  for update;

  if not found then
    raise exception 'Cita no encontrada';
  end if;

  select appointment_type.category
    into v_category
  from public.appointment_types appointment_type
  where appointment_type.id = v_appointment.appointment_type_id;

  if v_category <> 'sale' then
    raise exception 'El resultado comercial solo aplica a citas de Venta';
  end if;

  if v_appointment.status in ('cancelled', 'no_show') then
    raise exception 'No se puede registrar una decisión en una cita cancelada o no asistida';
  end if;

  v_local_now := now() at time zone v_timezone;
  v_local_today := v_local_now::date;

  if (v_appointment.appointment_date::timestamp + v_appointment.start_time) > v_local_now then
    raise exception 'La decisión comercial se registra después de iniciar la cita';
  end if;

  if p_outcome is not null
     and p_outcome not in ('completed_sale', 'rejected_sale', 'potential_sale') then
    raise exception 'Resultado comercial no válido';
  end if;

  if p_outcome is not null and p_effective_date is null then
    raise exception 'La fecha efectiva de la decisión es obligatoria';
  end if;

  if p_outcome is not null
     and (p_effective_date < v_appointment.appointment_date or p_effective_date > v_local_today) then
    raise exception 'La fecha de decisión debe estar entre la fecha de la cita y hoy';
  end if;

  v_previous_effective_date := case
    when v_appointment.commercial_outcome_at is null then null
    else (v_appointment.commercial_outcome_at at time zone v_timezone)::date
  end;

  if v_appointment.commercial_outcome::text is not distinct from p_outcome
     and v_previous_effective_date is not distinct from p_effective_date
     and nullif(trim(p_notes), '') is null then
    return;
  end if;

  perform set_config(
    'app.audit_reason',
    coalesce(nullif(trim(p_notes), ''), 'Actualización de la decisión comercial'),
    true
  );

  update public.appointments
  set
    commercial_outcome = case
      when p_outcome is null then null
      else p_outcome::public.commercial_outcome
    end,
    commercial_outcome_at = case
      when p_outcome is null then null
      else (p_effective_date + time '12:00') at time zone v_timezone
    end,
    commercial_outcome_by = case when p_outcome is null then null else auth.uid() end,
    updated_by = auth.uid()
  where id = p_appointment_id;

  insert into public.commercial_decision_history(
    appointment_id,
    previous_outcome,
    new_outcome,
    effective_date,
    notes,
    changed_by
  )
  values (
    p_appointment_id,
    v_appointment.commercial_outcome,
    case when p_outcome is null then null else p_outcome::public.commercial_outcome end,
    case when p_outcome is null then null else p_effective_date end,
    nullif(trim(p_notes), ''),
    auth.uid()
  );
end;
$$;

revoke all on function public.set_appointment_commercial_outcome_v2(uuid,text,date,text)
  from public, anon, authenticated;
grant execute on function public.set_appointment_commercial_outcome_v2(uuid,text,date,text)
  to authenticated;

commit;
