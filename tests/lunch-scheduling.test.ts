import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('la migración elimina el bloqueo de almuerzo y agrega sus bloques regulares', async () => {
  const migration = await readFile(new URL('supabase/migrations/20261029223538_remove_lunch_scheduling_restriction.sql', root), 'utf8')

  assert.doesNotMatch(migration, /business_break_start|business_break_end|cruza con el horario de almuerzo/)
  assert.match(migration, /time '14:00'/)
  assert.match(migration, /time '14:45'/)
  assert.match(migration, /not exists/)
  assert.match(migration, /business_day_start/)
  assert.match(migration, /is_closed_at/)
  assert.match(migration, /shared_space_capacity/)
  assert.match(migration, /daily_trial_limit/)
  assert.match(migration, /daily_delivery_limit/)
})

test('el mantenedor ya no muestra una configuración de almuerzo sin efecto', async () => {
  const settings = await readFile(new URL('src/components/Settings.tsx', root), 'utf8')

  assert.doesNotMatch(settings, /business_break_start|business_break_end/)
  assert.doesNotMatch(settings, /Inicio almuerzo|Término almuerzo/)
  assert.match(settings, /Inicio jornada/)
  assert.match(settings, /Término jornada/)
})
