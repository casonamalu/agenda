-- Agenda Casona Malú · automatización final de correos y reportes
-- Proyecto: qaguhjvphiaefsporxgu
--
-- Requisitos previos:
-- 1. Edge Function send-email-queue desplegada con --no-verify-jwt.
-- 2. Secretos RESEND_API_KEY, EMAIL_FROM y CRON_SECRET en Edge Functions.
-- 3. La MISMA clave CRON_SECRET guardada en Vault con nombre cron_secret.
-- 4. Extensiones pg_cron y pg_net activas.
--
-- Este archivo NO contiene el valor del secreto. El trabajo lo lee desde Vault.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'casona-malu-email-queue'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$$;

select cron.schedule(
  'casona-malu-email-queue',
  '* * * * *',
  $$
  select public.queue_due_scheduled_reports();

  select net.http_post(
    url := 'https://qaguhjvphiaefsporxgu.supabase.co/functions/v1/send-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

-- La retención se conserva en un trabajo separado.
do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'casona-malu-data-cleanup'
  ) then
    perform cron.schedule(
      'casona-malu-data-cleanup',
      '15 3 1 * *',
      'select public.cleanup_expired_data();'
    );
  end if;
end;
$$;

-- Verificación: el primer trabajo debe mostrar "* * * * *" y active = true.
select jobid, jobname, schedule, active
from cron.job
where jobname in ('casona-malu-email-queue', 'casona-malu-data-cleanup')
order by jobname;
