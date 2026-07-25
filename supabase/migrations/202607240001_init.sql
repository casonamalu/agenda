-- Casona Malú - Esquema inicial Supabase/PostgreSQL
-- Ejecutar en un proyecto Supabase nuevo mediante SQL Editor o Supabase CLI.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'seller', 'reception');
create type public.appointment_status as enum ('scheduled', 'rescheduled', 'cancelled', 'no_show');
create type public.appointment_category as enum ('sale', 'trial', 'delivery');
create type public.notification_status as enum ('pending', 'processing', 'sent', 'retry', 'failed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.app_role not null default 'reception',
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  client_type_id uuid not null references public.client_types(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_email_format check (position('@' in email) > 1)
);
create unique index clients_email_unique_ci on public.clients (lower(email));
create index clients_phone_idx on public.clients (phone);
create index clients_name_idx on public.clients (lower(last_name), lower(first_name));

create table public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category public.appointment_category not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  color text not null default '#7f3f52' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  capacity_per_slot integer not null default 1 check (capacity_per_slot >= 1),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointment_slots (
  id uuid primary key default gen_random_uuid(),
  appointment_type_id uuid not null references public.appointment_types(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 6),
  start_time time not null,
  active boolean not null default true,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_type_id, weekday, start_time, valid_from)
);
create index appointment_slots_lookup_idx on public.appointment_slots (appointment_type_id, weekday, start_time) where active;

create table public.closures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  closure_type text not null check (closure_type in ('legal_holiday', 'special_closure', 'vacation', 'internal_activity')),
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint closures_date_order check (end_date >= start_date),
  constraint closures_time_valid check (all_day or (start_time is not null and end_time is not null and end_time > start_time))
);
create index closures_dates_idx on public.closures (start_date, end_date) where active;

create table public.app_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  description text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  appointment_type_id uuid not null references public.appointment_types(id),
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  status public.appointment_status not null default 'scheduled',
  internal_notes text,
  is_overbook boolean not null default false,
  is_out_of_slot boolean not null default false,
  exception_reason text,
  cancellation_reason text,
  source text not null default 'manual' check (source in ('manual', 'migration')),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_time_order check (end_time > start_time),
  constraint appointment_exception_reason check ((not is_overbook and not is_out_of_slot) or exception_reason is not null)
);
create index appointments_date_time_idx on public.appointments (appointment_date, start_time);
create index appointments_client_idx on public.appointments (client_id, appointment_date desc);
create index appointments_active_overlap_idx on public.appointments (appointment_date, start_time, end_time) where status not in ('cancelled');

create table public.appointment_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  action text not null,
  old_date date,
  old_start_time time,
  new_date date,
  new_start_time time,
  old_status public.appointment_status,
  new_status public.appointment_status,
  reason text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  name text not null,
  subject text not null,
  body_html text not null,
  active boolean not null default true,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_queue (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  recipient text not null,
  kind text not null check (kind in ('appointment_created', 'reminder', 'rescheduled', 'cancelled', 'no_show', 'report', 'alert')),
  scheduled_for timestamptz not null,
  status public.notification_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_queue_due_idx on public.email_queue (status, scheduled_for) where status in ('pending', 'retry');
create index email_queue_appointment_idx on public.email_queue (appointment_id);

create table public.scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  weekdays smallint[] not null default array[1,2,3,4,5,6]::smallint[],
  send_time time not null,
  recipients text[] not null,
  period_type text not null check (period_type in ('today', 'tomorrow', 'week', 'custom')),
  appointment_type_ids uuid[],
  statuses public.appointment_status[],
  selected_fields text[] not null default array['date','time','appointment_type','client_name','phone']::text[],
  send_empty boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index audit_logs_changed_at_idx on public.audit_logs (changed_at desc);
create index audit_logs_table_idx on public.audit_logs (table_name, changed_at desc);

-- Funciones comunes
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger client_types_updated_at before update on public.client_types for each row execute function public.set_updated_at();
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger appointment_types_updated_at before update on public.appointment_types for each row execute function public.set_updated_at();
create trigger appointment_slots_updated_at before update on public.appointment_slots for each row execute function public.set_updated_at();
create trigger closures_updated_at before update on public.closures for each row execute function public.set_updated_at();
create trigger appointments_updated_at before update on public.appointments for each row execute function public.set_updated_at();
create trigger email_templates_updated_at before update on public.email_templates for each row execute function public.set_updated_at();
create trigger email_queue_updated_at before update on public.email_queue for each row execute function public.set_updated_at();
create trigger scheduled_reports_updated_at before update on public.scheduled_reports for each row execute function public.set_updated_at();

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true;
$$;

create or replace function public.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active = true);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active = true and role = 'admin');
$$;

create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
$$;

-- Perfil automático para usuarios creados en Supabase Auth.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := 'reception';
  v_active boolean := false;
  v_must_change boolean := true;
begin
  begin
    if new.raw_user_meta_data ? 'role' then
      v_role := (new.raw_user_meta_data ->> 'role')::public.app_role;
    end if;
  exception when others then
    v_role := 'reception';
  end;

  if new.raw_user_meta_data ? 'active' then
    v_active := coalesce((new.raw_user_meta_data ->> 'active')::boolean, false);
  end if;
  if new.raw_user_meta_data ? 'must_change_password' then
    v_must_change := coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, true);
  end if;

  insert into public.profiles (id, full_name, email, role, active, must_change_password)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, 'usuario'), '@', 1)),
    coalesce(new.email, ''),
    v_role,
    v_active,
    v_must_change
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Impide que un usuario común se eleve de rol mediante la API.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and not public.is_admin() then
    new.role := old.role;
    new.active := old.active;
    new.email := old.email;
    new.full_name := old.full_name;
  end if;
  return new;
end;
$$;
create trigger protect_profile_fields_trigger before update on public.profiles for each row execute function public.protect_profile_fields();

-- Auditoría genérica.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id uuid;
  v_reason text := nullif(current_setting('app.audit_reason', true), '');
begin
  if tg_op = 'DELETE' then
    v_record_id := old.id;
    insert into public.audit_logs(table_name, record_id, action, old_data, reason, changed_by)
    values (tg_table_name, v_record_id, 'DELETE', to_jsonb(old), v_reason, auth.uid());
    return old;
  elsif tg_op = 'UPDATE' then
    v_record_id := new.id;
    insert into public.audit_logs(table_name, record_id, action, old_data, new_data, reason, changed_by)
    values (tg_table_name, v_record_id, 'UPDATE', to_jsonb(old), to_jsonb(new), v_reason, auth.uid());
    return new;
  else
    v_record_id := new.id;
    insert into public.audit_logs(table_name, record_id, action, new_data, reason, changed_by)
    values (tg_table_name, v_record_id, 'INSERT', to_jsonb(new), v_reason, auth.uid());
    return new;
  end if;
end;
$$;

create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function public.audit_row_change();
create trigger audit_clients after insert or update or delete on public.clients for each row execute function public.audit_row_change();
create trigger audit_appointments after insert or update or delete on public.appointments for each row execute function public.audit_row_change();
create trigger audit_appointment_types after insert or update or delete on public.appointment_types for each row execute function public.audit_row_change();
create trigger audit_slots after insert or update or delete on public.appointment_slots for each row execute function public.audit_row_change();
create trigger audit_closures after insert or update or delete on public.closures for each row execute function public.audit_row_change();
create trigger audit_templates after insert or update or delete on public.email_templates for each row execute function public.audit_row_change();

create or replace function public.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (setting_value #>> '{}')::integer from public.app_settings where setting_key = p_key), p_default);
$$;

create or replace function public.is_closed_at(p_date date, p_start time, p_end time)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.closures c
    where c.active
      and p_date between c.start_date and c.end_date
      and (
        c.all_day
        or (p_start < c.end_time and p_end > c.start_time)
      )
  );
$$;

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
  v_daily_limit integer := public.setting_int('daily_trial_delivery_limit', 3);
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

  select count(*) into v_overlap_count
  from public.appointments a
  where a.appointment_date = p_date
    and a.status <> 'cancelled'
    and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
    and a.start_time < v_end_time
    and a.end_time > p_start_time;
  if v_overlap_count >= v_shared_capacity then return 'Espacio compartido ocupado'; end if;

  select count(*) into v_type_overlap_count
  from public.appointments a
  where a.appointment_date = p_date
    and a.appointment_type_id = p_appointment_type_id
    and a.status <> 'cancelled'
    and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
    and a.start_time < v_end_time
    and a.end_time > p_start_time;
  if v_type_overlap_count >= v_type_capacity then return 'Capacidad del tipo de cita completa'; end if;

  if v_category in ('trial', 'delivery') then
    select count(*) into v_daily_count
    from public.appointments a
    join public.appointment_types t on t.id = a.appointment_type_id
    where a.appointment_date = p_date
      and a.status <> 'cancelled'
      and t.category in ('trial', 'delivery')
      and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id);
    if v_daily_count >= v_daily_limit then return 'Límite diario de pruebas y entregas'; end if;
  end if;

  return null;
end;
$$;

create or replace function public.get_available_slots(
  p_appointment_type_id uuid,
  p_date date,
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
    s.start_time + make_interval(mins => t.duration_minutes) as end_time,
    public.slot_availability_reason(t.id, p_date, s.start_time, p_exclude_appointment_id) is null as available,
    public.slot_availability_reason(t.id, p_date, s.start_time, p_exclude_appointment_id) as reason,
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
  select duration_minutes into v_duration from public.appointment_types where id = p_appointment_type_id and active;
  if v_duration is null then raise exception 'Tipo de cita no válido'; end if;
  if extract(isodow from p_date) not between 1 and 6 then raise exception 'Las citas solo pueden agendarse de lunes a sábado'; end if;

  select exists(
    select 1 from public.appointment_slots s
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

  v_reason := public.slot_availability_reason(p_appointment_type_id, p_date, p_start_time, p_exclude_appointment_id);
  if v_reason is not null then
    if v_reason = 'Feriado o cierre' or v_reason = 'Día no laborable' then
      raise exception '%', v_reason;
    end if;
    if not (v_is_admin and p_allow_overbook) then
      raise exception '%', v_reason;
    end if;
  end if;

  return query select p_start_time + make_interval(mins => v_duration), v_slot_exists;
end;
$$;

create or replace function public.create_appointment(
  p_existing_client_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_client_type_id uuid,
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
set search_path = public
as $$
declare
  v_client_id uuid;
  v_end_time time;
  v_regular boolean;
  v_appointment_id uuid;
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;
  if (p_allow_out_of_slot or p_allow_overbook) and (not public.is_admin() or nullif(trim(p_exception_reason), '') is null) then
    raise exception 'La excepción requiere perfil Administrador y un motivo';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_date::text));
  select a.end_time, a.is_regular_slot into v_end_time, v_regular
  from public.assert_appointment_allowed(p_appointment_type_id, p_date, p_start_time, p_allow_out_of_slot, p_allow_overbook, null) a;

  if p_existing_client_id is not null then
    select id into v_client_id from public.clients where id = p_existing_client_id;
    if v_client_id is null then raise exception 'Cliente no encontrado'; end if;
  else
    if nullif(trim(p_first_name), '') is null or nullif(trim(p_last_name), '') is null then raise exception 'Nombre y apellido son obligatorios'; end if;
    if nullif(trim(p_email), '') is null or position('@' in p_email) <= 1 then raise exception 'Correo inválido'; end if;
    if length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 8 then raise exception 'Número de contacto inválido'; end if;

    select id into v_client_id
    from public.clients
    where lower(email) = lower(trim(p_email))
       or public.normalize_phone(phone) = public.normalize_phone(p_phone)
    order by case when lower(email) = lower(trim(p_email)) then 0 else 1 end
    limit 1;

    if v_client_id is null then
      insert into public.clients(first_name, last_name, email, phone, client_type_id, created_by, updated_by)
      values (trim(p_first_name), trim(p_last_name), lower(trim(p_email)), trim(p_phone), p_client_type_id, auth.uid(), auth.uid())
      returning id into v_client_id;
    end if;
  end if;

  perform set_config('app.audit_reason', coalesce(p_exception_reason, 'Creación de cita'), true);
  insert into public.appointments(
    client_id, appointment_type_id, appointment_date, start_time, end_time, status,
    internal_notes, is_overbook, is_out_of_slot, exception_reason, created_by, updated_by
  ) values (
    v_client_id, p_appointment_type_id, p_date, p_start_time, v_end_time, 'scheduled',
    nullif(trim(p_internal_notes), ''), p_allow_overbook, not v_regular, nullif(trim(p_exception_reason), ''), auth.uid(), auth.uid()
  ) returning id into v_appointment_id;

  insert into public.appointment_history(appointment_id, action, new_date, new_start_time, new_status, reason, changed_by)
  values (v_appointment_id, 'created', p_date, p_start_time, 'scheduled', p_exception_reason, auth.uid());
  return v_appointment_id;
end;
$$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_appointment_type_id uuid,
  p_date date,
  p_start_time time,
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
  if (p_allow_out_of_slot or p_allow_overbook) and (not public.is_admin() or nullif(trim(p_exception_reason), '') is null) then
    raise exception 'La excepción requiere perfil Administrador y un motivo';
  end if;

  select * into v_old from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'Cita no encontrada'; end if;
  perform pg_advisory_xact_lock(hashtext(p_date::text));

  select a.end_time, a.is_regular_slot into v_end_time, v_regular
  from public.assert_appointment_allowed(p_appointment_type_id, p_date, p_start_time, p_allow_out_of_slot, p_allow_overbook, p_appointment_id) a;

  v_status := case
    when v_old.appointment_date <> p_date or v_old.start_time <> p_start_time or v_old.appointment_type_id <> p_appointment_type_id
      then 'rescheduled'::public.appointment_status
    else v_old.status
  end;

  perform set_config('app.audit_reason', coalesce(p_exception_reason, 'Modificación de cita'), true);
  update public.appointments set
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
    appointment_id, action, old_date, old_start_time, new_date, new_start_time, old_status, new_status, reason, changed_by
  ) values (
    p_appointment_id, 'updated', v_old.appointment_date, v_old.start_time, p_date, p_start_time, v_old.status, v_status, p_exception_reason, auth.uid()
  );
end;
$$;

create or replace function public.change_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.appointments%rowtype;
begin
  if not public.is_internal_user() then raise exception 'Usuario no autorizado'; end if;
  if p_status not in ('cancelled', 'no_show') then raise exception 'Estado no permitido mediante esta acción'; end if;
  if p_status = 'cancelled' and nullif(trim(p_reason), '') is null then raise exception 'Motivo de cancelación obligatorio'; end if;
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'Cita no encontrada'; end if;

  perform set_config('app.audit_reason', coalesce(p_reason, 'Cambio de estado'), true);
  update public.appointments set
    status = p_status,
    cancellation_reason = case when p_status = 'cancelled' then trim(p_reason) else cancellation_reason end,
    updated_by = auth.uid()
  where id = p_appointment_id;

  insert into public.appointment_history(appointment_id, action, old_date, old_start_time, new_date, new_start_time, old_status, new_status, reason, changed_by)
  values (p_appointment_id, 'status_changed', v_old.appointment_date, v_old.start_time, v_old.appointment_date, v_old.start_time, v_old.status, p_status, p_reason, auth.uid());
end;
$$;

create or replace function public.delete_appointment(p_appointment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Solo Administrador puede eliminar citas'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Motivo obligatorio'; end if;
  perform set_config('app.audit_reason', trim(p_reason), true);
  delete from public.appointments where id = p_appointment_id;
  if not found then raise exception 'Cita no encontrada'; end if;
end;
$$;

create or replace function public.merge_clients(p_source_client_id uuid, p_target_client_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Solo Administrador puede fusionar clientes'; end if;
  if p_source_client_id = p_target_client_id then raise exception 'Los clientes deben ser distintos'; end if;
  if not exists(select 1 from public.clients where id = p_source_client_id) or not exists(select 1 from public.clients where id = p_target_client_id) then
    raise exception 'Cliente no encontrado';
  end if;
  perform set_config('app.audit_reason', coalesce(p_reason, 'Fusión de clientes'), true);
  update public.appointments set client_id = p_target_client_id, updated_by = auth.uid() where client_id = p_source_client_id;
  delete from public.clients where id = p_source_client_id;
end;
$$;

create or replace function public.count_available_slots_in_range(p_from date, p_to date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with dates as (
    select day::date as day
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') day
    where extract(isodow from day) between 1 and 6
  )
  select count(*)
  from dates d
  join public.appointment_slots s on s.weekday = extract(isodow from d.day)::smallint and s.active
  join public.appointment_types t on t.id = s.appointment_type_id and t.active
  where (s.valid_from is null or s.valid_from <= d.day)
    and (s.valid_to is null or s.valid_to >= d.day)
    and not public.is_closed_at(d.day, s.start_time, s.start_time + make_interval(mins => t.duration_minutes));
$$;

-- Cola automática de correos.
create or replace function public.queue_appointment_email(p_appointment_id uuid, p_kind text, p_scheduled_for timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select c.email into v_email
  from public.appointments a join public.clients c on c.id = a.client_id
  where a.id = p_appointment_id;
  if v_email is null then return; end if;
  if exists (
    select 1 from public.email_queue
    where appointment_id = p_appointment_id and kind = p_kind and scheduled_for = p_scheduled_for and status <> 'cancelled'
  ) then return; end if;
  insert into public.email_queue(appointment_id, recipient, kind, scheduled_for)
  values (p_appointment_id, v_email, p_kind, p_scheduled_for);
end;
$$;

create or replace function public.appointment_email_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_reminder timestamptz;
begin
  if tg_op = 'INSERT' then
    v_start := (new.appointment_date::text || ' ' || new.start_time::text)::timestamp at time zone 'America/Santiago';
    v_reminder := v_start - interval '24 hours';
    if new.source = 'manual' then
      perform public.queue_appointment_email(new.id, 'appointment_created', now());
    end if;
    if v_reminder > now() then perform public.queue_appointment_email(new.id, 'reminder', v_reminder); end if;
    return new;
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.email_queue set status = 'cancelled'
      where appointment_id = new.id and status in ('pending', 'retry') and kind = 'reminder';
    perform public.queue_appointment_email(new.id, 'cancelled', now());
    return new;
  end if;

  if new.status = 'no_show' and old.status <> 'no_show' then
    update public.email_queue set status = 'cancelled'
      where appointment_id = new.id and status in ('pending', 'retry') and kind = 'reminder';
    perform public.queue_appointment_email(new.id, 'no_show', now());
    return new;
  end if;

  if new.appointment_date <> old.appointment_date or new.start_time <> old.start_time or new.appointment_type_id <> old.appointment_type_id then
    update public.email_queue set status = 'cancelled'
      where appointment_id = new.id and status in ('pending', 'retry') and kind = 'reminder';
    perform public.queue_appointment_email(new.id, 'rescheduled', now());
    v_start := (new.appointment_date::text || ' ' || new.start_time::text)::timestamp at time zone 'America/Santiago';
    v_reminder := v_start - interval '24 hours';
    if v_reminder > now() then perform public.queue_appointment_email(new.id, 'reminder', v_reminder); end if;
  end if;
  return new;
end;
$$;
create trigger appointment_email_queue_trigger after insert or update on public.appointments for each row execute function public.appointment_email_trigger();

-- Limpieza automática: citas >6 meses y auditoría >12 meses.
create or replace function public.cleanup_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointments integer;
  v_audit integer;
begin
  perform set_config('app.audit_reason', 'Limpieza automática por retención', true);
  delete from public.appointments where appointment_date < current_date - make_interval(months => public.setting_int('appointment_retention_months', 6));
  get diagnostics v_appointments = row_count;
  delete from public.audit_logs where changed_at < now() - make_interval(months => public.setting_int('audit_retention_months', 12));
  get diagnostics v_audit = row_count;
  return jsonb_build_object('appointments_deleted', v_appointments, 'audit_deleted', v_audit, 'executed_at', now());
end;
$$;

-- Datos iniciales.
insert into public.client_types(name, display_order) values
  ('Novia', 1), ('Madrina', 2), ('Graduación', 3), ('Hombre', 4);

insert into public.appointment_types(name, category, duration_minutes, color, capacity_per_slot, sort_order) values
  ('Venta', 'sale', 45, '#7f3f52', 1, 1),
  ('Prueba 1', 'trial', 15, '#b66f83', 1, 2),
  ('Prueba 2', 'trial', 15, '#a98b54', 1, 3),
  ('Entrega', 'delivery', 15, '#3f7f70', 1, 4);

-- Bloques de lunes a sábado.
insert into public.appointment_slots(appointment_type_id, weekday, start_time)
select t.id, d.weekday, h.start_time
from public.appointment_types t
cross join (values (1),(2),(3),(4),(5),(6)) as d(weekday)
cross join lateral (
  select unnest(case when t.category = 'sale'
    then array['10:00','11:00','12:00','13:00','15:00','16:00','17:00','18:00']::time[]
    else array['10:45','11:45','12:45','13:45','15:45','16:45','17:45']::time[]
  end) as start_time
) h;

insert into public.app_settings(setting_key, setting_value, description) values
  ('business_name', '"Casona Malú"'::jsonb, 'Nombre comercial'),
  ('address', '"Av. Rancagua 187"'::jsonb, 'Dirección fija'),
  ('contact_phone', '"CONFIGURAR"'::jsonb, 'Número de contacto'),
  ('contact_email', '"CONFIGURAR"'::jsonb, 'Correo de contacto'),
  ('instagram', '"CONFIGURAR"'::jsonb, 'Cuenta de Instagram'),
  ('timezone', '"America/Santiago"'::jsonb, 'Zona horaria'),
  ('shared_space_capacity', '1'::jsonb, 'Capacidad simultánea del espacio compartido'),
  ('daily_trial_delivery_limit', '3'::jsonb, 'Máximo conjunto diario de pruebas y entregas'),
  ('appointment_retention_months', '6'::jsonb, 'Retención de citas'),
  ('audit_retention_months', '12'::jsonb, 'Retención de auditoría');

insert into public.email_templates(template_key, name, subject, body_html) values
('appointment_created', 'Nueva cita', 'Información de cita – Casona Malú',
 '<p>Hola {{nombre}},</p><p>Tu cita ha sido agendada.</p><p><strong>Tipo:</strong> {{tipo_cita}}<br><strong>Fecha:</strong> {{fecha}}<br><strong>Hora:</strong> {{hora}}<br><strong>Dirección:</strong> {{direccion}}</p><p><strong>Importante:</strong> Casona Malú no cuenta con estacionamiento. Para citas de prueba, asiste con el mismo calzado y sostén que utilizarás en tu evento.</p><p>Contacto: {{telefono}} · {{correo_contacto}} · Instagram {{instagram}}</p>'),
('reminder', 'Recordatorio 24 horas', 'Recordatorio de cita – Casona Malú',
 '<p>Hola {{nombre}},</p><p>Te recordamos tu cita de <strong>{{tipo_cita}}</strong> para el {{fecha}} a las {{hora}}.</p><p>Dirección: {{direccion}}. No contamos con estacionamiento.</p>'),
('rescheduled', 'Cita reprogramada', 'Tu cita fue reprogramada – Casona Malú',
 '<p>Hola {{nombre}},</p><p>Tu cita fue reprogramada.</p><p><strong>Nueva fecha:</strong> {{fecha}}<br><strong>Nueva hora:</strong> {{hora}}<br><strong>Tipo:</strong> {{tipo_cita}}</p>'),
('cancelled', 'Cita cancelada', 'Cita cancelada – Casona Malú',
 '<p>Hola {{nombre}},</p><p>Tu cita de {{tipo_cita}} programada para el {{fecha}} a las {{hora}} fue cancelada.</p><p>Para solicitar una nueva hora, comunícate con nosotros.</p>'),
('no_show', 'No asistió', 'Agenda una nueva cita – Casona Malú',
 '<p>Hola {{nombre}},</p><p>Registramos que no pudiste asistir a tu cita del {{fecha}} a las {{hora}}.</p><p>Comunícate con Casona Malú para agendar una nueva cita.</p>');

-- Seguridad RLS.
alter table public.profiles enable row level security;
alter table public.client_types enable row level security;
alter table public.clients enable row level security;
alter table public.appointment_types enable row level security;
alter table public.appointment_slots enable row level security;
alter table public.closures enable row level security;
alter table public.app_settings enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_history enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_queue enable row level security;
alter table public.scheduled_reports enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select_internal on public.profiles for select to authenticated using (public.is_internal_user());
create policy profiles_update_own_or_admin on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy client_types_select_internal on public.client_types for select to authenticated using (public.is_internal_user());
create policy client_types_admin_all on public.client_types for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy clients_select_internal on public.clients for select to authenticated using (public.is_internal_user());
create policy clients_insert_internal on public.clients for insert to authenticated with check (public.is_internal_user());
create policy clients_update_internal on public.clients for update to authenticated using (public.is_internal_user()) with check (public.is_internal_user());

create policy appointment_types_select_internal on public.appointment_types for select to authenticated using (public.is_internal_user());
create policy appointment_types_admin_all on public.appointment_types for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy appointment_slots_select_internal on public.appointment_slots for select to authenticated using (public.is_internal_user());
create policy appointment_slots_admin_all on public.appointment_slots for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy closures_select_internal on public.closures for select to authenticated using (public.is_internal_user());
create policy closures_admin_all on public.closures for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy app_settings_select_internal on public.app_settings for select to authenticated using (public.is_internal_user());
create policy app_settings_admin_all on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy appointments_select_internal on public.appointments for select to authenticated using (public.is_internal_user());
create policy history_select_internal on public.appointment_history for select to authenticated using (public.is_internal_user());

create policy templates_select_internal on public.email_templates for select to authenticated using (public.is_internal_user());
create policy templates_admin_all on public.email_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy email_queue_admin_select on public.email_queue for select to authenticated using (public.is_admin());
create policy reports_admin_all on public.scheduled_reports for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy audit_admin_select on public.audit_logs for select to authenticated using (public.is_admin());

-- Funciones disponibles para usuarios autenticados.
revoke all on function public.create_appointment(uuid,text,text,text,text,uuid,uuid,date,time,text,boolean,boolean,text) from public;
revoke all on function public.reschedule_appointment(uuid,uuid,date,time,text,boolean,boolean,text) from public;
revoke all on function public.change_appointment_status(uuid,public.appointment_status,text) from public;
revoke all on function public.delete_appointment(uuid,text) from public;
revoke all on function public.merge_clients(uuid,uuid,text) from public;

grant execute on function public.create_appointment(uuid,text,text,text,text,uuid,uuid,date,time,text,boolean,boolean,text) to authenticated;
grant execute on function public.reschedule_appointment(uuid,uuid,date,time,text,boolean,boolean,text) to authenticated;
grant execute on function public.change_appointment_status(uuid,public.appointment_status,text) to authenticated;
grant execute on function public.delete_appointment(uuid,text) to authenticated;
grant execute on function public.merge_clients(uuid,uuid,text) to authenticated;
grant execute on function public.get_available_slots(uuid,date,uuid) to authenticated;
grant execute on function public.count_available_slots_in_range(date,date) to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_internal_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- No habilitar registros públicos. Crear usuarios solo desde el panel administrativo/Edge Function.

-- Privilegios SQL; RLS determina qué filas y operaciones son efectivamente válidas.
grant usage on schema public to authenticated;
grant select on public.profiles, public.client_types, public.clients, public.appointment_types,
  public.appointment_slots, public.closures, public.app_settings, public.appointments,
  public.appointment_history, public.email_templates, public.email_queue,
  public.scheduled_reports, public.audit_logs to authenticated;
grant update on public.profiles to authenticated;
grant insert, update on public.clients to authenticated;
grant insert, update, delete on public.client_types, public.appointment_types,
  public.appointment_slots, public.closures, public.app_settings,
  public.email_templates, public.scheduled_reports to authenticated;
