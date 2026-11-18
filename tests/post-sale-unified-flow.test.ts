import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('la guía se solicita en Prueba 1 y no en Venta', async () => {
  const modal = await readFile(new URL('src/components/AppointmentModal.tsx', root), 'utf8')
  assert.match(modal, /isFirstTrial/)
  assert.match(modal, /Ingresa la guía de trabajo al agendar Prueba 1/)
  assert.doesNotMatch(modal, /selectedType\?\.category === 'sale' && \(\s*<div className="span-two workshop-guide-editor"/)
})

test('registrar venta permite crear Prueba 1, Prueba 2 y Entrega en un solo formulario', async () => {
  const wizard = await readFile(new URL('src/components/OrderWizard.tsx', root), 'utf8')
  assert.match(wizard, /p_scheduled_appointments: scheduledAppointments/)
  assert.match(wizard, /Agendar Prueba 1/)
  assert.match(wizard, /Agendar Prueba 2/)
  assert.match(wizard, /Agendar Entrega/)
  assert.match(wizard, /Registrar venta y citas/)
})

test('la agenda hereda guías históricas o creadas desde Prueba 1', async () => {
  const agenda = await readFile(new URL('src/components/Agenda.tsx', root), 'utf8')
  assert.match(agenda, /includePreviousGuides/)
  assert.match(agenda, /not\('sales_guide_number', 'is', null\)/)
  assert.doesNotMatch(agenda, /appointment_type\.category', 'sale'/)
})
