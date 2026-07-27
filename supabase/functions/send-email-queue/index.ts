import { createClient } from 'npm:@supabase/supabase-js@2'

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
  skipReason?: string
}

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

    const expectedSecret = Deno.env.get('CRON_SECRET')
    if (!expectedSecret || request.headers.get('x-cron-secret') !== expectedSecret) {
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
          }),
        })
        const responseBody = await response.json()
        if (!response.ok) throw new Error(responseBody?.message ?? `Resend respondió ${response.status}`)
        const { error: sentUpdateError } = await supabase.from('email_queue').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: responseBody.id ?? null,
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

async function claimItem(supabase: ReturnType<typeof createClient>, id: string) {
  const { data } = await supabase
    .from('email_queue')
    .update({ status: 'processing' })
    .eq('id', id)
    .in('status', ['pending', 'retry'])
    .select('id')
  return Boolean(data?.length)
}

async function loadSettings(supabase: ReturnType<typeof createClient>): Promise<SettingsMap> {
  const { data, error } = await supabase.from('app_settings').select('setting_key,setting_value')
  if (error) throw new Error(`No fue posible cargar la configuración: ${error.message}`)
  return Object.fromEntries((data ?? []).map((setting) => [setting.setting_key, setting.setting_value]))
}

async function buildEmail(
  supabase: ReturnType<typeof createClient>,
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
      .select('appointment_date,start_time,client:clients(first_name,last_name,email),appointment_type:appointment_types(name)')
      .eq('id', item.appointment_id)
      .single(),
    supabase.from('email_templates').select('subject,body_html,active').eq('template_key', item.kind).single(),
  ])
  if (appointmentError || !appointment) throw new Error('No fue posible cargar la cita')
  if (templateError || !template?.active) throw new Error(`Plantilla ${item.kind} no disponible`)

  const client = Array.isArray(appointment.client) ? appointment.client[0] : appointment.client
  const appointmentType = Array.isArray(appointment.appointment_type) ? appointment.appointment_type[0] : appointment.appointment_type
  const timezone = stringSetting(settingsMap, 'timezone', 'America/Santiago')
  const variables: Record<string, string> = {
    nombre: client?.first_name ?? '',
    apellido: client?.last_name ?? '',
    tipo_cita: appointmentType?.name ?? '',
    fecha: new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: timezone }).format(new Date(`${appointment.appointment_date}T12:00:00Z`)),
    hora: String(appointment.start_time).slice(0, 5),
    direccion: stringSetting(settingsMap, 'address', ''),
    telefono: stringSetting(settingsMap, 'contact_phone', ''),
    instagram: stringSetting(settingsMap, 'instagram', ''),
    correo_contacto: stringSetting(settingsMap, 'contact_email', ''),
  }
  return {
    subject: render(template.subject, variables),
    html: render(template.body_html, variables),
    replyTo: stringSetting(settingsMap, 'contact_email', ''),
  }
}

async function buildReportEmail(
  supabase: ReturnType<typeof createClient>,
  item: QueueItem,
  settingsMap: SettingsMap,
): Promise<BuiltEmail> {
  if (!item.report_id) throw new Error('Reporte sin programación asociada')

  const { data: report, error: reportError } = await supabase
    .from('scheduled_reports')
    .select('name,period_type,appointment_type_ids,statuses,selected_fields,send_empty')
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
  }

  let query = supabase
    .from('appointments')
    .select('appointment_date,start_time,status,client:clients(first_name,last_name,phone),appointment_type:appointment_types(name)')
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
  const visibleFields = selectedFields
    .map((key) => fieldDefinitions[key])
    .filter((field): field is { key: string; label: string } => Boolean(field))

  const rows = (appointments ?? []).map((appointment) => {
    const client = Array.isArray(appointment.client) ? appointment.client[0] : appointment.client
    const type = Array.isArray(appointment.appointment_type) ? appointment.appointment_type[0] : appointment.appointment_type
    const values: Record<string, string> = {
      date: formatReportDate(appointment.appointment_date, timezone),
      time: String(appointment.start_time).slice(0, 5),
      appointment_type: type?.name ?? '',
      client_name: `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim(),
      phone: client?.phone ?? '',
      status: statusLabel(appointment.status),
    }
    return `<tr>${visibleFields.map((field) => `<td style="padding:8px;border-bottom:1px solid #e4dcd7">${escapeHtml(values[field.key] ?? '')}</td>`).join('')}</tr>`
  }).join('')

  const periodText = from === to
    ? formatReportDate(from, timezone)
    : `${formatReportDate(from, timezone)} al ${formatReportDate(to, timezone)}`
  const businessName = stringSetting(settingsMap, 'business_name', 'Casona Malú')
  const emptyRow = `<tr><td colspan="${Math.max(1, visibleFields.length)}" style="padding:16px;text-align:center;color:#776d68">No existen citas para el período.</td></tr>`

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
        <p style="color:#776d68;font-size:12px">Generado automáticamente por Agenda Casona Malú.</p>
      </div>
    `,
    replyTo: stringSetting(settingsMap, 'contact_email', ''),
  }
}

function render(value: string, variables: Record<string, string>) {
  return value.replace(/{{\s*([a-z_]+)\s*}}/gi, (_match, key) => variables[key] ?? '')
}

async function notifyAdmins(
  supabase: ReturnType<typeof createClient>,
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

function reportFieldDefinitions(): Record<string, { key: string; label: string }> {
  return {
    date: { key: 'date', label: 'Fecha' },
    time: { key: 'time', label: 'Hora' },
    appointment_type: { key: 'appointment_type', label: 'Tipo de cita' },
    client_name: { key: 'client_name', label: 'Cliente' },
    phone: { key: 'phone', label: 'Teléfono' },
    status: { key: 'status', label: 'Estado' },
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

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
