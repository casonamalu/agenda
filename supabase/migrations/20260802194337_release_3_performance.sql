-- Release 3: índices de claves foráneas y ajuste de políticas detectados por el asesor.
-- Idempotente para proyectos donde 202608020002 ya fue aplicada.

create index if not exists orders_seller_idx on public.orders(seller_id) where seller_id is not null;
create index if not exists orders_created_by_idx on public.orders(created_by);
create index if not exists orders_updated_by_idx on public.orders(updated_by);
create index if not exists order_financials_created_by_idx on public.order_financials(created_by);
create index if not exists order_financials_updated_by_idx on public.order_financials(updated_by);
create index if not exists order_cost_items_created_by_idx on public.order_cost_items(created_by);
create index if not exists order_payments_created_by_idx on public.order_payments(created_by);
create index if not exists cash_movements_order_idx on public.cash_movements(order_id) where order_id is not null;
create index if not exists cash_movements_created_by_idx on public.cash_movements(created_by);
create index if not exists workshop_capacity_created_by_idx on public.workshop_capacity_exceptions(created_by);
create index if not exists workshop_capacity_updated_by_idx on public.workshop_capacity_exceptions(updated_by);

drop policy if exists orders_insert_commercial on public.orders;
create policy orders_insert_commercial on public.orders for insert to authenticated
  with check (public.can_manage_commercial() and created_by = (select auth.uid()));

drop policy if exists order_payments_insert_commercial on public.order_payments;
create policy order_payments_insert_commercial on public.order_payments for insert to authenticated
  with check (public.can_manage_commercial() and created_by = (select auth.uid()));

drop policy if exists cash_movements_insert_commercial on public.cash_movements;
create policy cash_movements_insert_commercial on public.cash_movements for insert to authenticated
  with check (public.can_manage_commercial() and created_by = (select auth.uid()));

drop policy if exists workshop_capacity_manage on public.workshop_capacity_exceptions;
drop policy if exists workshop_capacity_insert on public.workshop_capacity_exceptions;
drop policy if exists workshop_capacity_update on public.workshop_capacity_exceptions;
drop policy if exists workshop_capacity_delete on public.workshop_capacity_exceptions;

create policy workshop_capacity_insert on public.workshop_capacity_exceptions for insert to authenticated
  with check (public.can_manage_workshop());
create policy workshop_capacity_update on public.workshop_capacity_exceptions for update to authenticated
  using (public.can_manage_workshop()) with check (public.can_manage_workshop());
create policy workshop_capacity_delete on public.workshop_capacity_exceptions for delete to authenticated
  using (public.can_manage_workshop());
