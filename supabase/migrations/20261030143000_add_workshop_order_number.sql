-- Add an optional workshop work-order identifier to each commercial order.
alter table public.orders
  add column if not exists workshop_order_number text;

comment on column public.orders.workshop_order_number is
  'Identificador manual de la orden de trabajo utilizada por el taller.';

alter table public.orders
  add constraint orders_workshop_order_number_length
  check (
    workshop_order_number is null
    or char_length(trim(workshop_order_number)) between 1 and 100
  );

-- RLS continues to restrict rows; column grants limit the fields editable from the client.
grant update (workshop_order_number, updated_by)
  on public.orders
  to authenticated;
