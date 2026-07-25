-- Ejecutar después de desplegar la Edge Function send-email-queue.
-- Reemplaza los dos valores y guárdalos idealmente mediante Supabase Vault.

select cron.schedule(
  'casona-malu-email-queue',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://TU-PROYECTO.supabase.co/functions/v1/send-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'TU-CRON-SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Limpieza mensual de citas >6 meses y auditoría >12 meses.
select cron.schedule(
  'casona-malu-data-cleanup',
  '15 3 1 * *',
  $$ select public.cleanup_expired_data(); $$
);
