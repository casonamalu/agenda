# Agenda Casona Malú

Aplicación web interna para administrar citas de **Venta, Prueba 1, Prueba 2 y Entrega**. El frontend utiliza React + TypeScript + Vite y los datos se almacenan centralmente en Supabase/PostgreSQL.

## Funciones incluidas

- Acceso individual mediante correo y contraseña.
- Roles Administrador, Vendedora y Recepción.
- Cambio obligatorio de contraseña en el primer ingreso.
- Agenda diaria, semanal y mensual.
- Clientes compartidos y detección de coincidencias.
- Bloques horarios configurables de lunes a sábado.
- Duración, colores y capacidades configurables.
- Control del espacio compartido y máximo diario de pruebas/entregas.
- Feriados y cierres administrables.
- Reprogramación, cancelación, inasistencia, sobrecupo y reserva fuera de bloque.
- Observaciones internas por cita.
- Cola de correos, recordatorios 24 horas antes y reintentos.
- Indicadores, clientes, usuarios, mantenedores y auditoría.
- Retención automática: citas 6 meses y auditoría 12 meses.

## Estructura

```text
src/                         Frontend React/TypeScript
supabase/migrations/         Esquema, seguridad, funciones y datos iniciales
supabase/functions/          Funciones de usuarios y envío de correos
docs/                        Configuración de Cron y plantilla de migración
```

## Requisitos

- Node.js 22.12 o superior.
- Cuenta de GitHub.
- Proyecto en Supabase.
- Cuenta Resend para correos transaccionales.
- Vercel, Cloudflare Pages u otro hosting compatible con Vite.

## 1. Crear la base de datos

1. Crea un proyecto nuevo en Supabase.
2. Abre **SQL Editor**.
3. Ejecuta todo el archivo:

```text
supabase/migrations/202607240001_init.sql
```

El script crea tablas, RLS, funciones, bloques horarios, tipos de cita, tipos de cliente y plantillas de correo.

## 2. Crear el primer Administrador

En Supabase entra a **Authentication → Users → Add user** y crea el usuario inicial con correo y contraseña temporal.

Después ejecuta en SQL Editor:

```sql
update public.profiles
set
  full_name = 'Administrador Casona Malú',
  role = 'admin',
  active = true,
  must_change_password = true
where email = 'CORREO-DEL-ADMINISTRADOR';
```

No escribas contraseñas en archivos del repositorio.

## 3. Configurar el frontend

Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Completa:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REEMPLAZAR
```

La **publishable key** se utiliza en el navegador y la seguridad real depende de las políticas RLS. Nunca uses `service_role` en el frontend.

Instala y ejecuta:

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`.

## 4. Configurar valores de Casona Malú

En SQL Editor actualiza los parámetros pendientes:

```sql
update public.app_settings set setting_value = to_jsonb('+56 9 XXXX XXXX'::text) where setting_key = 'contact_phone';
update public.app_settings set setting_value = to_jsonb('contacto@casonamalu.cl'::text) where setting_key = 'contact_email';
update public.app_settings set setting_value = to_jsonb('@casonamalu'::text) where setting_key = 'instagram';
```

La dirección inicial se dejó como `Av. Rancagua 187`.

## 5. Desplegar funciones Supabase

Instala e inicia sesión en Supabase CLI. Vincula el proyecto y despliega:

```bash
supabase link --project-ref TU-PROJECT-REF
supabase functions deploy admin-user
supabase functions deploy send-email-queue --no-verify-jwt
```

Configura secretos únicamente en Supabase, nunca en Git:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxx
supabase secrets set EMAIL_FROM="Casona Malú <agenda@tudominio.cl>"
supabase secrets set CRON_SECRET=GENERA-UN-VALOR-ALEATORIO-LARGO
```

## 6. Programar correos y limpieza

Activa las extensiones `pg_cron` y `pg_net` desde Supabase. Luego ejecuta y adapta:

```text
docs/CONFIGURAR_CRON.sql
```

- La cola de correos se procesa cada cinco minutos.
- La limpieza se ejecuta mensualmente.

## 7. Publicar en Vercel

1. Sube la carpeta a un repositorio GitHub.
2. Importa el repositorio en Vercel.
3. Agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en **Environment Variables**.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Conecta el subdominio, por ejemplo `agenda.casonamalu.cl`.

## Seguridad

- `.env` está ignorado por Git.
- `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` y `CRON_SECRET` solo deben vivir en Supabase/Vercel Secrets.
- La aplicación no contiene usuarios ni contraseñas demostrativas.
- Las modificaciones de citas se ejecutan mediante funciones PostgreSQL que validan concurrencia, capacidad, cierres y permisos.
- RLS impide que un usuario inactivo o externo consulte información.

## Migración

`docs/PLANTILLA_MIGRACION.csv` contiene las columnas esperadas. Antes de importar, deben normalizarse correos, teléfonos, tipos de cliente, tipos de cita, fechas y horarios. La automatización de la carga se realiza después de revisar una copia real de la planilla.

## Comandos

```bash
npm run dev        # desarrollo
npm run typecheck  # validación TypeScript
npm run build      # compilación de producción
npm run preview    # revisar el build local
```
