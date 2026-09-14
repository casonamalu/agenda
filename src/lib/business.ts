import type { CommercialOutcome, ScheduledReport } from '../types'

interface FinancialOrderLike {
  financials?: {
    gross_sale_amount: number
    discount_amount: number
  } | null
  payments?: Array<{ amount: number }> | null
}

export function chileIsoDate(value: string | Date = new Date()) {
  const date = typeof value === 'string' ? new Date(value) : value
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function daysBetweenIso(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000,
  )
}

export function commercialDecisionLabel(
  outcome: CommercialOutcome,
  effectiveDate: string,
  appointmentDate: string,
) {
  if (outcome === 'potential_sale') return `Pendiente desde ${formatLongDate(effectiveDate)}`
  if (outcome === 'rejected_sale') return `Rechazada el ${formatLongDate(effectiveDate)}`
  const days = Math.max(0, daysBetweenIso(appointmentDate, effectiveDate))
  return days === 0 ? 'Aceptada en la cita' : `Aceptada ${days} día${days === 1 ? '' : 's'} después`
}

export function acceptedDecisionSummary(effectiveDate: string, appointmentDate: string) {
  const days = Math.max(0, daysBetweenIso(appointmentDate, effectiveDate))
  return days === 0
    ? 'Venta aceptada durante la cita'
    : `Venta aceptada ${days} día${days === 1 ? '' : 's'} después`
}

export function reportDateRange(
  period: ScheduledReport['period_type'],
  today = chileIsoDate(),
) {
  if (period === 'tomorrow') {
    const tomorrow = addIsoDays(today, 1)
    return { from: tomorrow, to: tomorrow }
  }
  if (period === 'week') return { from: today, to: addIsoDays(today, 6) }
  if (period === 'fortnight') return { from: today, to: addIsoDays(today, 13) }
  return { from: today, to: today }
}

export function orderSaleTotal(order: FinancialOrderLike | null) {
  return Math.max(
    0,
    Number(order?.financials?.gross_sale_amount ?? 0)
      - Number(order?.financials?.discount_amount ?? 0),
  )
}

export function orderPaymentTotal(order: FinancialOrderLike | null) {
  return order?.payments?.reduce((sum, item) => sum + Number(item.amount), 0) ?? 0
}

export function orderBalance(order: FinancialOrderLike | null) {
  return Math.max(0, orderSaleTotal(order) - orderPaymentTotal(order))
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`))
}
