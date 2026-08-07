-- Hotfix de seguridad para producción.
-- Cierra privilegios implícitos de Postgres/Supabase y deja una lista explícita
-- de tablas y RPC disponibles para la aplicación autenticada.

begin;

-- Las funciones nuevas reciben EXECUTE para PUBLIC por defecto en Postgres.
-- Se elimina ese comportamiento para las funciones actuales y futuras.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- El frontend no necesita ninguna función como usuario anónimo.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Reduce los privilegios SQL del usuario autenticado; RLS sigue determinando
-- las filas permitidas dentro de cada operación.
revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
alter default privileges in schema public revoke all on tables from authenticated;
alter default privileges in schema public revoke all on sequences from authenticated;

grant select on public.profiles, public.client_types, public.clients,
  public.appointment_types, public.appointment_slots, public.closures,
  public.app_settings, public.appointments, public.appointment_history,
  public.email_templates, public.email_queue, public.scheduled_reports,
  public.audit_logs
to authenticated;

grant update on public.profiles to authenticated;
grant insert, update on public.clients to authenticated;

grant insert, update, delete on public.client_types, public.appointment_types,
  public.appointment_slots, public.closures, public.app_settings,
  public.email_templates, public.scheduled_reports
to authenticated;

-- Funciones auxiliares utilizadas por RLS.
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_internal_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Única lista de RPC que el frontend Release 2 puede invocar.
grant execute on function public.get_available_slots_v2(uuid,date,integer,uuid) to authenticated;
grant execute on function public.create_appointment_v2(uuid,text,text,text,text,text,uuid,boolean,text,uuid,date,time,integer,text,boolean,boolean,text) to authenticated;
grant execute on function public.reschedule_appointment_v2(uuid,uuid,date,time,integer,text,boolean,boolean,text) to authenticated;
grant execute on function public.change_appointment_status(uuid,public.appointment_status,text) to authenticated;
grant execute on function public.delete_appointment(uuid,text) to authenticated;
grant execute on function public.merge_clients(uuid,uuid,text) to authenticated;
grant execute on function public.set_appointment_commercial_outcome(uuid,text) to authenticated;
grant execute on function public.log_client_export(text,jsonb,integer) to authenticated;
grant execute on function public.get_capacity_by_type_in_range(date,date) to authenticated;
grant execute on function public.reschedule_pending_reminders() to authenticated;
grant execute on function public.retry_email_queue_item(uuid) to authenticated;
grant execute on function public.cancel_email_queue_item(uuid) to authenticated;

-- Fija el search_path de las dos funciones señaladas por Security Advisor.
alter function public.set_updated_at() set search_path = '';
alter function public.normalize_phone(text) set search_path = '';

commit;
