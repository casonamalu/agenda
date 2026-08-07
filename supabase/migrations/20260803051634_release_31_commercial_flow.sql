-- Release 3.1: continuidad Venta -> Pedido, agenda integrada y comisiones configurables.
-- Migración aditiva. Conserva medios de pago históricos y congela las tasas en cada pedido/pago.

create type public.commission_status as enum ('pending', 'approved', 'paid');

create table public.commercial_product_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('bride_dress', 'mother_dress', 'graduation_dress', 'mens_suit', 'accessories')),
  name text not null unique,
  display_order smallint not null unique check (display_order between 1 and 5),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.commercial_product_types(code, name, display_order) values
  ('bride_dress', 'Vestido de novia', 1),
  ('mother_dress', 'Vestido de madrina', 2),
  ('graduation_dress', 'Vestido de graduación', 3),
  ('mens_suit', 'Traje de hombre', 4),
  ('accessories', 'Accesorios', 5);

create table public.seller_product_commissions (
  seller_id uuid not null references public.profiles(id) on delete cascade,
  product_type_id uuid not null references public.commercial_product_types(id),
  commission_rate numeric(7,4) not null default 0 check (commission_rate between 0 and 100),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (seller_id, product_type_id)
);
create index seller_product_commissions_product_idx
  on public.seller_product_commissions(product_type_id, seller_id);

create or replace function public.seed_profile_product_commissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.role::text in ('admin', 'seller') then
    insert into public.seller_product_commissions(seller_id, product_type_id, commission_rate, updated_by)
    select new.id, product.id, 0, auth.uid()
    from public.commercial_product_types product
    on conflict (seller_id, product_type_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger seed_profile_product_commissions_trigger
after insert or update of role on public.profiles
for each row execute function public.seed_profile_product_commissions();

insert into public.seller_product_commissions(seller_id, product_type_id, commission_rate, updated_by)
select profile.id, product.id, 0, null
from public.profiles profile
cross join public.commercial_product_types product
where profile.role::text in ('admin', 'seller')
on conflict (seller_id, product_type_id) do nothing;

alter table public.orders
  add column product_type_id uuid references public.commercial_product_types(id);

alter table public.order_financials
  add column commission_status public.commission_status not null default 'pending',
  add column commission_base_snapshot numeric(14,2),
  add column sales_commission_amount_snapshot numeric(14,2),
  add column commission_approved_at timestamptz,
  add column commission_approved_by uuid references public.profiles(id) on delete set null,
  add column commission_paid_at timestamptz,
  add column commission_paid_by uuid references public.profiles(id) on delete set null,
  add constraint order_financial_commission_snapshot_check check (
    (commission_status = 'pending' and commission_base_snapshot is null and sales_commission_amount_snapshot is null)
    or (commission_status in ('approved', 'paid') and commission_base_snapshot >= 0 and sales_commission_amount_snapshot >= 0)
  );

create or replace function public.guard_frozen_commission_calculation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.commission_status in ('approved', 'paid')
     and (new.gross_sale_amount is distinct from old.gross_sale_amount
       or new.discount_amount is distinct from old.discount_amount
       or new.tax_rate_snapshot is distinct from old.tax_rate_snapshot
       or new.sales_commission_rate_snapshot is distinct from old.sales_commission_rate_snapshot
       or new.card_fee_rate_snapshot is distinct from old.card_fee_rate_snapshot) then
    raise exception 'El cálculo de una comisión aprobada o pagada está congelado';
  end if;
  return new;
end;
$$;

create trigger guard_frozen_commission_calculation_trigger
before update on public.order_financials
for each row execute function public.guard_frozen_commission_calculation();

drop index if exists public.orders_source_appointment_idx;
create unique index orders_source_appointment_unique_idx
  on public.orders(source_appointment_id)
  where source_appointment_id is not null;
create index orders_product_type_idx on public.orders(product_type_id) where product_type_id is not null;

create trigger commercial_product_types_updated_at
before update on public.commercial_product_types
for each row execute function public.set_updated_at();
create trigger seller_product_commissions_updated_at
before update on public.seller_product_commissions
for each row execute function public.set_updated_at();
create trigger audit_seller_product_commissions
after insert or update or delete on public.seller_product_commissions
for each row execute function public.audit_row_change();

create or replace function public.set_seller_product_commissions(
  p_seller_id uuid,
  p_product_type_ids uuid[],
  p_commission_rate numeric
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if not public.is_admin() then raise exception 'Solo Administrador puede modificar comisiones'; end if;
  if p_commission_rate is null or p_commission_rate < 0 or p_commission_rate > 100 then
    raise exception 'La comisión debe estar entre 0 y 100';
  end if;
  if coalesce(cardinality(p_product_type_ids), 0) = 0 then
    raise exception 'Selecciona al menos un tipo de producto';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_seller_id and active and role::text in ('admin', 'seller')
  ) then raise exception 'La vendedora no existe o no está activa'; end if;
  if exists (
    select 1 from unnest(p_product_type_ids) selected(id)
    where not exists (select 1 from public.commercial_product_types product where product.id = selected.id and product.active)
  ) then raise exception 'Uno de los tipos de producto no es válido'; end if;

  perform set_config('app.audit_reason', 'Actualización de matriz de comisiones', true);
  insert into public.seller_product_commissions(seller_id, product_type_id, commission_rate, updated_by)
  select p_seller_id, selected.id, p_commission_rate, auth.uid()
  from unnest(p_product_type_ids) selected(id)
  on conflict (seller_id, product_type_id) do update
    set commission_rate = excluded.commission_rate,
        updated_by = excluded.updated_by,
        updated_at = now();
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.create_order_v2(
  p_client_id uuid,
  p_source_appointment_id uuid,
  p_seller_id uuid,
  p_production_route public.production_route,
  p_product_type_id uuid,
  p_product_name text,
  p_design_description text,
  p_sale_date date,
  p_event_date date,
  p_promised_delivery_date date,
  p_gross_sale_amount numeric,
  p_discount_amount numeric,
  p_planned_hours numeric,
  p_internal_notes text,
  p_scheduled_appointments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_id uuid;
  v_appointment_id uuid;
  v_schedule jsonb;
  v_tax numeric := coalesce((select (setting_value #>> '{}')::numeric from public.app_settings where setting_key = 'default_tax_rate'), 19);
  v_card_fee numeric := coalesce((select (setting_value #>> '{}')::numeric from public.app_settings where setting_key = 'default_card_fee_rate'), 0);
  v_hour_cost numeric := coalesce((select (setting_value #>> '{}')::numeric from public.app_settings where setting_key = 'workshop_hourly_cost'), 0);
  v_commission numeric;
begin
  if not public.can_manage_commercial() then raise exception 'Usuario no autorizado para crear pedidos'; end if;
  if not exists (select 1 from public.clients where id = p_client_id and active) then
    raise exception 'Cliente no encontrado o inactivo';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_seller_id and active and role::text in ('admin', 'seller')
  ) then raise exception 'Selecciona una vendedora activa'; end if;
  if not exists (
    select 1 from public.commercial_product_types where id = p_product_type_id and active
  ) then raise exception 'Selecciona un tipo de producto válido'; end if;
  if nullif(trim(p_product_name), '') is null then raise exception 'El producto es obligatorio'; end if;
  if p_gross_sale_amount is null or p_gross_sale_amount < 0
     or p_discount_amount is null or p_discount_amount < 0
     or p_discount_amount > p_gross_sale_amount then
    raise exception 'Los montos comerciales no son válidos';
  end if;
  if p_planned_hours is not null and p_planned_hours < 0 then
    raise exception 'Las horas planificadas no pueden ser negativas';
  end if;
  if jsonb_typeof(coalesce(p_scheduled_appointments, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_scheduled_appointments, '[]'::jsonb)) > 8 then
    raise exception 'La agenda del pedido no es válida';
  end if;

  if p_source_appointment_id is not null then
    if not exists (
      select 1 from public.appointments source
      join public.appointment_types kind on kind.id = source.appointment_type_id
      where source.id = p_source_appointment_id
        and source.client_id = p_client_id
        and kind.category = 'sale'
        and source.commercial_outcome::text = 'completed_sale'
        and source.order_id is null
    ) then raise exception 'La cita de origen debe ser una venta concretada sin pedido'; end if;
  end if;

  select coalesce(matrix.commission_rate, 0)
    into v_commission
  from public.seller_product_commissions matrix
  where matrix.seller_id = p_seller_id and matrix.product_type_id = p_product_type_id;
  v_commission := coalesce(v_commission, 0);

  perform set_config('app.audit_reason', 'Creación de pedido desde flujo comercial', true);
  insert into public.orders(
    client_id, source_appointment_id, seller_id, production_route, product_type_id,
    status, product_name, design_description, sale_date, event_date,
    promised_delivery_date, planned_hours, internal_notes, created_by, updated_by
  ) values (
    p_client_id, p_source_appointment_id, p_seller_id, p_production_route, p_product_type_id,
    'pending_planning', trim(p_product_name), nullif(trim(p_design_description), ''),
    p_sale_date, p_event_date, p_promised_delivery_date, p_planned_hours,
    nullif(trim(p_internal_notes), ''), auth.uid(), auth.uid()
  ) returning id into v_order_id;

  insert into public.order_financials(
    order_id, gross_sale_amount, discount_amount, tax_rate_snapshot,
    sales_commission_rate_snapshot, card_fee_rate_snapshot,
    workshop_hourly_cost_snapshot, created_by, updated_by
  ) values (
    v_order_id, p_gross_sale_amount, p_discount_amount, v_tax,
    v_commission, v_card_fee, v_hour_cost, auth.uid(), auth.uid()
  );

  if p_source_appointment_id is not null then
    update public.appointments
       set order_id = v_order_id, updated_by = auth.uid(), updated_at = now()
     where id = p_source_appointment_id;
  end if;

  for v_schedule in select value from jsonb_array_elements(coalesce(p_scheduled_appointments, '[]'::jsonb))
  loop
    if not exists (
      select 1 from public.appointment_types appointment_type
      where appointment_type.id = (v_schedule->>'appointment_type_id')::uuid
        and appointment_type.active
        and appointment_type.category in ('trial', 'delivery')
    ) then raise exception 'Solo se pueden agregar pruebas o entregas al pedido'; end if;

    v_appointment_id := public.create_appointment_v2(
      p_client_id, null, null, null, null, null, null, false, null,
      (v_schedule->>'appointment_type_id')::uuid,
      (v_schedule->>'date')::date,
      (v_schedule->>'start_time')::time,
      (v_schedule->>'duration_minutes')::integer,
      nullif(trim(v_schedule->>'internal_notes'), ''), false, false, null
    );
    update public.appointments
       set order_id = v_order_id, updated_by = auth.uid(), updated_at = now()
     where id = v_appointment_id;
  end loop;

  return v_order_id;
exception
  when unique_violation then
    raise exception 'Esta venta ya tiene un pedido asociado';
end;
$$;

create or replace view public.order_financial_summary
with (security_invoker = true)
as
select
  o.id as order_id,
  o.order_sequence,
  f.gross_sale_amount,
  f.discount_amount,
  greatest(f.gross_sale_amount - f.discount_amount, 0) as final_sale_amount,
  calculation.net_sales_amount,
  calculation.tax_amount,
  coalesce(costs.estimated_material_cost, 0) as estimated_material_cost,
  coalesce(costs.actual_material_cost, 0) as actual_material_cost,
  coalesce(o.planned_hours, 0) * f.workshop_hourly_cost_snapshot as estimated_labor_cost,
  coalesce(o.actual_hours, 0) * f.workshop_hourly_cost_snapshot as actual_labor_cost,
  case when f.commission_status = 'pending'
    then greatest(calculation.net_sales_amount - coalesce(payments.card_fees, 0), 0) * f.sales_commission_rate_snapshot / 100
    else coalesce(f.sales_commission_amount_snapshot, 0)
  end as sales_commission,
  coalesce(payments.card_fees, 0) as card_fees,
  coalesce(payments.paid_amount, 0) as paid_amount,
  o.seller_id,
  o.product_type_id,
  f.sales_commission_rate_snapshot,
  f.tax_rate_snapshot,
  f.card_fee_rate_snapshot,
  f.commission_status,
  case when f.commission_status = 'pending'
    then greatest(calculation.net_sales_amount - coalesce(payments.card_fees, 0), 0)
    else coalesce(f.commission_base_snapshot, 0)
  end as commission_base,
  coalesce(payments.cash_paid, 0) as cash_paid,
  coalesce(payments.card_paid, 0) as card_paid,
  coalesce(payments.other_paid, 0) as other_paid
from public.orders o
join public.order_financials f on f.order_id = o.id
cross join lateral (
  select
    case when f.tax_rate_snapshot = 0
      then greatest(f.gross_sale_amount - f.discount_amount, 0)
      else greatest(f.gross_sale_amount - f.discount_amount, 0) / (1 + f.tax_rate_snapshot / 100)
    end as net_sales_amount,
    greatest(f.gross_sale_amount - f.discount_amount, 0)
      - case when f.tax_rate_snapshot = 0
          then greatest(f.gross_sale_amount - f.discount_amount, 0)
          else greatest(f.gross_sale_amount - f.discount_amount, 0) / (1 + f.tax_rate_snapshot / 100)
        end as tax_amount
) calculation
left join lateral (
  select
    coalesce(sum(item.total_cost) filter (where item.phase = 'estimated'), 0) as estimated_material_cost,
    coalesce(sum(item.total_cost) filter (where item.phase = 'actual'), 0) as actual_material_cost
  from public.order_cost_items item where item.order_id = o.id
) costs on true
left join lateral (
  select
    coalesce(sum(payment.amount), 0) as paid_amount,
    coalesce(sum(payment.amount * payment.card_fee_rate_snapshot / 100)
      filter (where payment.method in ('debit_card', 'credit_card')), 0) as card_fees,
    coalesce(sum(payment.amount) filter (where payment.method in ('cash', 'transfer')), 0) as cash_paid,
    coalesce(sum(payment.amount) filter (where payment.method in ('debit_card', 'credit_card')), 0) as card_paid,
    coalesce(sum(payment.amount) filter (where payment.method = 'other'), 0) as other_paid
  from public.order_payments payment where payment.order_id = o.id
) payments on true;

create or replace function public.set_order_commission_status(
  p_order_id uuid,
  p_status public.commission_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_summary public.order_financial_summary%rowtype;
  v_current public.commission_status;
begin
  if not public.is_admin() then raise exception 'Solo Administrador puede aprobar o pagar comisiones'; end if;
  select commission_status into v_current from public.order_financials where order_id = p_order_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if p_status = 'pending' then raise exception 'Una comisión aprobada no puede volver a pendiente'; end if;
  if p_status = 'paid' and v_current <> 'approved' then
    raise exception 'Primero debes aprobar la comisión';
  end if;

  select * into v_summary from public.order_financial_summary where order_id = p_order_id;
  perform set_config('app.audit_reason', 'Cambio de estado de comisión', true);
  if p_status = 'approved' then
    update public.order_financials
       set commission_status = 'approved',
           commission_base_snapshot = v_summary.commission_base,
           sales_commission_amount_snapshot = v_summary.sales_commission,
           commission_approved_at = now(),
           commission_approved_by = auth.uid(),
           updated_by = auth.uid(), updated_at = now()
     where order_id = p_order_id;
  else
    update public.order_financials
       set commission_status = 'paid',
           commission_paid_at = now(),
           commission_paid_by = auth.uid(),
           updated_by = auth.uid(), updated_at = now()
     where order_id = p_order_id;
  end if;
end;
$$;

alter table public.commercial_product_types enable row level security;
alter table public.seller_product_commissions enable row level security;

create policy commercial_product_types_select_internal
on public.commercial_product_types for select to authenticated
using (public.is_internal_user());
create policy seller_product_commissions_select_commercial
on public.seller_product_commissions for select to authenticated
using (public.can_manage_commercial());

revoke all on table public.commercial_product_types, public.seller_product_commissions from anon;
revoke all on table public.commercial_product_types, public.seller_product_commissions from authenticated;
grant select on public.commercial_product_types, public.seller_product_commissions to authenticated;

revoke all on function public.seed_profile_product_commissions() from public, anon, authenticated;
revoke all on function public.guard_frozen_commission_calculation() from public, anon, authenticated;
revoke all on function public.set_seller_product_commissions(uuid,uuid[],numeric) from public, anon, authenticated;
revoke all on function public.create_order_v2(uuid,uuid,uuid,public.production_route,uuid,text,text,date,date,date,numeric,numeric,numeric,text,jsonb) from public, anon, authenticated;
revoke all on function public.set_order_commission_status(uuid,public.commission_status) from public, anon, authenticated;
revoke all on function public.create_order_with_financials(uuid,uuid,public.production_route,text,text,date,date,date,numeric,numeric,text) from authenticated;

grant execute on function public.set_seller_product_commissions(uuid,uuid[],numeric) to authenticated;
grant execute on function public.create_order_v2(uuid,uuid,uuid,public.production_route,uuid,text,text,date,date,date,numeric,numeric,numeric,text,jsonb) to authenticated;
grant execute on function public.set_order_commission_status(uuid,public.commission_status) to authenticated;

revoke update on public.order_financials from authenticated;
grant update (gross_sale_amount, discount_amount, workshop_hourly_cost_snapshot, updated_by)
  on public.order_financials to authenticated;
grant select on public.order_financial_summary to authenticated;
