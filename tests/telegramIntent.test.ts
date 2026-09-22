import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTelegramIntent } from '../supabase/functions/telegram-assistant/intent.ts'

const today = '2026-09-21'

test('entiende fechas relativas expresadas naturalmente', () => {
  assert.deepEqual(parseTelegramIntent('¿Qué citas tengo mañana?', today), {
    kind: 'agenda',
    startDate: '2026-09-22',
    endDate: '2026-09-22',
    label: 'mañana',
  })
  assert.deepEqual(parseTelegramIntent('Agenda del viernes', today), {
    kind: 'agenda',
    startDate: '2026-09-25',
    endDate: '2026-09-25',
    label: 'viernes',
  })
})

test('combina periodo, tipo de cita y horario', () => {
  assert.deepEqual(parseTelegramIntent('Muéstrame las entregas de esta semana después de las 3', today), {
    kind: 'agenda',
    startDate: '2026-09-21',
    endDate: '2026-09-27',
    label: 'esta semana',
    category: 'delivery',
    timeFrom: '15:00',
  })
})

test('entiende fechas con nombre de mes y rangos mensuales', () => {
  const day = parseTelegramIntent('Citas del 24 de septiembre', today)
  assert.equal(day.kind, 'agenda')
  if (day.kind === 'agenda') assert.equal(day.startDate, '2026-09-24')

  const month = parseTelegramIntent('Entregas de octubre', today)
  assert.deepEqual(month, {
    kind: 'agenda',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    label: 'octubre de 2026',
    category: 'delivery',
  })
})

test('extrae nombres para búsqueda y próxima cita', () => {
  assert.deepEqual(parseTelegramIntent('¿Cuándo viene Daniela Pérez?', today), {
    kind: 'search',
    term: 'Daniela Pérez',
    nextAppointment: true,
  })
  assert.deepEqual(parseTelegramIntent('/buscar maria@gmail.com', today), {
    kind: 'search',
    term: 'maria@gmail.com',
    nextAppointment: false,
  })
})

test('los botones sin datos solicitan la información faltante', () => {
  assert.deepEqual(parseTelegramIntent('🔎 Buscar clienta', today), { kind: 'search_guide' })
  assert.deepEqual(parseTelegramIntent('📅 Elegir fecha', today), { kind: 'date_guide' })
})
