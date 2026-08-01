# Actualización del backlog operativo

Esta guía actualiza la Agenda Casona Malú existente conectada al proyecto
Supabase `qaguhjvphiaefsporxgu`. Conserva las 115 citas, clientes, usuarios,
configuraciones, correos e historial. No limpia la base y no repite la
migración de datos.

## Qué incorpora

- Orden fijo de indicadores: Venta, Prueba 1, Prueba 2 y Entrega.
- Resultado de cada cita de Venta: concretada, rechazada o posible.
- Indicador mensual de efectividad comercial.
- Búsqueda global de citas, independiente de la vista diaria, semanal o mensual.
- Conservación del módulo, vista y fecha al minimizar, recargar o renovar sesión.
- Instagram y autorización de campañas en la ficha de cliente.
- Filtros y exportación administrativa de clientes a Excel o CSV, con auditoría.
- Citas extendidas en intervalos configurables, validando todo el tramo.
- Horario completo en correos cuando una cita tiene duración extendida.
- Documentación final del proceso automático de correo con Vault y ejecución
  cada minuto.

## 1. Preparar y respaldar la carpeta local

La carpeta de trabajo es:

```text
C:\Users\dperel\Downloads\agenda-local
```

1. Si `npm run dev` está activo, vuelve a esa ventana de PowerShell y presiona
   `Ctrl + C`.
2. En el Explorador de archivos copia la carpeta completa `agenda-local`.
3. Pega la copia en `C:\Users\dperel\Downloads` y nómbrala, por ejemplo:

```text
agenda-local-respaldo-antes-backlog
```

4. No borres de la carpeta original:

```text
.git
.env.local
```

La copia es solo un respaldo. Todos los pasos siguientes se ejecutan en
`agenda-local`.

## 2. Copiar el paquete nuevo

1. Descarga y descomprime `agenda-casona-malu-backlog.zip`.
2. Abre la carpeta descomprimida `agenda-main`.
3. Selecciona todo su contenido: `src`, `supabase`, `docs`, `package.json` y los
   demás archivos.
4. Copia ese contenido.
5. Abre:

```text
C:\Users\dperel\Downloads\agenda-local
```

6. Pega y elige **Reemplazar los archivos en el destino**.

Se copia el contenido de `agenda-main` dentro de `agenda-local`; no se debe
crear `agenda-local\agenda-main`. El paquete no incluye `.git` ni `.env.local`,
por lo que ambos se mantienen.

## 3. Instalar y validar el código

Abre PowerShell y ejecuta:

```powershell
Set-Location "C:\Users\dperel\Downloads\agenda-local"
npm install
npm run typecheck
npm run build
```

Los dos últimos comandos deben terminar sin errores. La carpeta `dist` se
genera solo como resultado de la prueba y Git la ignora.

## 4. Actualizar primero la función de correos

Haz este despliegue antes de modificar las plantillas de la base. Así el
procesador ya reconocerá los nuevos datos de horario cuando Cron ejecute el
siguiente minuto.

En la misma ventana de PowerShell:

```powershell
Set-Location "C:\Users\dperel\Downloads\agenda-local"
npx supabase functions deploy send-email-queue --project-ref qaguhjvphiaefsporxgu --no-verify-jwt
```

El aviso `Docker is not running` no impide este despliegue. Debe aparecer:

```text
Deployed Functions on project qaguhjvphiaefsporxgu: send-email-queue
```

No cambies `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, Vault ni el trabajo
Cron que ya está activo. La documentación corregida para una recuperación
futura queda en `docs/CONFIGURAR_CRON.sql`.

## 5. Aplicar únicamente la migración nueva

No vuelvas a ejecutar `202607240001_init.sql`, las migraciones anteriores ni
los SQL de importación.

1. En el Explorador abre:

```text
C:\Users\dperel\Downloads\agenda-local\supabase\migrations\202607300001_backlog_improvements.sql
```

2. Ábrelo con Visual Studio Code.
3. Selecciona todo con `Ctrl + A` y copia con `Ctrl + C`.
4. Ve a **Supabase → SQL Editor → New query**.
5. Pega el contenido completo y presiona **Run**.

Supabase puede advertir que la consulta modifica objetos de la base. Es
esperable porque agrega columnas, un tipo de resultado y funciones. El script no contiene
`DROP TABLE`, no elimina citas y no limpia clientes. Confirma la ejecución.

El resultado final debe mostrar una fila con la configuración de duración.
Después ejecuta esta verificación independiente:

```sql
select
  (select count(*) from public.appointments) as citas_conservadas,
  public.setting_int('daily_trial_limit', 2) as maximo_pruebas,
  public.setting_int('daily_delivery_limit', 2) as maximo_entregas,
  public.setting_int('appointment_duration_step_minutes', 15) as incremento,
  public.setting_int('appointment_max_duration_minutes', 240) as duracion_maxima,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clients'
      and column_name = 'instagram'
  ) as instagram_disponible;
```

El número de citas debe seguir siendo `115`, salvo que se hayan creado citas
reales después de la última revisión. Los otros resultados esperados son
`2`, `2`, `15`, `240` y `true`.

## 6. Probar localmente

Ejecuta:

```powershell
npm run dev
```

Abre `http://localhost:5173` e inicia sesión. Realiza estas comprobaciones:

1. **Persistencia:** entra a Clientes o Indicadores, minimiza el navegador,
   vuelve y presiona `F5`. Debe conservar el módulo.
2. **Búsqueda global:** en Agenda, sitúate en un día y busca una cliente que
   tenga una cita en otro mes. Debe aparecer igualmente.
3. **Cliente:** abre una ficha, registra Instagram sin necesidad de guardar
   `@`, y prueba la autorización de campañas.
4. **Exportación:** como Administrador, filtra Clientes y descarga Excel y CSV.
   Los archivos deben contener solo el resultado filtrado.
5. **Cita extendida:** crea una cita de prueba con un correo propio, elige una
   duración superior a la base y confirma que el horario final sea correcto.
6. **Tramo ocupado:** intenta crear otra cita que se cruce con cualquier parte
   de la cita extendida. Debe bloquearse.
7. **Límites:** confirma que se mantengan dos pruebas combinadas y dos entregas
   por día. Una cita extendida cuenta como una sola cita diaria.
8. **Resultado de Venta:** abre una Venta cuya hora ya comenzó y registra uno
   de los tres resultados.
9. **Indicadores:** revisa el orden de tipos y el bloque de efectividad.
10. **Correo:** confirma que el correo de la cita extendida muestre el rango
    horario.

Cancela o elimina las citas creadas exclusivamente para la prueba.

Detén Vite con `Ctrl + C`.

## 7. Revisar exactamente lo que irá a GitHub

Ejecuta:

```powershell
git status -sb
git check-ignore -v .env.local
```

`.env.local` debe aparecer ignorado. Nunca ejecutes `git add` sobre ese archivo.

Luego:

```powershell
git add .
git status --short
```

Revisa que no aparezcan `node_modules`, `dist`, `.env.local` ni archivos
`*.tsbuildinfo`.

## 8. Crear el commit y subirlo

```powershell
git commit -m "Implementa backlog de agenda clientes y resultados comerciales"
git push origin main
```

Verifica:

```powershell
git status -sb
git log -3 --oneline --decorate
```

El estado esperado es:

```text
## main...origin/main
```

## 9. Verificar Vercel

1. Abre **Vercel → proyecto Agenda → Deployments**.
2. Espera que el despliegue de Production indique **Ready**.
3. Abre la URL pública en una ventana incógnita.
4. Repite las pruebas esenciales de inicio de sesión, búsqueda, duración y
   resultado de Venta.

No se deben modificar las variables de Vercel si el login ya funciona:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

## 10. Validación de seguridad y operación

Ejecuta en Supabase:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'casona-malu-email-queue';

select kind, status, count(*)
from public.email_queue
group by kind, status
order by kind, status;
```

El Cron debe estar activo con `* * * * *`. Revisa además que una exportación
haya quedado en **Auditoría** con tabla `clients` y acción `EXPORT`.

Esta actualización no implementa todavía Caja, Taller ni órdenes de
producción; esos módulos continúan como una fase posterior independiente.
