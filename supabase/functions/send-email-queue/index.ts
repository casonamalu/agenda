import { createClient } from 'npm:@supabase/supabase-js@2'

interface QueueItem {
  id: string
  appointment_id: string | null
  recipient: string
  kind: string
  attempts: number
}

const retryMinutes = [5, 30, 120]

Deno.serve(async (request) => {
  try {
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

    const { data: items, error: queueError } = await supabase
      .from('email_queue')
      .select('id, appointment_id, recipient, kind, attempts')
      .in('status', ['pending', 'retry'])
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for')
      .limit(20)

    if (queueError) return json({ error: queueError.message }, 500)

    const results = []
    for (const item of (items ?? []) as QueueItem[]) {
      const claimed = await claimItem(supabase, item.id)
      if (!claimed) continue
      try {
        const email = await buildEmail(supabase, item)
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [item.recipient],
            subject: email.subject,
            html: email.html,
          }),
        })
        const responseBody = await response.json()
        if (!response.ok) throw new Error(responseBody?.message ?? `Resend respondió ${response.status}`)
        await supabase.from('email_queue').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: responseBody.id ?? null,
          attempts: item.attempts + 1,
          last_error: null,
        }).eq('id', item.id)
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
        if (finalFailure) await notifyAdmins(supabase, resendApiKey, fromAddress, item, errorMessage)
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

async function buildEmail(supabase: ReturnType<typeof createClient>, item: QueueItem) {
  if (!item.appointment_id) throw new Error('Correo sin cita asociada')
  const [{ data: appointment, error: appointmentError }, { data: template, error: templateError }, { data: settings }] = await Promise.all([
    supabase
      .from('appointments')
      .select('appointment_date,start_time,client:clients(first_name,last_name,email),appointment_type:appointment_types(name)')
      .eq('id', item.appointment_id)
      .single(),
    supabase.from('email_templates').select('subject,body_html,active').eq('template_key', item.kind).single(),
    supabase.from('app_settings').select('setting_key,setting_value'),
  ])
  if (appointmentError || !appointment) throw new Error('No fue posible cargar la cita')
  if (templateError || !template?.active) throw new Error(`Plantilla ${item.kind} no disponible`)

  const settingsMap = Object.fromEntries((settings ?? []).map((setting) => [setting.setting_key, setting.setting_value]))
  const client = Array.isArray(appointment.client) ? appointment.client[0] : appointment.client
  const appointmentType = Array.isArray(appointment.appointment_type) ? appointment.appointment_type[0] : appointment.appointment_type
  const variables: Record<string, string> = {
    nombre: client?.first_name ?? '',
    apellido: client?.last_name ?? '',
    tipo_cita: appointmentType?.name ?? '',
    fecha: new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }).format(new Date(`${appointment.appointment_date}T12:00:00-04:00`)),
    hora: String(appointment.start_time).slice(0, 5),
    direccion: String(settingsMap.address ?? ''),
    telefono: String(settingsMap.contact_phone ?? ''),
    instagram: String(settingsMap.instagram ?? ''),
    correo_contacto: String(settingsMap.contact_email ?? ''),
  }
  return {
    subject: render(template.subject, variables),
    html: render(template.body_html, variables),
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
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress,
      to: recipients,
      subject: 'Alerta: correo no enviado – Agenda Casona Malú',
      html: `<p>El correo a <strong>${escapeHtml(item.recipient)}</strong> falló definitivamente.</p><p>Tipo: ${escapeHtml(item.kind)}</p><p>Error: ${escapeHtml(errorMessage)}</p>`,
    }),
  })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
