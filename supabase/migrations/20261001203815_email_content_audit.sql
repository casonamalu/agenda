begin;

-- Conserva el contenido exacto aceptado por el proveedor para que el
-- Administrador pueda auditar qué se envió aunque la plantilla cambie.
alter table public.email_queue
  add column if not exists rendered_subject text,
  add column if not exists rendered_html text;

comment on column public.email_queue.rendered_subject is
  'Asunto exacto enviado al proveedor de correo.';
comment on column public.email_queue.rendered_html is
  'Contenido HTML exacto enviado al proveedor de correo.';

commit;
