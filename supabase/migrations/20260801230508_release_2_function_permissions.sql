-- Cierre explícito de funciones SECURITY DEFINER de Release 2.
-- Supabase puede asignar EXECUTE directamente a anon/authenticated al crear funciones,
-- por lo que revocar solo a PUBLIC no es suficiente.

begin;

revoke all on function public.get_available_slots_v2(uuid,date,integer,uuid) from public, anon, authenticated;
revoke all on function public.create_appointment_v2(uuid,text,text,text,text,text,uuid,boolean,text,uuid,date,time,integer,text,boolean,boolean,text) from public, anon, authenticated;
revoke all on function public.reschedule_appointment_v2(uuid,uuid,date,time,integer,text,boolean,boolean,text) from public, anon, authenticated;
revoke all on function public.set_appointment_commercial_outcome(uuid,text) from public, anon, authenticated;
revoke all on function public.log_client_export(text,jsonb,integer) from public, anon, authenticated;
revoke all on function public.setting_text(text,text) from public, anon, authenticated;
revoke all on function public.slot_availability_reason_v2(uuid,date,time,integer,uuid) from public, anon, authenticated;
revoke all on function public.assert_appointment_allowed_v2(uuid,date,time,integer,boolean,boolean,uuid) from public, anon, authenticated;
revoke all on function public.appointment_email_trigger() from public, anon, authenticated;

grant execute on function public.get_available_slots_v2(uuid,date,integer,uuid) to authenticated;
grant execute on function public.create_appointment_v2(uuid,text,text,text,text,text,uuid,boolean,text,uuid,date,time,integer,text,boolean,boolean,text) to authenticated;
grant execute on function public.reschedule_appointment_v2(uuid,uuid,date,time,integer,text,boolean,boolean,text) to authenticated;
grant execute on function public.set_appointment_commercial_outcome(uuid,text) to authenticated;
grant execute on function public.log_client_export(text,jsonb,integer) to authenticated;

commit;
