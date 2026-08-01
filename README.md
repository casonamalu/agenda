# Agenda Casona Malú

Aplicación web interna para administrar citas de **Venta, Prueba 1, Prueba 2 y Entrega**. El frontend utiliza React + TypeScript + Vite y los datos se almacenan centralmente en Supabase/PostgreSQL.

Para actualizar la instalación que ya está publicada, sigue primero:

```text
docs/ACTUALIZAR_SISTEMA_EXISTENTE.md
```

El detalle funcional de esta entrega se encuentra en:

```text
docs/BACKLOG_IMPLEMENTADO_20260730.md
```

## Funciones incluidas

- Acceso individual mediante correo y contraseña.
- Roles Administrador, Vendedora y Recepción.
- Cambio obligatorio de contraseña en el primer ingreso.
- Agenda diaria, semanal y mensual.
- Clientes compartidos y detección de coincidencias.
- Bloques horarios configurables de lunes a sábado.
- Duración, colores y capacidades configurables.
- Capacidad diaria configurable: Prueba 1 y Prueba 2 comparten un máximo; Entrega tiene un máximo independiente.
- Ventas disponibles en todos sus bloques diarios, sin consumir la capacidad de pruebas y entregas.
- Feriados y cierres administrables.
- Reprogramación, cancelación, inasistencia, sobrecupo y reserva fuera de bloque.
- Observaciones internas por cita.
- Citas extendidas en intervalos configurables, con validación de todo el tramo.
- Búsqueda global independiente de la vista diaria, semanal o mensual.
- Conservación del módulo, vista y fecha al recargar o renovar la sesión.
- Instagram y autorización de campañas en la ficha de cliente.
- Exportación administrativa de clientes a Excel y CSV con registro de auditoría.
- Resultado de cada cita de Venta e indicador mensual de efectividad comercial.
- Cola de correos, recordatorios configurables, reintentos y alertas administrativas.
- Indicadores mensuales de carga diaria, carga semanal y capacidad por tipo.
- Reportes de agenda programables por día, hora, período, destinatarios y tipos de cita.
- Menú de Configuración agrupado para mantenedores, usuarios, correos y auditoría.
- Prevención de bloqueos de calendario duplicados y confirmación visible al guardar.
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

Si la base inicial ya existe, ejecuta también las migraciones posteriores en orden:

```text
supabase/migrations/202607260001_notifications.sql
supabase/migrations/202607260002_daily_capacity_rules.sql
supabase/migrations/202607270001_system_improvements.sql
supabase/migrations/202607300001_backlog_improvements.sql
```

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

Ingresa como Administrador. En **Mantenedores → Capacidad diaria** se configuran sin modificar código:

- Máximo diario conjunto de Prueba 1 y Prueba 2.
- Máximo diario de Entregas.
- Capacidad simultánea del espacio compartido por pruebas y entregas.
- Incremento y duración máxima de las citas extendidas.
- Inicio y término de jornada y horario de almuerzo.

Las Ventas no tienen un máximo diario adicional y utilizan todos sus bloques activos.
Los máximos diarios de pruebas y entregas son obligatorios y no admiten sobrecupo.

En **Mantenedores → Notificaciones** se configuran:

- Nombre comercial, dirección, teléfono, correo de contacto e Instagram.
- Horas de anticipación del recordatorio.
- Minutos entre reintentos.
- Tamaño máximo del lote de envío.
- Tiempo de recuperación de procesos interrumpidos.
- Alertas al administrador.

Las plantillas y sus textos se editan en **Mantenedores → Correos**.

## 5. Configurar reportes programados

Ingresa como Administrador y abre **Reportes**. Cada programación permite definir:

- Días de la semana y hora de envío.
- Agenda del mismo día, día siguiente o próximos siete días.
- Uno o más destinatarios.
- Todos los tipos de cita o una selección.
- Estados incluidos y envío opcional cuando no existan citas.

El proceso automático revisa las programaciones junto con la cola de correos.

## 6. Desplegar funciones Supabase

Instala e inicia sesión en Supabase CLI. Vincula el proyecto y despliega:

```bash
supabase link --project-ref TU-PROJECT-REF
supabase functions deploy admin-user
supabase functions deploy send-email-queue --no-verify-jwt
```

Configura secretos únicamente en Supabase, nunca en Git:

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxx
supabase secrets set EMAIL_FROM="Agenda Casona Malú <agenda@notificaciones.casonamalu.cl>"
supabase secrets set CRON_SECRET=GENERA-UN-VALOR-ALEATORIO-LARGO
```

Antes de crear la clave de Resend, el dominio `notificaciones.casonamalu.cl` debe aparecer como **Verified**. El correo de contacto configurado en el sistema se utiliza como dirección de respuesta, mientras que `EMAIL_FROM` permanece como secreto de infraestructura.

## 7. Programar correos, reportes y limpieza

Activa las extensiones `pg_cron` y `pg_net` desde Supabase. Luego ejecuta y adapta:

```text
docs/CONFIGURAR_CRON.sql
```

- La cola de correos se procesa cada minuto.
- Los reportes que cumplen su día y hora se incorporan automáticamente a la cola.
- La limpieza se ejecuta mensualmente.
- Cada envío utiliza una clave de idempotencia para disminuir el riesgo de duplicados.
- Los elementos que quedan atascados en `processing` se recuperan automáticamente.
- Desde **Correos** el Administrador puede reintentar un fallo o cancelar un envío pendiente.

La guía completa está en:

```text
docs/CONFIGURAR_NOTIFICACIONES.md
```

## 8. Publicar en Vercel

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
