import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../supabase/migrations/20261026152017_add_scheduled_report_output_format.sql', import.meta.url), 'utf8')

test('las programaciones existentes conservan Excel como formato inicial', () => {
  assert.match(migration, /output_format text not null default 'xlsx'/)
  assert.match(migration, /output_format in \('xlsx', 'pdf'\)/)
})
