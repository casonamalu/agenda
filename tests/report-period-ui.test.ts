import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/components/Reports.tsx', import.meta.url), 'utf8')

test('el reporte manual muestra el selector de próximos 30 días', () => {
  const manualReport = source.slice(
    source.indexOf('Reporte de pruebas y entregas'),
    source.indexOf('<form className="settings-card report-form"'),
  )

  assert.match(manualReport, /Período/)
  assert.match(manualReport, /value="next_30_days">Próximos 30 días/)
})

test('los reportes programados ofrecen próximos 30 días', () => {
  const scheduledReport = source.slice(source.indexOf('<form className="settings-card report-form"'))
  assert.match(scheduledReport, /value="next_30_days">Próximos 30 días/)
})
