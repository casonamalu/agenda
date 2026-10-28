import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('el módulo de reportes ofrece sincronización con vista previa y confirmación de correos', async () => {
  const reports = await readFile(new URL('src/components/Reports.tsx', root), 'utf8')
  const sync = await readFile(new URL('src/components/GoogleDriveSync.tsx', root), 'utf8')

  assert.match(reports, /<GoogleDriveSync/)
  assert.match(sync, /Actualizar Excel/)
  assert.match(sync, /Cargar cambios/)
  assert.match(sync, /Confirmar carga y enviar correos/)
  assert.match(sync, /Corrige las filas con error/)
})

test('la carga usa los RPC normales, conserva IDs ocultos y protege cambios de clienta', async () => {
  const edge = await readFile(new URL('supabase/functions/google-drive-sync/index.ts', root), 'utf8')

  assert.match(edge, /create_appointment_v3/)
  assert.match(edge, /reschedule_appointment_v3/)
  assert.match(edge, /change_appointment_status/)
  assert.match(edge, /ID cita \(sistema\)/)
  assert.match(edge, /No se puede cambiar la clienta de una cita existente/)
  assert.match(edge, /isHardBlockReason/)
  assert.match(edge, /orders!appointments_order_id_fkey/)
  assert.match(edge, /formatError/)
  assert.match(edge, /\.neq\('status', 'cancelled'\)/)
  assert.match(edge, /CALENDARIO/)
  assert.match(edge, /SINCRONIZACIÓN/)
  assert.match(edge, /sheetDateNumber/)
  assert.match(edge, /x-google-apps-script/)
})

test('los controles directos validan administradora y confirman antes de cargar', async () => {
  const script = await readFile(new URL('google-apps-script/Code.gs', root), 'utf8')
  const manifest = await readFile(new URL('google-apps-script/appsscript.json', root), 'utf8')
  const migration = await readFile(new URL('supabase/migrations/20261028014917_google_sheets_direct_controls.sql', root), 'utf8')

  assert.match(script, /function actualizarExcel\(/)
  assert.match(script, /function cargarExcel\(/)
  assert.match(script, /ButtonSet\.YES_NO/)
  assert.match(script, /X-Google-Apps-Script/)
  assert.match(manifest, /userinfo\.email/)
  assert.match(migration, /apply_google_sheet_action_v1/)
  assert.match(migration, /grant execute[\s\S]*to service_role/)
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/)
})

test('la migración registra la conexión, la bitácora y los campos de taller', async () => {
  const migration = await readFile(new URL('supabase/migrations/20261027185715_google_drive_sync.sql', root), 'utf8')

  assert.match(migration, /google_drive_sync_config/)
  assert.match(migration, /google_drive_sync_runs/)
  assert.match(migration, /workshop_observation/)
  assert.match(migration, /spreadsheet_status/)
  assert.match(migration, /1rhXGSmRnHfcGAIJRvetHBFl2LKEAcM3Eb-N1zEdWshk/)
})