# Backlog implementado · 30 de julio de 2026

## Alcance de esta versión

| ID | Requerimiento | Implementación |
|---|---|---|
| PD-001 | Orden de tipos en Indicadores | Orden fijo: Venta, Prueba 1, Prueba 2 y Entrega. |
| PD-002 | Cierre operativo de correos | Cron documentado cada minuto, secreto en Vault, reintentos y monitoreo. |
| PD-003 | Instagram de cliente | Campo separado, opcional y normalizado sin `@`. |
| PD-004 | Resultado de citas de Venta | Venta concretada, venta rechazada o posible venta; auditoría e indicador de efectividad. |
| PD-005 | Búsqueda global | Busca en toda la agenda sin limitarse a la vista diaria, semanal o mensual. |
| PD-006 | Conservar contexto | Persiste módulo, vista de Agenda, fecha y pestaña de Mantenedores. |
| PD-007 | Citas extendidas | Duración continua configurable, validación de todo el tramo y rango horario en correos. |
| PD-008 | Exportación de clientes | Excel y CSV filtrados, solo desde interfaz Administrador, con consentimiento y auditoría. |

## Reglas que se conservan

- Prueba 1 y Prueba 2 comparten un máximo diario configurable, actualmente 2.
- Entrega tiene un máximo diario configurable independiente, actualmente 2.
- Venta no tiene un máximo diario adicional.
- Pruebas y entregas comparten la capacidad simultánea del espacio.
- Una cita extendida cuenta como una sola cita para el máximo diario.
- Ninguna cita extendida puede cruzar otra reserva, un cierre, el almuerzo ni el
  término de jornada.

## Indicador comercial

La efectividad se calcula como:

```text
ventas concretadas / (ventas concretadas + ventas rechazadas)
```

Las posibles ventas y las citas sin resultado se muestran por separado para no
distorsionar el porcentaje.

## Exportación y campañas

La autorización de campañas se guarda separada de los recordatorios
transaccionales. La exportación incluye filtros por búsqueda, tipo, correo,
estado y consentimiento, además de Instagram y fecha de última cita. Cada
exportación crea un registro `EXPORT` en Auditoría.

## Fuera de alcance

Caja, ventas monetarias, comisiones, Taller, órdenes de producción, costos,
ingresos/egresos y capacidad productiva pertenecen a una fase posterior. Esta
versión prepara el resultado comercial del agendamiento, pero no crea todavía
esos módulos.
