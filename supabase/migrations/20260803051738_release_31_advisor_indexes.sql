-- Release 3.1: índices recomendados por el asesor de rendimiento.

create index if not exists order_financials_commission_approved_by_idx
  on public.order_financials(commission_approved_by)
  where commission_approved_by is not null;

create index if not exists order_financials_commission_paid_by_idx
  on public.order_financials(commission_paid_by)
  where commission_paid_by is not null;

create index if not exists seller_product_commissions_updated_by_idx
  on public.seller_product_commissions(updated_by)
  where updated_by is not null;
