import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../supabase/functions/send-email-queue/index.ts', import.meta.url), 'utf8')

test('los reportes programados adjuntan Excel o PDF mediante Resend', () => {
  assert.match(source, /write-excel-file@4\.1\.1\/universal/)
  assert.match(source, /pdf-lib@1\.17\.1/)
  assert.match(source, /attachments: email\.attachments/)
  assert.match(source, /report\.output_format === 'pdf'/)
  assert.match(source, /buildReportPdf/)
  assert.match(source, /buildReportWorkbook/)
})

test('el archivo programado permite las columnas solicitadas', () => {
  for (const column of [
    'Clienta',
    'Teléfono',
    'Tipo de cita',
    'Fecha cita',
    'Entrega interna',
    'Fecha evento (sistema)',
    'Observación',
  ]) {
    assert.match(source, new RegExp(column.replace(/[()]/g, '\\$&')))
  }
  assert.match(source, /event_date/)
  assert.match(source, /internal_delivery_date/)
  assert.match(source, /\['Prueba 1', 'Prueba 2', 'Entrega'\]\.includes\(typeName\)/)
  assert.match(source, /addDays\(appointmentDate, -2\)/)
})

test('el envío programado admite el período de próximos 31 días', () => {
  assert.match(source, /report\.period_type === 'next_31_days'/)
  assert.match(source, /to = addDays\(runDate, 30\)/)
})

test('el envío programado admite el período de próximos 30 días', () => {
  assert.match(source, /report\.period_type === 'next_30_days'/)
  assert.match(source, /to = addDays\(runDate, 29\)/)
})
