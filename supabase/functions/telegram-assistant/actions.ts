import { normalizeText } from './intent.ts'

export type AppointmentDraft = {
  appointmentType: string
  firstName: string
  lastName: string
  email: string
  phone: string
  instagram: string | null
  clientType: string
  appointmentDate: string
  startTime: string
  eventDate: string | null
  notes: string | null
}

export type AppointmentParseResult =
  | { ok: true; draft: AppointmentDraft }
  | { ok: false; errors: string[] }

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
}

const CLIENT_TYPES = ['Novia', 'Madrina', 'Graduación', 'Hombre', 'Invitada']

export function looksLikeAppointmentRequest(value: string) {
  const text = normalizeText(value)
  return /(^|\n)\s*(venta|prueba\s*[12]?|entrega)\s*($|\n)/.test(text)
    && /[\w.+-]+\\?@[\w.-]+\.[a-z]{2,}/i.test(value)
}

export function parseAppointmentDraft(rawText: string, today: string): AppointmentParseResult {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const normalized = lines.map(normalizeText)
  const errors: string[] = []

  const appointmentType = findAppointmentType(normalized)
  const email = (rawText.match(/[\w.+-]+\\?@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? '')
    .replace('\\@', '@').toLowerCase()
  const phoneLine = lines.find((line) => /\b(cel|fono|telefono|teléfono|whatsapp)\b/i.test(line))
  const phoneDigits = (phoneLine ?? '').replace(/\D/g, '')
  const phone = normalizePhone(phoneDigits)
  const clientType = CLIENT_TYPES.find((type) => normalized.includes(normalizeText(type))) ?? ''
  const instagramLine = lines.find((line) => /instagram|^@/i.test(line))
  const instagram = instagramLine && !/no\s+(tengo|usa|tiene)/i.test(instagramLine)
    ? (instagramLine.match(/@[a-z0-9._]+/i)?.[0] ?? instagramLine.replace(/instagram\s*:?/i, '').trim()).replace(/^@/, '') || null
    : null

  const excluded = new Set<number>()
  normalized.forEach((line, index) => {
    if (findAppointmentType([line]) || line === normalizeText(clientType) || /@|\b(cel|fono|telefono|instagram|whatsapp)\b/.test(line)) excluded.add(index)
  })
  const nameIndex = lines.findIndex((line, index) => !excluded.has(index)
    && /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{3,}$/.test(line)
    && line.trim().split(/\s+/).length >= 2
    && !/matrimonio|evento|boda|fecha/i.test(line))
  const nameParts = nameIndex >= 0 ? lines[nameIndex].trim().split(/\s+/) : []
  const firstName = nameParts.slice(0, -1).join(' ')
  const lastName = nameParts.at(-1) ?? ''
  if (nameIndex >= 0) excluded.add(nameIndex)

  const dateLines = lines.map((line, index) => ({ line, index, parsed: parseDateAndTime(line, today) }))
    .filter((item) => item.parsed.date)
  const appointmentLine = [...dateLines].reverse().find((item) => item.parsed.time)
  const eventLine = dateLines.find((item) => item.index !== appointmentLine?.index
    && /matrimonio|evento|boda|graduacion|graduación|cumple/i.test(item.line))
    ?? dateLines.find((item) => item.index !== appointmentLine?.index)

  const appointmentDate = appointmentLine?.parsed.date ?? ''
  const startTime = appointmentLine?.parsed.time ?? ''
  const eventDate = eventLine?.parsed.date ?? null
  const notes = eventLine?.line ?? null

  if (!appointmentType) errors.push('tipo de cita (Venta, Prueba 1, Prueba 2 o Entrega)')
  if (!firstName || !lastName) errors.push('nombre y apellido')
  if (!email) errors.push('correo válido')
  if (phoneDigits.length < 8) errors.push('celular válido')
  if (!clientType) errors.push(`tipo de cliente (${CLIENT_TYPES.join(', ')})`)
  if (!appointmentDate) errors.push('fecha de la cita')
  if (!startTime) errors.push('hora de la cita')
  if (appointmentDate && appointmentDate < today) errors.push('una fecha de cita futura')
  if (eventDate && appointmentDate && appointmentDate > eventDate) errors.push('una fecha de cita anterior al evento')

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    draft: {
      appointmentType, firstName, lastName, email, phone, instagram, clientType,
      appointmentDate, startTime, eventDate, notes,
    },
  }
}

export function appointmentConfirmationText(draft: AppointmentDraft, durationMinutes: number) {
  return [
    'CONFIRMAR NUEVA CITA',
    `Tipo: ${draft.appointmentType}`,
    `Cliente: ${draft.firstName} ${draft.lastName}`,
    `Correo: ${draft.email}`,
    `Celular: ${draft.phone}`,
    `Instagram: ${draft.instagram ?? 'Sin Instagram'}`,
    `Tipo cliente: ${draft.clientType}`,
    `Fecha: ${draft.appointmentDate}`,
    `Hora: ${draft.startTime}`,
    `Duración: ${durationMinutes} minutos`,
    `Evento: ${draft.eventDate ?? 'No informado'}`,
    `Notas: ${draft.notes ?? 'Sin notas'}`,
    '',
    'Revisa los datos antes de confirmar.',
  ].join('\n')
}

export function parseAppointmentConfirmationText(text: string): AppointmentDraft | null {
  if (!text.startsWith('CONFIRMAR NUEVA CITA\n')) return null
  const fields = new Map(text.split('\n').slice(1).map((line) => {
    const separator = line.indexOf(':')
    return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1).trim()] : ['', '']
  }))
  const fullName = fields.get('Cliente')?.split(/\s+/) ?? []
  const appointmentType = fields.get('Tipo') ?? ''
  const appointmentDate = fields.get('Fecha') ?? ''
  const startTime = fields.get('Hora') ?? ''
  if (!appointmentType || fullName.length < 2 || !appointmentDate || !startTime) return null
  return {
    appointmentType,
    firstName: fullName.slice(0, -1).join(' '),
    lastName: fullName.at(-1) ?? '',
    email: fields.get('Correo') ?? '',
    phone: fields.get('Celular') ?? '',
    instagram: fields.get('Instagram') === 'Sin Instagram' ? null : fields.get('Instagram') ?? null,
    clientType: fields.get('Tipo cliente') ?? '',
    appointmentDate,
    startTime,
    eventDate: fields.get('Evento') === 'No informado' ? null : fields.get('Evento') ?? null,
    notes: fields.get('Notas') === 'Sin notas' ? null : fields.get('Notas') ?? null,
  }
}

function findAppointmentType(lines: string[]) {
  for (const line of lines) {
    if (/\bprueba\s*1\b/.test(line)) return 'Prueba 1'
    if (/\bprueba\s*2\b/.test(line)) return 'Prueba 2'
    if (/^venta$|\bcita de venta\b/.test(line)) return 'Venta'
    if (/^entrega$|\bcita de entrega\b/.test(line)) return 'Entrega'
  }
  return ''
}

function normalizePhone(digits: string) {
  if (!digits) return ''
  if (digits.length === 9) return `+56${digits}`
  if (digits.length === 11 && digits.startsWith('56')) return `+${digits}`
  return digits.startsWith('+') ? digits : `+${digits}`
}

function parseDateAndTime(value: string, today: string) {
  const normalized = normalizeText(value)
  const named = normalized.match(/\b(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?\b/)
  const numeric = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/)
  let day = 0
  let month = 0
  let year = 0
  if (named && MONTHS[named[2]]) {
    day = Number(named[1]); month = MONTHS[named[2]]; year = Number(named[3] || 0)
  } else if (numeric) {
    day = Number(numeric[1]); month = Number(numeric[2]); year = Number(numeric[3] || 0)
  }
  if (!year && day && month) {
    year = Number(today.slice(0, 4))
    const candidate = isoDate(year, month, day)
    if (candidate && candidate < today) year += 1
  }
  if (year > 0 && year < 100) year += 2000
  const date = day && month && year ? isoDate(year, month, day) : null
  const timeMatch = normalized.match(/(?:^|\s|,)([01]?\d|2[0-3])[.:]([0-5]\d)(?:\s*(?:hrs?|horas?))?\b/)
  const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : null
  return { date, time }
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
