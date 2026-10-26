import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8')

test('se elimina el bloque manual de pruebas y entregas', () => {
  assert.doesNotMatch(source, /<h2 id="follow-up-report-title">Reporte de pruebas y entregas/)
  assert.doesNotMatch(source, /Consultar reporte/)
})

test('los reportes programados mantienen todos los períodos', () => {
  const scheduledReport = source.slice(source.indexOf('<form className="settings-card report-form"'))
  assert.match(scheduledReport, /value="today">Agenda del mismo día/)
  assert.match(scheduledReport, /value="tomorrow">Agenda del día siguiente/)
  assert.match(scheduledReport, /value="week">Próximos 7 días/)
  assert.match(scheduledReport, /value="fortnight">Próximos 14 días/)
  assert.match(scheduledReport, /value="next_30_days">Próximos 30 días/)
  assert.match(scheduledReport, /value="next_31_days">Próximos 31 días/)
})

test('permite configurar formato y columnas del archivo enviado', () => {
  assert.match(source, /Formato de envío/)
  assert.match(source, /output_format === 'xlsx'/)
  assert.match(source, /output_format === 'pdf'/)
  assert.match(source, /Columnas del reporte/)
  assert.match(source, /Fecha de Prueba o Entrega − 2 días/)
})

test('permite activar o desactivar una programación desde la lista', () => {
  assert.match(source, /toggleReportActive/)
  assert.match(source, /report\.active \? 'Desactivar' : 'Activar'/)
  assert.match(source, /Reporte activado correctamente/)
})
