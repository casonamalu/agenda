-- Mejoras operativas para las notificaciones por correo.
-- Ejecutar después de 202607240001_init.sql.

insert into public.app_settings(setting_key, setting_value, description) values
  ('notification_reminder_hours', '24'::jsonb, 'Horas de anticipación del recordatorio'),
  ('notification_retry_minutes', '[5, 30, 120]'::jsonb, 'Minutos de espera entre reintentos'),
  ('notification_batch_size', '20'::jsonb, 'Máximo de correos procesados por ejecución'),
  ('notification_processing_timeout_minutes', '15'::jsonb, 'Minutos para recuperar un correo atascado en procesamiento'),
  ('notification_admin_alerts', 'true'::jsonb, 'Enviar alerta al administrador después del último intento')
on conflict (setting_key) do nothing;

alter table public.email_queue
  add column if not exists idempotency_key uuid not null default gen_random_uuid();

drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

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
  v_timezone text := coalesce(
    (select setting_value #>> '{}' from public.app_settings where setting_key = 'timezone'),
    'America/Santiago'
  );
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

  if new.appointment_date <> old.appointment_date
    or new.start_time <> old.start_time
    or new.appointment_type_id <> old.appointment_type_id then
    update public.email_queue set status = 'cancelled'
      where appointment_id = new.id and status in ('pending', 'retry') and kind = 'reminder';
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

create or replace function public.reschedule_pending_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
  v_reminder_hours integer := greatest(1, public.setting_int('notification_reminder_hours', 24));
  v_timezone text := coalesce(
    (select setting_value #>> '{}' from public.app_settings where setting_key = 'timezone'),
    'America/Santiago'
  );
begin
  if not public.is_admin() then
    raise exception 'Solo Administrador puede reprogramar recordatorios';
  end if;

  update public.email_queue q
  set scheduled_for = greatest(
    now(),
    ((a.appointment_date::text || ' ' || a.start_time::text)::timestamp at time zone v_timezone)
      - make_interval(hours => v_reminder_hours)
  )
  from public.appointments a
  where q.appointment_id = a.id
    and q.kind = 'reminder'
    and q.status in ('pending', 'retry')
    and a.status not in ('cancelled', 'no_show')
    and ((a.appointment_date::text || ' ' || a.start_time::text)::timestamp at time zone v_timezone) > now();

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.retry_email_queue_item(p_queue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo Administrador puede reintentar correos';
  end if;

  update public.email_queue
  set
    status = 'pending',
    scheduled_for = now(),
    attempts = 0,
    last_error = null,
    idempotency_key = gen_random_uuid()
  where id = p_queue_id and status in ('failed', 'retry');

  if not found then
    raise exception 'Correo no encontrado o no disponible para reintento';
  end if;
end;
$$;

create or replace function public.cancel_email_queue_item(p_queue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo Administrador puede cancelar correos';
  end if;

  update public.email_queue
  set status = 'cancelled'
  where id = p_queue_id and status in ('pending', 'retry');

  if not found then
    raise exception 'Correo no encontrado o no disponible para cancelación';
  end if;
end;
$$;

revoke all on function public.reschedule_pending_reminders() from public;
revoke all on function public.retry_email_queue_item(uuid) from public;
revoke all on function public.cancel_email_queue_item(uuid) from public;

grant execute on function public.reschedule_pending_reminders() to authenticated;
grant execute on function public.retry_email_queue_item(uuid) to authenticated;
grant execute on function public.cancel_email_queue_item(uuid) to authenticated;
