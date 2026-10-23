import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../supabase/functions/send-email-queue/index.ts', import.meta.url), 'utf8')

test('los reportes programados adjuntan un Excel real mediante Resend', () => {
  assert.match(source, /write-excel-file@4\.1\.1\/universal/)
  assert.match(source, /attachments: email\.attachments/)
  assert.match(source, /\.xlsx`/)
  assert.match(source, /content: workbook/)
})

test('el Excel programado contiene las columnas solicitadas', () => {
  for (const column of [
    'Clienta',
    'Teléfono',
    'Tipo Cita',
    'Fecha Cita',
    'Entrega interna',
    'Fecha evento (sistema)',
    'Observación',
  ]) {
    assert.match(source, new RegExp(column.replace(/[()]/g, '\\$&')))
  }
  assert.match(source, /event_date/)
  assert.match(source, /addDays\(appointmentDate, -2\)/)
})
