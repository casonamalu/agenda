import type { EmailQueueItem } from '../types'

export interface EmailTemplateSnapshot {
  template_key: string
  subject: string
  body_html: string
}

export interface EmailPreview {
  subject: string
  html: string
  exact: boolean
}

type SettingsMap = Record<string, unknown>

export function buildEmailPreview(
  item: EmailQueueItem,
  templates: EmailTemplateSnapshot[],
  settings: SettingsMap,
): EmailPreview | null {
  if (item.rendered_subject && item.rendered_html) {
    return { subject: item.rendered_subject, html: item.rendered_html, exact: true }
  }

  const appointment = item.appointment
  const template = templates.find((candidate) => candidate.template_key === item.kind)
  if (!appointment || !template) return null

  const clients = [
    appointment.client,
    ...(appointment.participants ?? []).map((participant) => participant.client),
  ].filter(Boolean)
  const client = clients.find(
    (candidate) => candidate?.email.toLocaleLowerCase('es-CL') === item.recipient.toLocaleLowerCase('es-CL'),
  ) ?? appointment.client

  const startTime = appointment.start_time.slice(0, 5)
  const endTime = appointment.end_time.slice(0, 5)
  const durationMinutes = timeDifference(startTime, endTime)
  const configuredDuration = appointment.appointment_type?.duration_minutes ?? durationMinutes
  const timezone = stringSetting(settings, 'timezone', 'America/Santiago')
  const variables: Record<string, string> = {
    nombre: client?.first_name ?? '',
    apellido: client?.last_name ?? '',
    tipo_cita: appointment.appointment_type?.name ?? '',
    fecha: new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: timezone })
      .format(new Date(`${appointment.appointment_date}T12:00:00Z`)),
    hora: startTime,
    hora_termino: endTime,
    duracion: String(durationMinutes),
    horario: durationMinutes > configuredDuration
      ? `${startTime} a ${endTime} (${durationMinutes} minutos)`
      : startTime,
    direccion: stringSetting(settings, 'address', ''),
    telefono: stringSetting(settings, 'contact_phone', ''),
    instagram: stringSetting(settings, 'instagram', ''),
    correo_contacto: stringSetting(settings, 'contact_email', ''),
  }

  return {
    subject: renderSubject(template.subject, variables),
    html: renderHtml(template.body_html, variables),
    exact: false,
  }
}

function render(value: string, variables: Record<string, string>) {
  return value.replace(/{{\s*([a-z_]+)\s*}}/gi, (_match, key: string) => variables[key] ?? '')
}

function renderHtml(value: string, variables: Record<string, string>) {
  return render(value, Object.fromEntries(
    Object.entries(variables).map(([key, variable]) => [key, escapeHtml(variable)]),
  ))
}

function renderSubject(value: string, variables: Record<string, string>) {
  return render(value, variables).replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200)
}

function timeDifference(start: string, end: string) {
  const [startHour, startMinute] = start.split(':').map(Number)
  const [endHour, endMinute] = end.split(':').map(Number)
  return Math.max(0, (endHour * 60 + endMinute) - (startHour * 60 + startMinute))
}

function stringSetting(settings: SettingsMap, key: string, fallback: string) {
  return typeof settings[key] === 'string' ? settings[key] as string : fallback
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!)
}
