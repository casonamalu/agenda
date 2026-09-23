# Backlog pendiente · Agenda Casona Malú

Última actualización: 23 de septiembre de 2026.

## BUG-001 · La búsqueda no encuentra nombre y apellido juntos

- **Prioridad:** Alta
- **Estado:** Corregido; pendiente de validación en producción
- **Módulos afectados:** Agenda y formulario de cita
- **Evidencia:** Buscar `Parra` encuentra la cita de Carolina Parra, pero buscar `Carolina Parra` devuelve cero resultados.
- **Causa confirmada:** La búsqueda compara la frase completa con cada campo por separado. El valor `Carolina Parra` no existe íntegramente ni en `first_name` (`Carolina`) ni en `last_name` (`Parra`).
- **Alcance de la corrección:**
  - Búsqueda global de la agenda.
  - Selector de cliente principal en el formulario de cita.
  - Selector de segunda persona en citas grupales.
- **Solución propuesta:** Normalizar y dividir la consulta en palabras, y exigir que cada palabra coincida con alguna parte de la identidad del cliente. Considerar nombre completo, correo, teléfono e Instagram, sin depender de mayúsculas, tildes u orden de los nombres.
- **Criterios de aceptación:**
  - `Carolina Parra`, `carolina parra`, `Parra Carolina` y `Carolina` encuentran la misma clienta.
  - Los nombres compuestos funcionan correctamente.
  - La búsqueda por correo, teléfono e Instagram continúa funcionando.
  - La corrección se aplica tanto en la agenda como al crear una cita.

## BUG-002 · El formulario de cita se reinicia al cambiar de aplicación

- **Prioridad:** Crítica
- **Estado:** Corregido; pendiente de validación en Android y iPhone
- **Módulo afectado:** Formulario de creación y edición de citas en dispositivos móviles
- **Descripción:** Al completar una cita, cambiar brevemente a otra aplicación y volver al navegador, la pantalla parece actualizarse y el formulario se cierra o pierde la información ingresada.
- **Causa probable identificada:** Al recuperar el foco, Supabase puede emitir `TOKEN_REFRESHED`. El listener de autenticación actual responde a todos los eventos limpiando el perfil y activando la pantalla de carga. Esto desmonta el formulario. Además, el borrador se mantiene únicamente en el estado de React y no tiene recuperación temporal.
- **Solución propuesta:**
  - No desmontar la aplicación ante `TOKEN_REFRESHED` cuando corresponde al mismo usuario.
  - Reservar la pantalla de carga completa para el inicio inicial o un cambio real de usuario.
  - Guardar temporalmente el borrador del formulario en `sessionStorage` mientras esté abierto y eliminarlo al guardar o cancelar conscientemente.
  - Evitar que una actualización de catálogos sobrescriba campos ya completados.
- **Criterios de aceptación:**
  - Cambiar de aplicación y volver mantiene abierto el formulario en el mismo punto.
  - Se conservan cliente, tipo de cita, fecha, hora, notas y segunda persona, cuando corresponda.
  - Una renovación silenciosa de sesión no muestra la pantalla de carga ni reinicia el formulario.
  - Guardar la cita elimina el borrador temporal.
  - Cancelar el formulario solicita confirmación si existen cambios sin guardar y, al confirmar, elimina el borrador.
  - El comportamiento se verifica en Android Chrome y Safari de iPhone.
