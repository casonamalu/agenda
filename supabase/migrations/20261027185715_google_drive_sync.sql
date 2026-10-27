begin;

alter table public.appointments
  add column if not exists workshop_observation text,
  add column if not exists spreadsheet_status text;

alter table public.appointments
  drop constraint if exists appointments_spreadsheet_status_check;

alter table public.appointments
  add constraint appointments_spreadsheet_status_check
  check (spreadsheet_status is null or spreadsheet_status in ('Pendiente', 'Realizada', 'Entregado'));

create table if not exists public.google_drive_sync_config (
  id smallint primary key default 1 check (id = 1),
  spreadsheet_id text not null,
  spreadsheet_url text not null,
  sheet_name text not null default 'REGISTRO',
  active boolean not null default false,
  last_export_at timestamptz,
  last_import_at timestamptz,
  last_error text,
  last_summary jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.google_drive_sync_config (
  id,
  spreadsheet_id,
  spreadsheet_url,
  sheet_name,
  active
)
values (
  1,
  '1rhXGSmRnHfcGAIJRvetHBFl2LKEAcM3Eb-N1zEdWshk',
  'https://docs.google.com/spreadsheets/d/1rhXGSmRnHfcGAIJRvetHBFl2LKEAcM3Eb-N1zEdWshk/edit',
  'REGISTRO',
  false
)
on conflict (id) do update
set spreadsheet_id = excluded.spreadsheet_id,
    spreadsheet_url = excluded.spreadsheet_url,
    sheet_name = excluded.sheet_name,
    updated_at = now();

create table if not exists public.google_drive_sync_runs (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('system_to_drive', 'drive_to_system')),
  trigger_source text not null check (trigger_source in ('manual', 'scheduled')),
  status text not null check (status in ('started', 'completed', 'partial', 'failed')),
  read_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  triggered_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists google_drive_sync_runs_started_idx
  on public.google_drive_sync_runs(started_at desc);

create index if not exists google_drive_sync_runs_triggered_by_idx
  on public.google_drive_sync_runs(triggered_by);

alter table public.google_drive_sync_config enable row level security;
alter table public.google_drive_sync_runs enable row level security;

drop policy if exists google_drive_sync_config_admin on public.google_drive_sync_config;
create policy google_drive_sync_config_admin
  on public.google_drive_sync_config
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists google_drive_sync_runs_admin_select on public.google_drive_sync_runs;
create policy google_drive_sync_runs_admin_select
  on public.google_drive_sync_runs
  for select
  to authenticated
  using (public.is_admin());

revoke all on public.google_drive_sync_config from anon, authenticated;
revoke all on public.google_drive_sync_runs from anon, authenticated;
grant select, insert, update on public.google_drive_sync_config to authenticated;
grant select on public.google_drive_sync_runs to authenticated;

create or replace function public.update_appointment_spreadsheet_fields(
  p_appointment_id uuid,
  p_workshop_observation text,
  p_spreadsheet_status text,
  p_internal_notes text,
  p_event_date date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo Administrador puede cargar cambios desde Google Drive';
  end if;

  if p_spreadsheet_status is not null
    and p_spreadsheet_status not in ('Pendiente', 'Realizada', 'Entregado') then
    raise exception 'Estado de planilla no válido';
  end if;

  perform set_config('app.audit_reason', 'Carga desde Google Drive', true);

  update public.appointments
  set workshop_observation = nullif(trim(p_workshop_observation), ''),
      spreadsheet_status = nullif(trim(p_spreadsheet_status), ''),
      internal_notes = nullif(trim(p_internal_notes), ''),
      event_date = p_event_date,
      updated_by = auth.uid()
  where id = p_appointment_id;

  if not found then
    raise exception 'Cita no encontrada';
  end if;
end;
$$;

revoke all on function public.update_appointment_spreadsheet_fields(uuid,text,text,text,date)
  from public, anon, authenticated;
grant execute on function public.update_appointment_spreadsheet_fields(uuid,text,text,text,date)
  to authenticated;

-- Un administrador puede registrar un sobrecupo por límite diario siempre que
-- deje el motivo. Los cierres, días no laborables y duraciones inválidas siguen
-- siendo bloqueos duros.
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
      or v_reason like 'La cita se cruza%' then
      raise exception '%', v_reason;
    end if;

    if not (v_is_admin and p_allow_overbook) then
      raise exception '%', v_reason;
    end if;
  end if;

  return query
  select p_start_time + make_interval(mins => p_duration_minutes), v_slot_exists;
end;
$$;

revoke all on function public.assert_appointment_allowed_v2(uuid,date,time,integer,boolean,boolean,uuid)
  from public, anon, authenticated;

commit;
