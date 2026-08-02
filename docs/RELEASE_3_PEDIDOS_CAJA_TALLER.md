# Release 3 — Pedidos, Caja y Taller

Esta versión transforma la agenda en el núcleo operativo de Casona Malú sin incorporar inventario detallado ni control de tareas individuales.

## Alcance

- Pedido vinculado a cliente, venta y citas.
- Tres rutas: stock con ajustes, diseño existente a pedido y diseño nuevo desde moldaje.
- Horas totales planificadas y reales por pedido.
- Costos estimados y reales de telas, forros, accesorios, servicios externos y otros.
- Costo de mano de obra calculable con la tarifa histórica del pedido.
- Pagos, ingresos, egresos y reversos auditables.
- Capacidad semanal del taller y excepciones por semana.
- Rentabilidad por pedido considerando venta neta de IVA, materiales, mano de obra y comisiones.
- Rol `workshop` sin acceso a Caja ni Rentabilidad.
- Pagos y movimientos de caja registrados exclusivamente mediante RPC validadas.
- Reversos inmutables y trazables; no se permite fabricar reversas desde el cliente.
- Pedidos cerrados con datos financieros y costos inmutables.
- Rol Taller limitado a estado, semana y horas de producción.

## Preparación segura

1. Confirmar que el respaldo previo a Release 3 está disponible.
2. Ejecutar las migraciones en orden y como operaciones separadas:
   - `202608020001_add_workshop_role.sql`
   - `202608020002_core_orders_cash_workshop.sql`
3. No ejecutar ambas pegadas en una misma transacción: PostgreSQL necesita confirmar el nuevo valor del enum antes de usarlo.
4. Desplegar la función actualizada:

   ```powershell
   npx supabase functions deploy admin-user --project-ref qaguhjvphiaefsporxgu
   ```

5. Configurar en **Mantenedores → Comercial y taller**:
   - horas semanales disponibles;
   - costo por hora del taller;
   - umbral de advertencia de capacidad;
   - IVA;
   - comisión de venta;
   - comisión Transbank.
6. Crear una usuaria con rol Taller si corresponde.

## Prueba funcional antes de producción

1. Crear un pedido de prueba asociado a una cliente y a una cita de Venta.
2. Comprobar que el pedido aparece en Pedidos y Taller.
3. Asignar semana y horas planificadas; comprobar que aumenta la carga semanal.
4. Registrar un costo estimado y uno real.
5. Registrar un abono en Caja y comprobar el saldo.
6. Registrar y reversar un egreso pequeño; confirmar que ambos movimientos permanecen visibles.
7. Registrar horas reales distintas de las planificadas y verificar que el motivo sea obligatorio.
8. Vincular una cita de Prueba al pedido.
9. Revisar Rentabilidad y confirmar venta neta, IVA, costos y margen.
10. Ingresar como usuaria Taller y confirmar que no aparecen Caja ni Rentabilidad.
11. Confirmar que un pago negativo y una inserción directa en Caja son rechazados.
12. Cerrar un pedido de prueba y confirmar que no admite nuevos cambios financieros.

## Consultas de verificación

```sql
select
  (select count(*) from public.orders) as pedidos,
  (select count(*) from public.order_financials) as fichas_financieras,
  (select count(*) from public.order_cost_items) as costos,
  (select count(*) from public.order_payments) as pagos,
  (select count(*) from public.cash_movements) as movimientos_caja;
```

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'orders', 'order_financials', 'order_cost_items',
    'order_payments', 'cash_movements', 'workshop_capacity_exceptions'
  )
order by tablename;
```

Todas las filas deben mostrar `rowsecurity = true`.

## Publicación

Después de aprobar las pruebas:

1. Fusionar la rama de Release 3 a `main`.
2. Confirmar que Vercel finaliza el deployment con estado **Ready**.
3. Probar login, agenda y correos para descartar regresiones.
4. Probar Pedidos, Caja, Taller y Rentabilidad desde la URL pública.
5. Revisar los asesores de seguridad y rendimiento de Supabase.

La migración es aditiva y no elimina clientes, citas, recordatorios ni correos existentes.
