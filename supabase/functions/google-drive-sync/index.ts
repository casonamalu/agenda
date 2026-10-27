import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.8'
import { importPKCS8, SignJWT } from 'npm:jose@5.10.0'

type Action = 'status' | 'push' | 'preview' | 'apply'
type SheetRow = {
  rowNumber: number
  clientName: string
  guide: string
  appointmentType: string
  appointmentDate: string
  startTime: string
  spreadsheetStatus: string
  eventDate: string | null
  observation: string
  internalNotes: string
  appointmentId: string | null
}

type PreviewItem = SheetRow & {
  action: 'create' | 'update' | 'cancel' | 'no_show' | 'no_change' | 'error'
  clientId: string | null
  appointmentTypeId: string | null
  durationMinutes: number | null
  requiresReschedule: boolean
  allowOutOfSlot: boolean
  allowOverbook: boolean
  warning: string | null
  error: string | null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-sync-secret',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    const body = await request.json().catch(() => ({})) as { action?: Action; trigger?: 'manual' | 'scheduled' }
    const action = body.action ?? 'status'
    const auth = await authorize(request, action, body.trigger)
    const config = await loadConfig()

    if (action === 'status') {
      return json({
        config,
        configured: hasGoogleCredentials(),
        serviceAccountEmail: Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL') ?? null,
      })
    }

    if (!hasGoogleCredentials()) {
      throw new Error('Falta configurar la cuenta de servicio de Google en Supabase')
    }
    if (!config.active && body.trigger === 'scheduled') {
      return json({ skipped: true, reason: 'Sincronización desactivada' })
    }

    if (action === 'push') {
      const result = await pushSystemToDrive(config, auth.userId, body.trigger ?? 'manual')
      return json(result)
    }

    const token = bearerToken(request)
    if (!token) throw new Error('Sesión requerida para cargar cambios')
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })
    const preview = await buildPreview(config, userClient)

    if (action === 'preview') return json(preview)
    if (action === 'apply') {
      const result = await applyPreview(config, preview.items, userClient, auth.userId)
      await pushSystemToDrive(config, auth.userId, 'manual')
      return json(result)
    }

    return json({ error: 'Acción no válida' }, 400)
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }
})

async function authorize(request: Request, action: Action, trigger?: 'manual' | 'scheduled') {
  if (trigger === 'scheduled') {
    const expected = Deno.env.get('GOOGLE_SYNC_SECRET')
    if (!expected || request.headers.get('x-sync-secret') !== expected) throw new Error('Invocación programada no autorizada')
    return { userId: null as string | null }
  }

  const token = bearerToken(request)
  if (!token) throw new Error('Sesión requerida')
  const { data: userData, error: userError } = await service.auth.getUser(token)
  if (userError || !userData.user) throw new Error('Sesión inválida')
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('id,role,active')
    .eq('id', userData.user.id)
    .single()
  if (profileError || !profile?.active || profile.role !== 'admin') throw new Error('Solo Administrador puede sincronizar Google Drive')
  if (action === 'apply' && !userData.user.id) throw new Error('Usuario no identificado')
  return { userId: userData.user.id }
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : null
}

async function loadConfig() {
  const { data, error } = await service.from('google_drive_sync_config').select('*').eq('id', 1).single()
  if (error || !data) throw new Error('No existe configuración de Google Drive')
  return data as {
    id: number
    spreadsheet_id: string
    spreadsheet_url: string
    sheet_name: string
    active: boolean
    last_export_at: string | null
    last_import_at: string | null
    last_error: string | null
    last_summary: Record<string, unknown>
  }
}

function hasGoogleCredentials() {
  return Boolean(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL') && Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'))
}

async function googleAccessToken() {
  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL') ?? ''
  const privateKeyText = (Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n')
  const privateKey = await importPKCS8(privateKeyText, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/spreadsheets' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(email)
    .setSubject(email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  const payload = await response.json()
  if (!response.ok || !payload.access_token) throw new Error(`Google rechazó la autenticación: ${payload.error_description ?? payload.error ?? response.status}`)
  return payload.access_token as string
}

async function sheetsRequest(spreadsheetId: string, path: string, init?: RequestInit) {
  const token = await googleAccessToken()
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Google Sheets: ${payload.error?.message ?? response.statusText}`)
  return payload
}

async function readSheetValues(config: { spreadsheet_id: string; sheet_name: string }) {
  const range = encodeURIComponent(`${config.sheet_name}!A5:R1000`)
  const payload = await sheetsRequest(config.spreadsheet_id, `/values/${range}?valueRenderOption=FORMATTED_VALUE`)
  return (payload.values ?? []) as string[][]
}

async function pushSystemToDrive(
  config: { spreadsheet_id: string; spreadsheet_url: string; sheet_name: string },
  userId: string | null,
  triggerSource: 'manual' | 'scheduled',
) {
  const runId = await startRun('system_to_drive', triggerSource, userId)
  try {
    const currentValues = await readSheetValues(config)
    const observationsById = new Map<string, string>()
    const observationsByComposite = new Map<string, string>()
    for (let index = 1; index < currentValues.length; index += 1) {
      const row = currentValues[index] ?? []
      const appointmentId = textValue(row[16])
      const observation = textValue(row[9])
      if (appointmentId) observationsById.set(appointmentId, observation)
      observationsByComposite.set(compositeKey(textValue(row[0]), textValue(row[2]), parseDate(textValue(row[3])) ?? ''), observation)
    }

    const { data: appointments, error } = await service
      .from('appointments')
      .select('id,appointment_date,event_date,start_time,status,internal_notes,workshop_observation,spreadsheet_status,updated_at,client:clients(id,first_name,last_name),appointment_type:appointment_types(name),order:orders(order_sequence)')
      .order('appointment_date', { ascending: true })
      .order('start_time', { ascending: true })
    if (error) throw error

    const visibleRows: unknown[][] = []
    const hiddenRows: unknown[][] = []
    for (const raw of appointments ?? []) {
      const appointment = raw as Record<string, any>
      const client = firstRelation(appointment.client)
      const type = firstRelation(appointment.appointment_type)
      const order = firstRelation(appointment.order)
      const name = `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim()
      const typeName = type?.name ?? ''
      const observation = appointment.workshop_observation
        ?? observationsById.get(appointment.id)
        ?? observationsByComposite.get(compositeKey(name, typeName, appointment.appointment_date))
        ?? ''
      visibleRows.push([
        name,
        order?.order_sequence ? `PED-${String(order.order_sequence).padStart(5, '0')}` : '',
        typeName,
        displayDate(appointment.appointment_date),
        textValue(appointment.start_time).slice(0, 5),
        displayDate(internalDeliveryDate(appointment.appointment_date)),
        sheetStatus(appointment.status, appointment.spreadsheet_status),
        '',
        appointment.event_date ? displayDate(appointment.event_date) : '',
        observation,
        appointment.internal_notes ?? '',
      ])
      hiddenRows.push([appointment.id, appointment.updated_at])
    }

    await prepareSheet(config, visibleRows.length)
    const sheet = config.sheet_name.replace(/'/g, "''")
    await sheetsRequest(config.spreadsheet_id, '/values:batchClear', {
      method: 'POST',
      body: JSON.stringify({ ranges: [`'${sheet}'!A6:K1000`, `'${sheet}'!Q6:R1000`] }),
    })
    await sheetsRequest(config.spreadsheet_id, '/values:batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `'${sheet}'!E5`, values: [['Hora de cita']] },
          { range: `'${sheet}'!Q5:R5`, values: [['ID cita (sistema)', 'Actualizada en sistema']] },
          ...(visibleRows.length ? [
            { range: `'${sheet}'!A6:K${visibleRows.length + 5}`, values: visibleRows },
            { range: `'${sheet}'!Q6:R${hiddenRows.length + 5}`, values: hiddenRows },
          ] : []),
        ],
      }),
    })

    const summary = { exported: visibleRows.length }
    await finishRun(runId, 'completed', { read_count: visibleRows.length, updated_count: visibleRows.length, summary })
    await service.from('google_drive_sync_config').update({ last_export_at: new Date().toISOString(), last_error: null, last_summary: summary }).eq('id', 1)
    return summary
  } catch (error) {
    await failRun(runId, error)
    throw error
  }
}

async function prepareSheet(config: { spreadsheet_id: string; sheet_name: string }, dataRowCount: number) {
  const metadata = await sheetsRequest(config.spreadsheet_id, '?fields=sheets(properties(sheetId,title,gridProperties))')
  const sheet = metadata.sheets?.find((item: any) => item.properties?.title === config.sheet_name)?.properties
  if (!sheet) throw new Error(`No existe la pestaña ${config.sheet_name}`)
  const requests: Record<string, unknown>[] = []
  const rowCount = Number(sheet.gridProperties?.rowCount ?? 0)
  const columnCount = Number(sheet.gridProperties?.columnCount ?? 0)
  if (rowCount < dataRowCount + 6) requests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: 'ROWS', length: dataRowCount + 6 - rowCount } })
  if (columnCount < 18) requests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: 'COLUMNS', length: 18 - columnCount } })
  requests.push({ updateDimensionProperties: { range: { sheetId: sheet.sheetId, dimension: 'COLUMNS', startIndex: 16, endIndex: 18 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } })
  if (requests.length) await sheetsRequest(config.spreadsheet_id, ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) })
}

async function buildPreview(config: { spreadsheet_id: string; sheet_name: string }, userClient: SupabaseClient) {
  const values = await readSheetValues(config)
  const sheetRows = values.slice(1).map((row, index) => parseSheetRow(row, index + 6)).filter((row) => row.clientName || row.appointmentId)
  const [{ data: appointments }, { data: clients }, { data: types }] = await Promise.all([
    service.from('appointments').select('id,client_id,appointment_type_id,appointment_date,event_date,start_time,end_time,status,internal_notes,workshop_observation,spreadsheet_status,client:clients(first_name,last_name),appointment_type:appointment_types(name,duration_minutes)'),
    service.from('clients').select('id,first_name,last_name,email,active').eq('active', true),
    service.from('appointment_types').select('id,name,duration_minutes,active').eq('active', true),
  ])
  const appointmentMap = new Map((appointments ?? []).map((item: any) => [item.id, item]))
  const typeMap = new Map((types ?? []).map((item: any) => [normalize(item.name), item]))
  const clientMap = new Map<string, any[]>()
  for (const client of clients ?? []) {
    const key = normalize(`${client.first_name} ${client.last_name}`)
    clientMap.set(key, [...(clientMap.get(key) ?? []), client])
  }

  const items: PreviewItem[] = []
  for (const row of sheetRows) {
    const existing = row.appointmentId ? appointmentMap.get(row.appointmentId) : null
    const type = typeMap.get(normalize(row.appointmentType))
    const clientMatches = clientMap.get(normalize(row.clientName)) ?? []
    const existingClient = firstRelation(existing?.client)
    const existingClientName = `${existingClient?.first_name ?? ''} ${existingClient?.last_name ?? ''}`.trim()
    let item: PreviewItem = { ...row, action: 'no_change', clientId: existing?.client_id ?? clientMatches[0]?.id ?? null, appointmentTypeId: type?.id ?? null, durationMinutes: type?.duration_minutes ?? null, requiresReschedule: false, allowOutOfSlot: false, allowOverbook: false, warning: null, error: null }
    if (row.appointmentId && !existing) item = { ...item, action: 'error', error: 'El ID de la cita no existe en el sistema' }
    else if (existing && normalize(existingClientName) !== normalize(row.clientName)) item = { ...item, action: 'error', error: 'No se puede cambiar la clienta de una cita existente. Agrega una fila nueva.' }
    else if (!type) item = { ...item, action: 'error', error: 'Tipo de cita no reconocido' }
    else if (!row.appointmentDate) item = { ...item, action: 'error', error: 'Falta la fecha de la cita' }
    else if (!row.startTime) item = { ...item, action: 'error', error: 'Falta la hora de la cita' }
    else if (!existing && clientMatches.length !== 1) item = { ...item, action: 'error', error: clientMatches.length ? 'Existen varias clientas con el mismo nombre' : 'La clienta debe existir primero en el sistema' }
    else if (!existing && !clientMatches[0]?.email) item = { ...item, action: 'error', error: 'La clienta no tiene correo para enviar la confirmación' }
    else {
      const desiredStatus = normalize(row.spreadsheetStatus)
      if (existing && ['cancelled', 'no_show'].includes(existing.status) && !['cancelada', 'no asistio'].includes(desiredStatus)) {
        item = { ...item, action: 'error', error: 'Una cita cancelada o marcada como no asistió debe reactivarse desde el sistema' }
      } else if (existing && desiredStatus === 'cancelada' && existing.status !== 'cancelled') item.action = 'cancel'
      else if (existing && desiredStatus === 'no asistio' && existing.status !== 'no_show') item.action = 'no_show'
      else if (!existing) item.action = 'create'
      else if (hasAppointmentChanges(existing, row, type.id)) {
        item.action = 'update'
        item.requiresReschedule = hasSchedulingChanges(existing, row, type.id)
      }
      const slotInfo = await availability(userClient, type.id, row.appointmentDate, row.startTime, type.duration_minutes, existing?.id ?? null)
      if (slotInfo.hardBlock) {
        item = { ...item, action: 'error', error: slotInfo.reason }
      } else {
        item.allowOutOfSlot = !slotInfo.regular
        item.allowOverbook = Boolean(slotInfo.reason)
        item.warning = slotInfo.reason ? `Se registrará como sobrecupo: ${slotInfo.reason}` : (slotInfo.regular ? null : 'Horario fuera de bloque configurado')
      }
    }
    items.push(item)
  }
  return { items, summary: summarize(items) }
}

async function availability(userClient: SupabaseClient, typeId: string, date: string, time: string, duration: number, excludeId: string | null) {
  const { data, error } = await userClient.rpc('get_available_slots_v2', { p_appointment_type_id: typeId, p_date: date, p_duration_minutes: duration, p_exclude_appointment_id: excludeId })
  if (error) return { regular: false, reason: null as string | null, hardBlock: false }
  const slot = (data ?? []).find((item: any) => textValue(item.start_time).slice(0, 5) === time.slice(0, 5))
  const reason = slot?.reason ?? null
  return { regular: Boolean(slot), reason, hardBlock: isHardBlockReason(reason) }
}

async function applyPreview(config: { spreadsheet_id: string; sheet_name: string }, items: PreviewItem[], userClient: SupabaseClient, userId: string | null) {
  const runId = await startRun('drive_to_system', 'manual', userId)
  let created = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ rowNumber: number; error: string }> = []
  for (const item of items) {
    if (item.action === 'error') { errors.push({ rowNumber: item.rowNumber, error: item.error ?? 'Error' }); continue }
    if (item.action === 'no_change') { skipped += 1; continue }
    try {
      let appointmentId = item.appointmentId
      const exceptionReason = (item.allowOutOfSlot || item.allowOverbook) ? 'Carga autorizada desde Google Drive' : null
      if (item.action === 'create') {
        const { data, error } = await userClient.rpc('create_appointment_v3', {
          p_existing_client_id: item.clientId,
          p_first_name: null,
          p_last_name: null,
          p_email: null,
          p_phone: null,
          p_instagram: null,
          p_client_type_id: null,
          p_marketing_consent: false,
          p_marketing_consent_source: null,
          p_appointment_type_id: item.appointmentTypeId,
          p_date: item.appointmentDate,
          p_start_time: item.startTime,
          p_duration_minutes: item.durationMinutes,
          p_event_date: item.eventDate,
          p_internal_notes: item.internalNotes || null,
          p_allow_out_of_slot: item.allowOutOfSlot,
          p_allow_overbook: item.allowOverbook,
          p_exception_reason: exceptionReason,
        })
        if (error) throw error
        appointmentId = data as string
        created += 1
      } else if (item.action === 'cancel' || item.action === 'no_show') {
        const { error } = await userClient.rpc('change_appointment_status', { p_appointment_id: appointmentId, p_status: item.action === 'cancel' ? 'cancelled' : 'no_show', p_reason: item.action === 'cancel' ? 'Cancelada desde Google Drive' : null })
        if (error) throw error
        updated += 1
      } else if (item.action === 'update') {
        if (item.requiresReschedule) {
          const { error } = await userClient.rpc('reschedule_appointment_v3', {
            p_appointment_id: appointmentId,
            p_appointment_type_id: item.appointmentTypeId,
            p_date: item.appointmentDate,
            p_start_time: item.startTime,
            p_duration_minutes: item.durationMinutes,
            p_event_date: item.eventDate,
            p_internal_notes: item.internalNotes || null,
            p_allow_out_of_slot: item.allowOutOfSlot,
            p_allow_overbook: item.allowOverbook,
            p_exception_reason: exceptionReason,
          })
          if (error) throw error
        }
        updated += 1
      }
      if (appointmentId) {
        const status = ['Pendiente', 'Realizada', 'Entregado'].includes(item.spreadsheetStatus) ? item.spreadsheetStatus : null
        const { error } = await userClient.rpc('update_appointment_spreadsheet_fields', { p_appointment_id: appointmentId, p_workshop_observation: item.observation || null, p_spreadsheet_status: status, p_internal_notes: item.internalNotes || null, p_event_date: item.eventDate })
        if (error) throw error
      }
    } catch (error) {
      errors.push({ rowNumber: item.rowNumber, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const status = errors.length ? (created || updated ? 'partial' : 'failed') : 'completed'
  const summary = { created, updated, skipped, errors }
  await finishRun(runId, status, { read_count: items.length, created_count: created, updated_count: updated, skipped_count: skipped, error_count: errors.length, summary })
  await service.from('google_drive_sync_config').update({ last_import_at: new Date().toISOString(), last_error: errors.length ? `${errors.length} fila(s) con error` : null, last_summary: summary }).eq('id', 1)
  return summary
}

function parseSheetRow(row: string[], rowNumber: number): SheetRow {
  return {
    rowNumber,
    clientName: textValue(row[0]),
    guide: textValue(row[1]),
    appointmentType: textValue(row[2]),
    appointmentDate: parseDate(textValue(row[3])) ?? '',
    startTime: parseTime(textValue(row[4])) ?? '',
    spreadsheetStatus: textValue(row[6]),
    eventDate: parseDate(textValue(row[8])),
    observation: textValue(row[9]),
    internalNotes: textValue(row[10]),
    appointmentId: uuidValue(row[16]),
  }
}

function hasAppointmentChanges(existing: any, row: SheetRow, typeId: string) {
  return hasSchedulingChanges(existing, row, typeId)
    || (existing.event_date ?? null) !== row.eventDate
    || textValue(existing.internal_notes) !== row.internalNotes
    || textValue(existing.workshop_observation) !== row.observation
    || sheetStatus(existing.status, existing.spreadsheet_status) !== row.spreadsheetStatus
}

function hasSchedulingChanges(existing: any, row: SheetRow, typeId: string) {
  return existing.appointment_type_id !== typeId
    || existing.appointment_date !== row.appointmentDate
    || textValue(existing.start_time).slice(0, 5) !== row.startTime.slice(0, 5)
}

function isHardBlockReason(reason: string | null) {
  if (!reason) return false
  return reason === 'Feriado o cierre'
    || reason === 'Día no laborable'
    || reason.startsWith('La duración')
    || reason.startsWith('La cita debe')
    || reason.startsWith('La cita se cruza')
}

function summarize(items: PreviewItem[]) {
  const summary: Record<PreviewItem['action'] | 'overbook', number> = { create: 0, update: 0, cancel: 0, no_show: 0, no_change: 0, error: 0, overbook: 0 }
  for (const item of items) {
    summary[item.action] += 1
    if (item.allowOverbook) summary.overbook += 1
  }
  return summary
}

async function startRun(direction: string, triggerSource: string, userId: string | null) {
  const { data, error } = await service.from('google_drive_sync_runs').insert({ direction, trigger_source: triggerSource, status: 'started', triggered_by: userId }).select('id').single()
  if (error) throw error
  return data.id as string
}

async function finishRun(runId: string, status: string, fields: Record<string, unknown>) {
  await service.from('google_drive_sync_runs').update({ status, finished_at: new Date().toISOString(), ...fields }).eq('id', runId)
}

async function failRun(runId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  await finishRun(runId, 'failed', { error_count: 1, error_message: message })
  await service.from('google_drive_sync_config').update({ last_error: message }).eq('id', 1)
}

function sheetStatus(status: string, spreadsheetStatus: string | null) {
  if (status === 'cancelled') return 'Cancelada'
  if (status === 'no_show') return 'No asistió'
  return spreadsheetStatus ?? 'Pendiente'
}

function internalDeliveryDate(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 2)
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1)
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() - 2)
  return date.toISOString().slice(0, 10)
}

function displayDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

function parseDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!match) return null
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

function parseTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function compositeKey(name: string, type: string, date: string) {
  return `${normalize(name)}|${normalize(type)}|${date}`
}

function textValue(value: unknown) {
  return value == null ? '' : String(value).trim()
}

function uuidValue(value: unknown) {
  const text = textValue(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null
}

function firstRelation(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
