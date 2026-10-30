import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('la migración agrega una OC de taller opcional y restringe su longitud', async () => {
  const migration = await readFile(new URL('supabase/migrations/20261030143000_add_workshop_order_number.sql', root), 'utf8')

  assert.match(migration, /add column if not exists workshop_order_number text/)
  assert.match(migration, /char_length\(trim\(workshop_order_number\)\) between 1 and 100/)
  assert.match(migration, /grant update \(workshop_order_number, updated_by\)[\s\S]*to authenticated/)
})

test('Ventas permite editar y buscar por OC de taller', async () => {
  const orders = await readFile(new URL('src/components/Orders.tsx', root), 'utf8')

  assert.match(orders, /order\.workshop_order_number/)
  assert.match(orders, /name="workshop_order_number"/)
  assert.match(orders, /OC de taller/)
  assert.match(orders, /\.from\('orders'\)\.update\(\{/)
})

test('Taller muestra y permite actualizar la OC', async () => {
  const workshop = await readFile(new URL('src/components/Workshop.tsx', root), 'utf8')

  assert.match(workshop, /OC taller:/)
  assert.match(workshop, /name="workshop_order_number"/)
  assert.match(workshop, /workshop_order_number: workshopOrderNumber/)
})
