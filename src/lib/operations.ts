import type { CostCategory, OrderStatus, PaymentMethod, ProductionRoute } from '../types'

export const productionRouteLabels: Record<ProductionRoute, string> = {
  stock_adjustments: 'Stock + ajustes',
  existing_design: 'Diseño existente a pedido',
  new_design: 'Diseño nuevo desde moldaje',
}

export const orderStatusLabels: Record<OrderStatus, string> = {
  quote: 'Cotización',
  confirmed: 'Confirmado',
  pending_planning: 'Pendiente de planificación',
  planned: 'Planificado',
  in_production: 'En producción',
  pending_fitting_1: 'Pendiente prueba 1',
  corrections: 'Correcciones',
  pending_fitting_2: 'Pendiente prueba 2',
  finishing: 'Terminaciones',
  ready: 'Listo para entrega',
  delivered: 'Entregado',
  closed: 'Cerrado',
  on_hold: 'En pausa',
  cancelled: 'Cancelado',
}

export const orderStatuses = Object.keys(orderStatusLabels) as OrderStatus[]

export const costCategoryLabels: Record<CostCategory, string> = {
  fabric: 'Tela',
  lining: 'Forro',
  accessories: 'Accesorios',
  external_service: 'Servicio externo',
  other: 'Otro',
}

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Efectivo',
  debit_card: 'Tarjeta',
  credit_card: 'Tarjeta',
  other: 'Otro (histórico)',
}

export const operationalPaymentMethods: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Efectivo (incluye transferencia)' },
  { value: 'credit_card', label: 'Tarjeta (débito o crédito)' },
]

export function formatClp(value: number | null | undefined) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))
}

export function orderCode(sequence: number) {
  return `PED-${String(sequence).padStart(5, '0')}`
}
