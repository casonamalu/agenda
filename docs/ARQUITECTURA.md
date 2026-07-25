# Arquitectura

## Frontend

React + TypeScript + Vite. Se publica como archivos estáticos en Vercel o Cloudflare Pages. La Publishable Key de Supabase puede utilizarse en el navegador; las políticas RLS controlan el acceso real.

## Backend

Supabase proporciona:

- PostgreSQL como base central.
- Auth para correo y contraseña.
- Row Level Security para roles y usuarios activos.
- Funciones PostgreSQL para crear/reprogramar citas con validación transaccional.
- Realtime para actualizar la agenda entre dispositivos.
- Edge Functions para crear usuarios y enviar correos.
- Cron para recordatorios y limpieza.

## Validación de concurrencia

La creación y reprogramación usan una función PostgreSQL con bloqueo transaccional por fecha. Antes de guardar se comprueba:

1. Día lunes a sábado.
2. Bloque configurado, salvo excepción administrativa.
3. Feriado o cierre.
4. Superposición en el espacio compartido.
5. Capacidad del tipo de cita.
6. Límite conjunto diario de pruebas y entregas.
7. Motivo obligatorio para sobrecupo o fuera de bloque.

## Seguridad

- Las contraseñas permanecen en Supabase Auth.
- Ninguna contraseña se almacena en el código o en tablas públicas.
- La Service Role solo se usa dentro de Edge Functions.
- Los usuarios dados de baja no superan las políticas RLS.
- Solo Administrador consulta auditoría, correos y mantenedores.
