import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptedDecisionSummary,
  commercialDecisionLabel,
  daysBetweenIso,
  orderBalance,
  orderPaymentTotal,
  orderSaleTotal,
  reportDateRange,
} from '../src/lib/business.ts'
import { GROUP_SALE_DURATION_MINUTES, appointmentClientNames, groupSaleDuration } from '../src/lib/appointments.ts'
import { canResendAppointmentEmail, emailQueueSummary, filterEmailQueue } from '../src/lib/emailQueue.ts'
import type { EmailQueueItem } from '../src/types.ts'

test('el período de 14 días incluye hoy y los 13 días siguientes', () => {
  assert.deepEqual(reportDateRange('fortnight', '2026-09-14'), {
    from: '2026-09-14',
    to: '2026-09-27',
  })
})

test('día siguiente y próximos 7 días mantienen sus límites', () => {
  assert.deepEqual(reportDateRange('tomorrow', '2026-09-14'), {
    from: '2026-09-15',
    to: '2026-09-15',
  })
  assert.deepEqual(reportDateRange('week', '2026-09-14'), {
    from: '2026-09-14',
    to: '2026-09-20',
  })
})

test('distingue una venta aceptada en la cita de una aceptada días después', () => {
  assert.equal(daysBetweenIso('2026-09-10', '2026-09-10'), 0)
  assert.equal(daysBetweenIso('2026-09-10', '2026-09-13'), 3)
  assert.equal(acceptedDecisionSummary('2026-09-10', '2026-09-10'), 'Venta aceptada durante la cita')
  assert.equal(acceptedDecisionSummary('2026-09-13', '2026-09-10'), 'Venta aceptada 3 días después')
  assert.equal(commercialDecisionLabel('completed_sale', '2026-09-13', '2026-09-10'), 'Aceptada 3 días después')
})

test('identifica estados pendiente y rechazado con su fecha efectiva', () => {
  assert.match(commercialDecisionLabel('potential_sale', '2026-09-11', '2026-09-10'), /^Pendiente desde /)
  assert.match(commercialDecisionLabel('rejected_sale', '2026-09-12', '2026-09-10'), /^Rechazada el /)
})

test('calcula venta, pagos, reversos y saldo sin permitir saldo negativo', () => {
  const order = {
    financials: { gross_sale_amount: 1_200_000, discount_amount: 100_000 },
    payments: [{ amount: 400_000 }, { amount: 250_000 }, { amount: -250_000 }],
  }
  assert.equal(orderSaleTotal(order), 1_100_000)
  assert.equal(orderPaymentTotal(order), 400_000)
  assert.equal(orderBalance(order), 700_000)

  const overpaid = {
    financials: { gross_sale_amount: 100_000, discount_amount: 0 },
    payments: [{ amount: 150_000 }],
  }
  assert.equal(orderBalance(overpaid), 0)
})

test('una cita de venta para dos personas ocupa 90 minutos y sigue siendo una cita', () => {
  assert.equal(GROUP_SALE_DURATION_MINUTES, 90)
  assert.equal(groupSaleDuration(true, 45), 90)
  assert.equal(groupSaleDuration(false, 45), 45)
})

test('muestra a la clienta principal y a la acompañante en una sola cita', () => {
  const appointment = {
    client: { first_name: 'Ana', last_name: 'Pérez' },
    participants: [{ client: { first_name: 'Elena', last_name: 'Pérez' } }],
  }
  assert.equal(appointmentClientNames(appointment as never), 'Ana Pérez + Elena Pérez')
})

const emailItem = (overrides: Partial<EmailQueueItem>): EmailQueueItem => ({
  id: 'queue-1',
  idempotency_key: 'idem-1',
  appointment_id: 'appointment-1',
  recipient: 'ana@example.com',
  kind: 'appointment_created',
  scheduled_for: '2026-09-17T12:00:00Z',
  status: 'sent',
  attempts: 1,
  last_error: null,
  provider_message_id: 'provider-1',
  sent_at: '2026-09-17T12:00:01Z',
  created_at: '2026-09-17T12:00:00Z',
  ...overrides,
})

test('resume confirmaciones, recordatorios, pendientes y fallidos', () => {
  const items = [
    emailItem({ id: '1' }),
    emailItem({ id: '2', kind: 'reminder' }),
    emailItem({ id: '3', kind: 'reminder', status: 'retry', sent_at: null }),
    emailItem({ id: '4', status: 'failed', sent_at: null }),
    emailItem({ id: '5', kind: 'report' }),
  ]
  assert.deepEqual(emailQueueSummary(items), {
    confirmationsSent: 1,
    remindersSent: 1,
    pending: 1,
    problems: 1,
  })
})

test('permite reenvío sin duplicar correos que siguen pendientes', () => {
  assert.equal(canResendAppointmentEmail(emailItem({ status: 'sent' })), true)
  assert.equal(canResendAppointmentEmail(emailItem({ status: 'failed' })), true)
  assert.equal(canResendAppointmentEmail(emailItem({ status: 'pending' })), false)
  assert.equal(canResendAppointmentEmail(emailItem({ status: 'processing' })), false)
  assert.equal(canResendAppointmentEmail(emailItem({ status: 'retry' })), false)
  assert.equal(canResendAppointmentEmail(emailItem({ kind: 'report' })), false)
})

test('filtra historial por destinatario, tipo y estado', () => {
  const items = [
    emailItem({ id: '1', recipient: 'ana@example.com' }),
    emailItem({ id: '2', recipient: 'beatriz@example.com', kind: 'reminder', status: 'failed' }),
  ]
  assert.deepEqual(filterEmailQueue(items, { search: 'BEATRIZ', kind: 'reminder', status: 'failed' }).map((item) => item.id), ['2'])
})
