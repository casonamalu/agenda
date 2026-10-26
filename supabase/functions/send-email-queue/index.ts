import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.8'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'npm:pdf-lib@1.17.1'
import writeXlsxFile from 'npm:write-excel-file@4.1.1/universal'

interface QueueItem {
  id: string
  idempotency_key: string
  appointment_id: string | null
  report_id: string | null
  report_run_date: string | null
  recipient: string
  kind: string
  attempts: number
}

type SettingsMap = Record<string, unknown>

interface BuiltEmail {
  subject: string
  html: string
  replyTo: string
  attachments?: Array<{
    filename: string
    content: string
  }>
  skipReason?: string
}

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

    const expectedSecret = Deno.env.get('CRON_SECRET')
    if (!expectedSecret || !secureEqual(request.headers.get('x-cron-secret') ?? '', expectedSecret)) {
      return json({ error: 'No autorizado' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!
    const fromAddress = Deno.env.get('EMAIL_FROM')!
    if (!resendApiKey || !fromAddress) return json({ error: 'Faltan RESEND_API_KEY o EMAIL_FROM' }, 500)

    const settingsMap = await loadSettings(supabase)
    const retryMinutes = numberArraySetting(settingsMap, 'notification_retry_minutes', [5, 30, 120])
    const batchSize = integerSetting(settingsMap, 'notification_batch_size', 20, 1, 100)
    const processingTimeout = integerSetting(settingsMap, 'notification_processing_timeout_minutes', 15, 1, 120)
    const adminAlerts = booleanSetting(settingsMap, 'notification_admin_alerts', true)

    const staleBefore = new Date(Date.now() - processingTimeout * 60_000).toISOString()
    const { error: recoveryError } = await supabase
      .from('email_queue')
      .update({
        status: 'retry',
        scheduled_for: new Date().toISOString(),
        last_error: 'El procesamiento anterior quedó interrumpido; se recuperó automáticamente.',
      })
      .eq('status', 'processing')
      .lt('updated_at', staleBefore)
    if (recoveryError) return json({ error: recoveryError.message }, 500)

    const { data: items, error: queueError } = await supabase
      .from('email_queue')
      .select('id, idempotency_key, appointment_id, report_id, report_run_date, recipient, kind, attempts')
      .in('status', ['pending', 'retry'])
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for')
      .limit(batchSize)

    if (queueError) return json({ error: queueError.message }, 500)

    const results = []
    for (const item of (items ?? []) as QueueItem[]) {
      const claimed = await claimItem(supabase, item.id)
      if (!claimed) continue
      try {
        const email = await buildEmail(supabase, item, settingsMap)
        if (email.skipReason) {
          await supabase.from('email_queue').update({
            status: 'cancelled',
            attempts: item.attempts,
            last_error: email.skipReason,
          }).eq('id', item.id)
          results.push({ id: item.id, status: 'cancelled', reason: email.skipReason })
          continue
        }
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `casona-malu-email/${item.idempotency_key}`,
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [item.recipient],
            reply_to: email.replyTo || undefined,
            subject: email.subject,
            html: email.html,
            attachments: email.attachments?.length ? email.attachments : undefined,
          }),
        })
        const responseBody = await response.json()
        if (!response.ok) throw new Error(responseBody?.message ?? `Resend respondió ${response.status}`)
        const { error: sentUpdateError } = await supabase.from('email_queue').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: responseBody.id ?? null,
          rendered_subject: email.subject,
          rendered_html: email.html,
          attempts: item.attempts + 1,
          last_error: null,
        }).eq('id', item.id)
        if (sentUpdateError) throw new Error(`El proveedor aceptó el correo, pero no se pudo confirmar en la cola: ${sentUpdateError.message}`)
        results.push({ id: item.id, status: 'sent' })
      } catch (error) {
        const attempts = item.attempts + 1
        const finalFailure = attempts >= retryMinutes.length + 1
        const nextDate = new Date(Date.now() + retryMinutes[Math.min(attempts - 1, retryMinutes.length - 1)] * 60_000)
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
        await supabase.from('email_queue').update({
          status: finalFailure ? 'failed' : 'retry',
          attempts,
          last_error: errorMessage,
          scheduled_for: finalFailure ? new Date().toISOString() : nextDate.toISOString(),
        }).eq('id', item.id)
        if (finalFailure && adminAlerts) {
          await notifyAdmins(supabase, resendApiKey, fromAddress, item, errorMessage)
        }
        results.push({ id: item.id, status: finalFailure ? 'failed' : 'retry' })
      }
    }

    return json({ processed: results.length, results })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado' }, 500)
  }
})

async function claimItem(supabase: SupabaseClient<any>, id: string) {
  const { data } = await supabase
    .from('email_queue')
    .update({ status: 'processing' })
    .eq('id', id)
    .in('status', ['pending', 'retry'])
    .select('id')
  return Boolean(data?.length)
}

async function loadSettings(supabase: SupabaseClient<any>): Promise<SettingsMap> {
  const { data, error } = await supabase.from('app_settings').select('setting_key,setting_value')
  if (error) throw new Error(`No fue posible cargar la configuración: ${error.message}`)
  return Object.fromEntries((data ?? []).map((setting) => [setting.setting_key, setting.setting_value]))
}

async function buildEmail(
  supabase: SupabaseClient<any>,
  item: QueueItem,
  settingsMap: SettingsMap,
): Promise<BuiltEmail> {
  if (item.kind === 'report') {
    return buildReportEmail(supabase, item, settingsMap)
  }
  if (!item.appointment_id) throw new Error('Correo sin cita asociada')
  const [{ data: appointment, error: appointmentError }, { data: template, error: templateError }] = await Promise.all([
    supabase
      .from('appointments')
      .select('appointment_date,start_time,end_time,client:clients(first_name,last_name,email),participants:appointment_participants(client:clients(first_name,last_name,email)),appointment_type:appointment_types(name,duration_minutes)')
      .eq('id', item.appointment_id)
      .single(),
    supabase.from('email_templates').select('subject,body_html,active').eq('template_key', item.kind).single(),
  ])
  if (appointmentError || !appointment) throw new Error('No fue posible cargar la cita')
  if (templateError || !template?.active) throw new Error(`Plantilla ${item.kind} no disponible`)

  const primaryClient = Array.isArray(appointment.client) ? appointment.client[0] : appointment.client
  const participantClients = (appointment.participants ?? []).flatMap((participant) => {
    const client = Array.isArray(participant.client) ? participant.client[0] : participant.client
    return client ? [client] : []
  })
  const client = [primaryClient, ...participantClients].find(
    (candidate) => candidate?.email?.toLowerCase() === item.recipient.toLowerCase(),
  ) ?? primaryClient
  const appointmentType = Array.isArray(appointment.appointment_type) ? appointment.appointment_type[0] : appointment.appointment_type
  const timezone = stringSetting(settingsMap, 'timezone', 'America/Santiago')
  const startTime = String(appointment.start_time).slice(0, 5)
  const endTime = String(appointment.end_time).slice(0, 5)
  const durationMinutes = timeDifference(startTime, endTime)
  const extended = durationMinutes > Number(appointmentType?.duration_minutes ?? durationMinutes)
  const variables: Record<string, string> = {
    nombre: client?.first_name ?? '',
    apellido: client?.last_name ?? '',
    tipo_cita: appointmentType?.name ?? '',
    fecha: new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: timezone }).format(new Date(`${appointment.appointment_date}T12:00:00Z`)),
    hora: startTime,
    hora_termino: endTime,
    duracion: String(durationMinutes),
    horario: extended ? `${startTime} a ${endTime} (${durationMinutes} minutos)` : startTime,
    direccion: stringSetting(settingsMap, 'address', ''),
    telefono: stringSetting(settingsMap, 'contact_phone', ''),
    instagram: stringSetting(settingsMap, 'instagram', ''),
    correo_contacto: stringSetting(settingsMap, 'contact_email', ''),
  }
  return {
    subject: renderSubject(template.subject, variables),
    html: renderHtml(template.body_html, variables),
    replyTo: stringSetting(settingsMap, 'contact_email', ''),
  }
}

async function buildReportEmail(
  supabase: SupabaseClient<any>,
  item: QueueItem,
  settingsMap: SettingsMap,
): Promise<BuiltEmail> {
  if (!item.report_id) throw new Error('Reporte sin programación asociada')

  const { data: report, error: reportError } = await supabase
    .from('scheduled_reports')
    .select('name,period_type,appointment_type_ids,statuses,selected_fields,output_format,send_empty')
    .eq('id', item.report_id)
    .single()

  if (reportError || !report) throw new Error('No fue posible cargar la programación del reporte')

  const timezone = stringSetting(settingsMap, 'timezone', 'America/Santiago')
  const runDate = item.report_run_date ?? localIsoDate(new Date(), timezone)
  let from = runDate
  let to = runDate
  if (report.period_type === 'tomorrow') {
    from = addDays(runDate, 1)
    to = from
  } else if (report.period_type === 'week') {
    to = addDays(runDate, 6)
  } else if (report.period_type === 'fortnight') {
    to = addDays(runDate, 13)
  } else if (report.period_type === 'next_30_days') {
    to = addDays(runDate, 29)
  } else if (report.period_type === 'next_31_days') {
    to = addDays(runDate, 30)
  }

  let query = supabase
    .from('appointments')
    .select('appointment_date,event_date,start_time,end_time,status,client:clients(first_name,last_name,phone),participants:appointment_participants(client:clients(first_name,last_name,phone)),appointment_type:appointment_types(name)')
    .gte('appointment_date', from)
    .lte('appointment_date', to)
    .order('appointment_date')
    .order('start_time')

  if (Array.isArray(report.appointment_type_ids) && report.appointment_type_ids.length) {
    query = query.in('appointment_type_id', report.appointment_type_ids)
  }
  if (Array.isArray(report.statuses) && report.statuses.length) {
    query = query.in('status', report.statuses)
  }

  const { data: appointments, error: appointmentsError } = await query
  if (appointmentsError) throw new Error(`No fue posible preparar el reporte: ${appointmentsError.message}`)

  if (!appointments?.length && !report.send_empty) {
    return {
      subject: '',
      html: '',
      replyTo: '',
      skipReason: 'Reporte omitido porque no existen citas para el período configurado.',
    }
  }

  const selectedFields = Array.isArray(report.selected_fields) && report.selected_fields.length
    ? report.selected_fields
    : ['date', 'time', 'appointment_type', 'client_name', 'phone', 'status']
  const fieldDefinitions = reportFieldDefinitions()
  const configuredFields = selectedFields
    .map((key) => fieldDefinitions[key])
    .filter((field): field is { key: string; label: string; width: number } => Boolean(field))
  const visibleFields = configuredFields.length
    ? configuredFields
    : ['date', 'time', 'appointment_type', 'client_name', 'phone', 'status'].map((key) => fieldDefinitions[key])
  const reportRows = buildReportRows((appointments ?? []) as Array<Record<string, unknown>>)
  const rows = reportRows.map((row) => (
    `<tr>${visibleFields.map((field) => `<td style="padding:8px;border-bottom:1px solid #e4dcd7">${escapeHtml(row[field.key] ?? '')}</td>`).join('')}</tr>`
  )).join('')

  const periodText = from === to
    ? formatReportDate(from, timezone)
    : `${formatReportDate(from, timezone)} al ${formatReportDate(to, timezone)}`
  const businessName = stringSetting(settingsMap, 'business_name', 'Casona Malú')
  const emptyRow = `<tr><td colspan="${Math.max(1, visibleFields.length)}" style="padding:16px;text-align:center;color:#776d68">No existen citas para el período.</td></tr>`
  const outputFormat = report.output_format === 'pdf' ? 'pdf' : 'xlsx'
  const attachment = outputFormat === 'pdf'
    ? await buildReportPdf(reportRows, visibleFields, String(report.name), periodText)
    : await buildReportWorkbook(reportRows, visibleFields)
  const formatLabel = outputFormat === 'pdf' ? 'PDF' : 'Excel'

  return {
    subject: `${report.name} – ${periodText}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#302825">
        <h2 style="color:#7f3f52">${escapeHtml(report.name)}</h2>
        <p><strong>${escapeHtml(businessName)}</strong> · ${escapeHtml(periodText)}</p>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr>${visibleFields.map((field) => `<th style="padding:8px;text-align:left;background:#f2ece8">${escapeHtml(field.label)}</th>`).join('')}</tr>
          </thead>
          <tbody>${rows || emptyRow}</tbody>
        </table>
        <p>Se adjunta el reporte en formato ${formatLabel} con las columnas configuradas.</p>
        <p style="color:#776d68;font-size:12px">Generado automáticamente por Agenda Casona Malú.</p>
      </div>
    `,
    replyTo: stringSetting(settingsMap, 'contact_email', ''),
    attachments: [{
      filename: `reporte-${from}-al-${to}.${outputFormat}`,
      content: attachment,
    }],
  }
}

function buildReportRows(appointments: Array<Record<string, unknown>>): Array<Record<string, string>> {
  return appointments.map((appointment) => {
    const primaryClient = firstRelation(appointment.client)
    const participantClients = Array.isArray(appointment.participants)
      ? appointment.participants.flatMap((participant) => {
        if (!participant || typeof participant !== 'object') return []
        const client = firstRelation((participant as Record<string, unknown>).client)
        return client ? [client] : []
      })
      : []
    const clients = [primaryClient, ...participantClients].filter((client): client is Record<string, unknown> => Boolean(client))
    const type = firstRelation(appointment.appointment_type)
    const typeName = String(type?.name ?? '')
    const appointmentDate = String(appointment.appointment_date ?? '')
    const eventDate = String(appointment.event_date ?? '')
    const startTime = String(appointment.start_time ?? '').slice(0, 5)
    const endTime = String(appointment.end_time ?? '').slice(0, 5)

    return {
      client_name: clients.map((client) => `${String(client.first_name ?? '')} ${String(client.last_name ?? '')}`.trim()).filter(Boolean).join(' + '),
      phone: clients.map((client) => String(client.phone ?? '')).filter(Boolean).join(' · '),
      appointment_type: typeName === 'Entrega' ? 'Entrega cliente' : typeName,
      date: shortDate(appointmentDate),
      time: startTime && endTime ? `${startTime}–${endTime}` : startTime,
      internal_delivery_date: ['Prueba 1', 'Prueba 2', 'Entrega'].includes(typeName) ? shortDate(addDays(appointmentDate, -2)) : '',
      event_date: shortDate(eventDate),
      status: statusLabel(String(appointment.status ?? '')),
      observation: '',
    }
  })
}

async function buildReportWorkbook(
  rows: Array<Record<string, string>>,
  fields: Array<{ key: string; label: string; width: number }>,
) {
  const headerStyle = {
    backgroundColor: '#874158',
    color: '#FFFFFF',
    fontWeight: 'bold' as const,
    align: 'center' as const,
  }
  const sheetData = [
    fields.map((field) => ({ value: field.label, ...headerStyle })),
    ...rows.map((row) => fields.map((field) => ({
      value: row[field.key] ?? '',
      align: ['date', 'time', 'internal_delivery_date', 'event_date', 'status'].includes(field.key) ? 'center' as const : 'left' as const,
    }))),
  ]

  const blob = await writeXlsxFile(sheetData, {
    columns: fields.map((field) => ({ width: field.width })),
    sheet: 'Reporte',
  }).toBlob()
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

async function buildReportPdf(
  rows: Array<Record<string, string>>,
  fields: Array<{ key: string; label: string; width: number }>,
  title: string,
  periodText: string,
) {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const pageWidth = 841.89
  const pageHeight = 595.28
  const margin = 28
  const contentWidth = pageWidth - margin * 2
  const totalWidth = fields.reduce((sum, field) => sum + field.width, 0) || 1
  const columnWidths = fields.map((field) => contentWidth * field.width / totalWidth)
  const rowHeight = 22
  let page = document.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const drawHeading = () => {
    page.drawText(fitPdfText(title, contentWidth, bold, 17), { x: margin, y, size: 17, font: bold, color: rgb(0.50, 0.25, 0.32) })
    y -= 20
    page.drawText(fitPdfText(periodText, contentWidth, regular, 10), { x: margin, y, size: 10, font: regular, color: rgb(0.38, 0.34, 0.36) })
    y -= 20
  }

  const drawHeader = () => {
    let x = margin
    fields.forEach((field, index) => {
      page.drawRectangle({ x, y: y - rowHeight + 5, width: columnWidths[index], height: rowHeight, color: rgb(0.53, 0.25, 0.35) })
      page.drawText(fitPdfText(field.label, columnWidths[index] - 8, bold, 8), { x: x + 4, y: y - 10, size: 8, font: bold, color: rgb(1, 1, 1) })
      x += columnWidths[index]
    })
    y -= rowHeight
  }

  const addPage = () => {
    page = document.addPage([pageWidth, pageHeight])
    y = pageHeight - margin
    drawHeading()
    drawHeader()
  }

  drawHeading()
  drawHeader()
  if (!rows.length) {
    page.drawText('No existen citas para los filtros seleccionados.', { x: margin + 4, y: y - 12, size: 10, font: regular })
  }
  rows.forEach((row, rowIndex) => {
    if (y - rowHeight < margin) addPage()
    let x = margin
    if (rowIndex % 2 === 1) page.drawRectangle({ x, y: y - rowHeight + 5, width: contentWidth, height: rowHeight, color: rgb(0.97, 0.95, 0.96) })
    fields.forEach((field, index) => {
      page.drawText(fitPdfText(row[field.key] ?? '', columnWidths[index] - 8, regular, 8), { x: x + 4, y: y - 10, size: 8, font: regular, color: rgb(0.16, 0.12, 0.14) })
      x += columnWidths[index]
    })
    y -= rowHeight
  })

  return bytesToBase64(await document.save())
}

function firstRelation(value: unknown): Record<string, unknown> | null {
  const relation = Array.isArray(value) ? value[0] : value
  return relation && typeof relation === 'object' ? relation as Record<string, unknown> : null
}

function shortDate(value: string) {
  if (!value) return ''
  const [year, month, day] = value.split('-')
  return `${day}-${month}-${year}`
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function fitPdfText(value: string, maxWidth: number, font: PDFFont, size: number) {
  const safeValue = value.replace(/[^\x00-\xff]/g, '-')
  if (font.widthOfTextAtSize(safeValue, size) <= maxWidth) return safeValue
  let shortened = safeValue
  while (shortened.length && font.widthOfTextAtSize(`${shortened}...`, size) > maxWidth) shortened = shortened.slice(0, -1)
  return `${shortened}...`
}

function render(value: string, variables: Record<string, string>) {
  return value.replace(/{{\s*([a-z_]+)\s*}}/gi, (_match, key) => variables[key] ?? '')
}

function renderHtml(value: string, variables: Record<string, string>) {
  return render(value, Object.fromEntries(
    Object.entries(variables).map(([key, variable]) => [key, escapeHtml(variable)]),
  ))
}

function renderSubject(value: string, variables: Record<string, string>) {
  return render(value, variables).replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200)
}

function secureEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  if (leftBytes.length !== rightBytes.length) return false
  let difference = 0
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index]
  }
  return difference === 0
}

async function notifyAdmins(
  supabase: SupabaseClient<any>,
  apiKey: string,
  fromAddress: string,
  item: QueueItem,
  errorMessage: string,
) {
  const { data: admins } = await supabase.from('profiles').select('email').eq('role', 'admin').eq('active', true)
  const recipients = (admins ?? []).map((admin) => admin.email).filter(Boolean)
  if (!recipients.length) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `casona-malu-alert/${item.idempotency_key}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: recipients,
      subject: 'Alerta: correo no enviado – Agenda Casona Malú',
      html: `<p>El correo a <strong>${escapeHtml(item.recipient)}</strong> falló definitivamente.</p><p>Tipo: ${escapeHtml(item.kind)}</p><p>Error: ${escapeHtml(errorMessage)}</p>`,
    }),
  })
}

function stringSetting(settings: SettingsMap, key: string, fallback: string) {
  const value = settings[key]
  return typeof value === 'string' ? value : fallback
}

function integerSetting(settings: SettingsMap, key: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(settings[key])
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

function booleanSetting(settings: SettingsMap, key: string, fallback: boolean) {
  const value = settings[key]
  return typeof value === 'boolean' ? value : fallback
}

function numberArraySetting(settings: SettingsMap, key: string, fallback: number[]) {
  const value = settings[key]
  if (!Array.isArray(value)) return fallback
  const parsed = value.map(Number).filter((item) => Number.isInteger(item) && item > 0 && item <= 1440)
  return parsed.length ? parsed.slice(0, 10) : fallback
}

function localIsoDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatReportDate(isoDate: string, timezone: string) {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'long',
    timeZone: timezone,
  }).format(new Date(`${isoDate}T12:00:00Z`))
}

function reportFieldDefinitions(): Record<string, { key: string; label: string; width: number }> {
  return {
    client_name: { key: 'client_name', label: 'Clienta', width: 27 },
    phone: { key: 'phone', label: 'Teléfono', width: 18 },
    appointment_type: { key: 'appointment_type', label: 'Tipo de cita', width: 18 },
    date: { key: 'date', label: 'Fecha cita', width: 15 },
    time: { key: 'time', label: 'Horario', width: 15 },
    internal_delivery_date: { key: 'internal_delivery_date', label: 'Entrega interna', width: 17 },
    event_date: { key: 'event_date', label: 'Fecha evento (sistema)', width: 21 },
    status: { key: 'status', label: 'Estado', width: 15 },
    observation: { key: 'observation', label: 'Observación', width: 34 },
  }
}

function statusLabel(status: string) {
  return ({
    scheduled: 'Agendada',
    rescheduled: 'Reprogramada',
    cancelled: 'Cancelada',
    no_show: 'No asistió',
  } as Record<string, string>)[status] ?? status
}

function timeDifference(start: string, end: string) {
  const [startHour, startMinute] = start.split(':').map(Number)
  const [endHour, endMinute] = end.split(':').map(Number)
  return Math.max(0, (endHour * 60 + endMinute) - (startHour * 60 + startMinute))
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
