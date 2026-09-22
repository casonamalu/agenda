import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appointmentConfirmationText,
  looksLikeAppointmentRequest,
  parseAppointmentConfirmationText,
  parseAppointmentDraft,
} from '../supabase/functions/telegram-assistant/actions.ts'

const today = '2026-05-20'

test('interpreta el formato real recibido por Telegram', () => {
  const message = `Venta
Amparo Soler
Cel 984448911
No tengo Instagram
amparosoru\\@gmail.com
Invitada
Matrimonio de mi hijo, 24 Octubre 2026
5 de junio, 16.30 hrs`
  assert.equal(looksLikeAppointmentRequest(message), true)
  const result = parseAppointmentDraft(message, today)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.draft, {
    appointmentType: 'Venta',
    firstName: 'Amparo',
    lastName: 'Soler',
    email: 'amparosoru@gmail.com',
    phone: '+56984448911',
    instagram: null,
    clientType: 'Invitada',
    appointmentDate: '2026-06-05',
    startTime: '16:30',
    eventDate: '2026-10-24',
    notes: 'Matrimonio de mi hijo, 24 Octubre 2026',
  })
})

test('exige tipo de cliente y una fecha coherente', () => {
  const result = parseAppointmentDraft(`Venta
Ana Pérez
Cel 984448911
ana@gmail.com
Matrimonio 1 junio 2026
5 junio 2026, 16:30 hrs`, today)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(result.errors.some((error) => error.startsWith('tipo de cliente')))
  assert.ok(result.errors.includes('una fecha de cita anterior al evento'))
})

test('el resumen confirmado conserva los datos de la cita', () => {
  const parsed = parseAppointmentDraft(`Prueba 1
Ana María Pichara
Cel 984448911
No tengo Instagram
ana@gmail.com
Novia
Matrimonio 24 octubre 2026
5 junio 2026, 16:30 hrs`, today)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parseAppointmentConfirmationText(appointmentConfirmationText(parsed.draft, 60)), parsed.draft)
})
