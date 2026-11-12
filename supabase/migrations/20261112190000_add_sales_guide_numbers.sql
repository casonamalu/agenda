begin;

alter table public.appointments
  add column if not exists sales_guide_number text;

comment on column public.appointments.sales_guide_number is
  'Número de guía comercial importado desde el registro histórico de ventas.';

alter table public.appointments
  drop constraint if exists appointments_sales_guide_number_length;

alter table public.appointments
  add constraint appointments_sales_guide_number_length
  check (
    sales_guide_number is null
    or char_length(trim(sales_guide_number)) between 1 and 100
  );

create or replace function public.validate_appointment_sales_guide_number()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.sales_guide_number := nullif(trim(new.sales_guide_number), '');

  if new.sales_guide_number is not null and not exists (
    select 1
    from public.appointment_types appointment_type
    where appointment_type.id = new.appointment_type_id
      and appointment_type.category = 'sale'
  ) then
    raise exception 'El número de guía solo se puede registrar en una cita de venta';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_validate_sales_guide_number on public.appointments;
create trigger appointments_validate_sales_guide_number
before insert or update of sales_guide_number, appointment_type_id
on public.appointments
for each row execute function public.validate_appointment_sales_guide_number();

create or replace function public.inherit_sales_guide_number_to_order()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.workshop_order_number is null and new.source_appointment_id is not null then
    select appointment.sales_guide_number
      into new.workshop_order_number
    from public.appointments appointment
    where appointment.id = new.source_appointment_id;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_inherit_sales_guide_number on public.orders;
create trigger orders_inherit_sales_guide_number
before insert or update of source_appointment_id
on public.orders
for each row execute function public.inherit_sales_guide_number_to_order();

create or replace function public.copy_sales_guide_number_to_existing_order()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.order_id is not null and new.sales_guide_number is not null then
    update public.orders
       set workshop_order_number = new.sales_guide_number
     where id = new.order_id
       and workshop_order_number is null;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_copy_sales_guide_to_order on public.appointments;
create trigger appointments_copy_sales_guide_to_order
after insert or update of sales_guide_number, order_id
on public.appointments
for each row execute function public.copy_sales_guide_number_to_existing_order();

drop policy if exists appointments_sales_guide_update on public.appointments;
create policy appointments_sales_guide_update
on public.appointments
for update
to authenticated
using (public.can_manage_commercial())
with check (public.can_manage_commercial());

grant update (sales_guide_number, updated_by)
  on public.appointments
  to authenticated;

set local app.audit_reason = 'Carga inicial de guías desde Ventas Casona Malú 2026';

update public.appointments as appointment
set sales_guide_number = imported.guide_number
from (values
  ('44e5f130-a0e8-4e96-a7ba-bcd5d0efa3e8'::uuid, '3070'),
  ('538c29b3-68ab-482e-99f9-5504e523dcf3'::uuid, '3071'),
  ('df7ea93f-49ee-4981-b6b1-7eb9ed5427b9'::uuid, '3072'),
  ('1ba3a79d-e6c7-4574-894b-34f557f92c78'::uuid, '3073'),
  ('2f593f1e-083d-4a49-a6fd-1ff86f5c4295'::uuid, '3074'),
  ('58a39123-d226-4304-9111-a4a47595312a'::uuid, '3075'),
  ('0a8408ab-d85e-4362-9130-55740e2eeda5'::uuid, '3076'),
  ('a104a6b6-2fe4-4395-8b79-5c631cb33b42'::uuid, '3077'),
  ('5eec4b02-073e-06e7-fb26-df5d616eb698'::uuid, '3078'),
  ('4bc7d382-ee64-428c-a89c-f160af716b5d'::uuid, '3081'),
  ('75aa6e54-e491-4c20-a4a4-9dce9ed328f0'::uuid, '3082'),
  ('3950bc0c-c23c-4cb3-9109-27951c3f9b6a'::uuid, '3083'),
  ('fb1990f3-c519-4752-8e69-7bfc291f7175'::uuid, '3086'),
  ('1d0e6ff7-33c5-4fe4-8548-e37e58c20140'::uuid, '3087'),
  ('757bd91b-99d5-4c0f-9f68-a6a2863e99f8'::uuid, '3088'),
  ('80e66671-5b71-4b66-a3d7-381098a69495'::uuid, '3089'),
  ('b7df7570-9d1c-4f13-967a-01d7e63ed735'::uuid, '3091'),
  ('4bd2be71-396a-4572-b217-3988a726faf2'::uuid, '3092'),
  ('bd990fa8-5d5d-40a3-8c45-0ecf43a22d06'::uuid, '3095'),
  ('27273992-ed74-4257-9ae3-9e915ba339e5'::uuid, '3098'),
  ('1d70b180-8924-4acb-bb27-218c7b416147'::uuid, '3099'),
  ('ae587389-9e57-4071-9f96-ea07e8e1d737'::uuid, '3101'),
  ('b5a26e5a-1f65-498c-a42f-e7938ebf7c1c'::uuid, '3102'),
  ('bd80583e-1044-47e8-8fb8-f1d3585d766a'::uuid, '3103'),
  ('618865e7-5f0b-49a2-9209-c10d9cae913b'::uuid, '3104'),
  ('ff16fe52-2605-4cfd-9975-5c0b0a698817'::uuid, '3105'),
  ('df3ec981-d8d6-4306-a786-d2cee6e8c049'::uuid, '3109'),
  ('a239e204-a35a-4ae3-b1ba-60f01cbe2058'::uuid, '3110')
) as imported(appointment_id, guide_number)
where appointment.id = imported.appointment_id
  and appointment.sales_guide_number is null;

commit;
