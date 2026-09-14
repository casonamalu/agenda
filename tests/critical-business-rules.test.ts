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
