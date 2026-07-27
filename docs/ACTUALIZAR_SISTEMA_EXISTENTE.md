# Actualización final del sistema existente

Esta guía corresponde al sistema Agenda Casona Malú que ya está publicado en
Vercel y conectado al proyecto Supabase:

```text
qaguhjvphiaefsporxgu
```

La actualización conserva los usuarios, clientes y las 114 citas migradas. No
se debe limpiar la base ni volver a ejecutar los archivos de migración de datos.

## Resultado de esta versión

- Máximo diario configurable de 2 pruebas, contando conjuntamente Prueba 1 y
  Prueba 2.
- Máximo diario configurable de 2 entregas.
- Venta disponible en todos sus bloques activos, sin máximo diario adicional.
- Pruebas y entregas siguen compartiendo el espacio físico simultáneo.
- Menú Configuración con Mantenedores, Usuarios, Correos y Auditoría.
- Confirmación visible al crear cierres y prevención de cierres duplicados.
- Indicadores mensuales de carga y capacidad separados en Venta, Pruebas y
  Entrega.
- Reportes programables por día, hora, período, destinatarios, tipos de cita y
  estados.
- Cola de correos con reintentos, control de duplicados y reportes automáticos.

## 1. Respaldar la copia local

La carpeta local utilizada es:

```text
C:\Users\dperel\Downloads\agenda-local
```

Antes de reemplazar archivos:

1. Cierra `npm run dev` con `Ctrl + C`.
2. Copia la carpeta `agenda-local` y nombra la copia
   `agenda-local-respaldo`.
3. Conserva el archivo `.env.local` de la carpeta original.
4. No publiques `.env.local` en GitHub.

## 2. Actualizar los archivos locales

1. Descomprime el paquete final.
2. Abre la carpeta descomprimida `agenda-main`.
3. Copia su contenido dentro de:

```text
C:\Users\dperel\Downloads\agenda-local
```

4. Acepta reemplazar los archivos existentes.
5. No elimines las carpetas `.git` ni el archivo `.env.local` de
   `agenda-local`.

## 3. Probar la actualización localmente

Abre PowerShell y ejecuta:

```powershell
Set-Location "C:\Users\dperel\Downloads\agenda-local"
npm install
npm run typecheck
npm run build
npm run dev
```

Abre:

```text
http://localhost:5173
```

Comprueba:

1. Que puedas iniciar sesión.
2. Que aparezcan las citas y clientes existentes.
3. Que el menú Configuración se despliegue.
4. Que aparezca el módulo Reportes.
5. Que Indicadores muestre Venta, Pruebas y Entrega.
6. Que Mantenedores muestre 2 pruebas y 2 entregas como límites separados.

Detén el servidor con `Ctrl + C`.

## 4. Actualizar Supabase

No vuelvas a ejecutar la migración inicial ni los scripts que importaron las
citas.

En **Supabase → SQL Editor → New query**, ejecuta cada archivo completo, uno
por uno y en este orden:

```text
1. supabase/migrations/202607260001_notifications.sql
2. supabase/migrations/202607260002_daily_capacity_rules.sql
3. supabase/migrations/202607270001_system_improvements.sql
```

Los archivos están preparados para conservar los datos existentes. La tercera
migración elimina únicamente cierres activos exactamente duplicados y deja uno
de ellos vigente.

Al terminar ejecuta:

```sql
select
  public.setting_int('daily_trial_limit', 2) as maximo_diario_pruebas,
  public.setting_int('daily_delivery_limit', 2) as maximo_diario_entregas,
  public.setting_int('shared_space_capacity', 1) as capacidad_simultanea;
```

El resultado esperado es:

```text
maximo_diario_pruebas: 2
maximo_diario_entregas: 2
capacidad_simultanea: 1
```

## 5. Probar las reglas de capacidad

Usa un día futuro de prueba y confirma:

- Prueba 1 + Prueba 2: permitido.
- Prueba 1 + Prueba 1: permitido.
- Una tercera Prueba 1 o Prueba 2: bloqueada.
- Dos entregas: permitido.
- Una tercera entrega: bloqueada.
- Dos pruebas + dos entregas el mismo día: permitido si los horarios no se
  superponen en el espacio compartido.
- Las ventas siguen disponibles en todos los bloques activos.

El Administrador tampoco puede sobrepasar los máximos diarios. Sí puede usar el
sobrecupo para otras restricciones cuando corresponda.

## 6. Publicar el código en GitHub

Si Git funciona en PowerShell:

```powershell
Set-Location "C:\Users\dperel\Downloads\agenda-local"
git status
git add .
git commit -m "Agrega configuraciones indicadores reportes y reglas de capacidad"
git push origin main
```

Si PowerShell muestra que `git` no se reconoce, usa GitHub Desktop o carga los
archivos desde **GitHub → repositorio casonamalu/agenda → Add file → Upload
files**. No cargues `.env.local`, `node_modules` ni `dist`.

## 7. Verificar el despliegue en Vercel

Después del `push`, Vercel debería crear automáticamente un despliegue de
Production.

1. Abre **Vercel → proyecto Agenda → Deployments**.
2. Espera que el último despliegue indique **Ready**.
3. Abre la URL pública que ya configuraste para acceder directamente al login
   de Casona Malú.
4. Prueba en una ventana incógnita.

Las variables deben seguir existiendo en Vercel:

```text
VITE_SUPABASE_URL=https://qaguhjvphiaefsporxgu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

No es necesario cambiar sus valores si el login publicado ya funciona.

## 8. Activar notificaciones cuando Resend esté verificado

No actives todavía el proceso automático si
`notificaciones.casonamalu.cl` continúa pendiente en Resend.

Cuando aparezca **Verified**, sigue:

```text
docs/CONFIGURAR_NOTIFICACIONES.md
```

En resumen:

1. Crea la API Key de Resend.
2. Configura `RESEND_API_KEY`, `EMAIL_FROM` y `CRON_SECRET` como secretos de
   Supabase.
3. Despliega `send-email-queue`.
4. Activa `pg_cron` y `pg_net`.
5. Completa y ejecuta `docs/CONFIGURAR_CRON.sql`.
6. Realiza una prueba controlada con un correo propio.

No escribas la clave de Resend ni `CRON_SECRET` en el código, GitHub, Vercel o
mensajes.

## 9. Validación final

Antes de entregar el sistema al equipo:

1. Inicia sesión con cada rol.
2. Crea, reprograma y cancela una cita de prueba.
3. Confirma los límites de 2 pruebas y 2 entregas.
4. Crea el mismo cierre dos veces y comprueba que el segundo se rechace.
5. Revisa Indicadores para un mes que tenga citas.
6. Crea un reporte programado de prueba.
7. Comprueba el sistema desde computador y teléfono.
8. Elimina o cancela los registros creados para pruebas.

Después de estas verificaciones, el sistema puede comenzar su uso productivo.
