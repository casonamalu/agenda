# Activación de notificaciones por correo

Esta guía activa los correos automáticos de la Agenda Casona Malú usando Supabase y Resend.

## 1. Esperar la confirmación del proveedor DNS

El dominio remitente es:

```text
notificaciones.casonamalu.cl
```

Cuando el proveedor confirme que agregó los registros solicitados:

1. Ingresa a Resend.
2. Abre **Domains**.
3. Selecciona `notificaciones.casonamalu.cl`.
4. Presiona **Verify DNS Records**.
5. Continúa solo cuando el dominio aparezca como **Verified**.

No cambies los servidores DNS de `casonamalu.cl` en NIC Chile. La zona sigue siendo administrada por el proveedor que opera los servidores `cash.ns.cloudflare.com` e `ingrid.ns.cloudflare.com`.

## 2. Ejecutar la migración de notificaciones

En Supabase abre **SQL Editor → New query**, copia todo el contenido de:

```text
supabase/migrations/202607260001_notifications.sql
```

y presiona **Run** una sola vez.

Esta migración agrega los parámetros configurables y las acciones administrativas de reintento y cancelación.

## 3. Revisar la cola acumulada antes de activar envíos

Como la base ya podía crear registros en la cola aunque Resend todavía no estuviera activo, revisa primero:

```sql
select recipient, kind, scheduled_for, status, last_error
from public.email_queue
where status in ('pending', 'retry')
order by scheduled_for;
```

Si los correos inmediatos acumulados corresponden a pruebas o a eventos antiguos, cancélalos y conserva únicamente los recordatorios futuros:

```sql
update public.email_queue
set status = 'cancelled'
where status in ('pending', 'retry')
  and (kind <> 'reminder' or scheduled_for <= now());
```

Esto evita que, al encender el proceso automático, salgan confirmaciones antiguas de forma inesperada.

## 4. Crear la clave de Resend

Con el dominio ya verificado:

1. En Resend abre **API Keys**.
2. Crea una clave para producción.
3. Limita el envío al dominio `notificaciones.casonamalu.cl` si la interfaz ofrece esa opción.
4. Copia la clave una sola vez y no la envíes por correo, WhatsApp ni la guardes en GitHub.

## 5. Configurar secretos en Supabase

Genera además un valor aleatorio largo para `CRON_SECRET`. Debes conservar el
mismo valor en dos ubicaciones: Edge Functions Secrets con nombre
`CRON_SECRET` y Vault con nombre `cron_secret`. Desde Supabase CLI, vinculado
al proyecto, ejecuta:

```bash
supabase secrets set RESEND_API_KEY=re_REEMPLAZAR
supabase secrets set EMAIL_FROM="Agenda Casona Malú <agenda@notificaciones.casonamalu.cl>"
supabase secrets set CRON_SECRET=REEMPLAZAR_POR_UN_VALOR_ALEATORIO_LARGO
```

No uses una clave `service_role`, contraseña de base de datos ni JWT secret como `CRON_SECRET`.

Guarda la misma clave en Vault desde SQL Editor:

```sql
select vault.create_secret(
  'PEGA-AQUI-LA-MISMA-CLAVE',
  'cron_secret',
  'Autorización del procesador automático de correos'
);
```

La clave real no se escribe en `CONFIGURAR_CRON.sql`.

## 6. Desplegar la función

```bash
supabase functions deploy send-email-queue --no-verify-jwt
```

La función exige `x-cron-secret` aunque la validación JWT esté desactivada, porque debe poder ser llamada por el programador interno de Supabase.

## 7. Programar la ejecución

Activa `pg_cron` y `pg_net` en Supabase. Después abre:

```text
docs/CONFIGURAR_CRON.sql
```

El archivo ya contiene el identificador del proyecto y lee el secreto desde
Vault. Ejecútalo una vez. La cola se revisará cada minuto.

## 8. Completar la configuración desde la agenda

Ingresa como Administrador:

1. Abre **Mantenedores → Notificaciones**.
2. Completa teléfono, correo de contacto e Instagram.
3. Revisa las horas del recordatorio y la secuencia de reintentos.
4. Guarda.
5. Abre **Mantenedores → Correos** y revisa los asuntos y textos.

Los cambios quedan en la base de datos y no requieren modificar ni volver a compilar el código.

## 9. Prueba controlada

Usa primero un correo propio:

1. Crea un cliente de prueba con ese correo.
2. Agenda una cita futura.
3. Espera hasta dos minutos.
4. Abre **Correos** y confirma que el registro pase de `Pendiente` a `Enviado`.
5. Comprueba la bandeja de entrada y spam.
6. Reprograma la cita y verifica el segundo correo.
7. Cancela la cita y verifica el tercero.

Si aparece `Fallido`, abre la fila para leer el error. Después de corregir la causa, usa **Reintentar**. No hagas pruebas masivas hasta completar esta validación.

## Resultado esperado

- Confirmación inmediata al agendar.
- Recordatorio previo según las horas configuradas.
- Aviso de reprogramación, cancelación o inasistencia.
- Reintentos automáticos con intervalos configurables.
- Alerta al Administrador después del último intento.
- Recuperación automática de envíos interrumpidos.
- Protección contra duplicados durante los reintentos del proveedor.
