export type AgendaIntent = {
  kind: 'agenda'
  startDate: string
  endDate: string
  label: string
  category?: 'sale' | 'trial' | 'delivery'
  timeFrom?: string
  timeTo?: string
}

export type SearchIntent = {
  kind: 'search'
  term: string
  nextAppointment: boolean
}

export type TelegramIntent =
  | AgendaIntent
  | SearchIntent
  | { kind: 'help' }
  | { kind: 'search_guide' }
  | { kind: 'date_guide' }
  | { kind: 'unknown' }

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
}

export function parseTelegramIntent(rawText: string, today: string): TelegramIntent {
  const text = normalizeText(rawText)
  if (['/start', '/ayuda', 'ayuda', 'menu', 'menú'].includes(text)) return { kind: 'help' }

  if (/buscar (?:una )?clienta\s*$/.test(text) || text.includes('buscar por nombre')) {
    return { kind: 'search_guide' }
  }
  if (text.includes('elegir fecha') || text === '/fecha' || text === 'buscar por fecha') {
    return { kind: 'date_guide' }
  }

  const period = extractPeriod(text, today)
  if (period) {
    const category = extractCategory(text)
    const time = extractTimeRange(text)
    return {
      kind: 'agenda',
      startDate: period.startDate,
      endDate: period.endDate,
      label: period.label,
      ...(category ? { category } : {}),
      ...time,
    }
  }

  const term = extractClientTerm(rawText)
  if (term) {
    return {
      kind: 'search',
      term,
      nextAppointment: /cuando|cuándo|proxima cita|próxima cita|cuando viene|cuándo viene/i.test(rawText),
    }
  }

  return { kind: 'unknown' }
}

export function normalizeText(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function extractPeriod(text: string, today: string) {
  if (/\b(pasado manana|pasado mañana)\b/.test(text)) {
    const date = addDays(today, 2)
    return singleDay(date, 'pasado mañana')
  }
  if (/\b(hoy)\b/.test(text) || text === '/hoy') return singleDay(today, 'hoy')
  if (/\b(manana)\b/.test(text) || text === '/manana') {
    const date = addDays(today, 1)
    return singleDay(date, 'mañana')
  }
  if (/\besta semana\b/.test(text)) {
    const endDate = addDays(today, (7 - weekday(today)) % 7)
    return { startDate: today, endDate, label: 'esta semana' }
  }
  if (/\b(proxima semana|próxima semana)\b/.test(text)) {
    const daysUntilMonday = ((8 - weekday(today)) % 7) || 7
    const startDate = addDays(today, daysUntilMonday)
    return { startDate, endDate: addDays(startDate, 6), label: 'la próxima semana' }
  }
  if (/\b(proximos? 7 dias|próximos? 7 días|siguientes 7 dias)\b/.test(text)) {
    return { startDate: today, endDate: addDays(today, 6), label: 'los próximos 7 días' }
  }
  if (/\b(proximos? 14 dias|próximos? 14 días|siguientes 14 dias)\b/.test(text)) {
    return { startDate: today, endDate: addDays(today, 13), label: 'los próximos 14 días' }
  }

  const explicit = extractExplicitDate(text, today)
  if (explicit) return singleDay(explicit, explicit)

  const monthPeriod = extractMonthPeriod(text, today)
  if (monthPeriod) return monthPeriod

  for (const [name, targetWeekday] of Object.entries(WEEKDAYS)) {
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue
    let delta = (targetWeekday - weekday(today) + 7) % 7
    if (text.includes(`proximo ${name}`) && delta === 0) delta = 7
    const date = addDays(today, delta)
    return singleDay(date, name)
  }

  if (/\b(proximas|próximas|proximos|próximos)\b/.test(text) && extractCategory(text)) {
    return { startDate: today, endDate: addDays(today, 13), label: 'los próximos 14 días' }
  }
  return null
}

function extractExplicitDate(text: string, today: string) {
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (isoMatch) return validIso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))

  const numericMatch = text.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/)
  if (numericMatch) {
    const year = resolveYear(Number(numericMatch[3] ?? today.slice(0, 4)))
    return validIso(year, Number(numericMatch[2]), Number(numericMatch[1]))
  }

  const namedMatch = text.match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?\b/)
  if (!namedMatch || !MONTHS[namedMatch[2]]) return null
  const year = Number(namedMatch[3] ?? today.slice(0, 4))
  return validIso(year, MONTHS[namedMatch[2]], Number(namedMatch[1]))
}

function extractMonthPeriod(text: string, today: string) {
  for (const [name, month] of Object.entries(MONTHS)) {
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue
    const yearMatch = text.match(new RegExp(`${name}\\s+(?:de\\s+)?(\\d{4})`))
    let year = Number(yearMatch?.[1] ?? today.slice(0, 4))
    if (!yearMatch && month < Number(today.slice(5, 7))) year += 1
    const startDate = isoDate(year, month, 1)
    const endDate = isoDate(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate())
    return { startDate, endDate, label: `${name} de ${year}` }
  }
  return null
}

function extractCategory(text: string): AgendaIntent['category'] | undefined {
  if (/\b(entrega|entregas)\b/.test(text)) return 'delivery'
  if (/\b(prueba|pruebas)\b/.test(text)) return 'trial'
  if (/\b(venta|ventas)\b/.test(text)) return 'sale'
  return undefined
}

function extractTimeRange(text: string) {
  if (/\b(en|por) la tarde\b/.test(text)) return { timeFrom: '12:00' }
  if (/\b(en|por) la manana\b/.test(text)) return { timeTo: '12:00' }

  const after = text.match(/\b(?:despues|desde) de las?\s+(\d{1,2})(?::(\d{2}))?\b/)
  if (after) return { timeFrom: clock(after[1], after[2]) }
  const before = text.match(/\bantes de las?\s+(\d{1,2})(?::(\d{2}))?\b/)
  if (before) return { timeTo: clock(before[1], before[2]) }
  return {}
}

function extractClientTerm(rawText: string) {
  const value = rawText.trim().replace(/^[¿?¡!\s]+/, '')
  const patterns = [
    /^\/(?:buscar|cliente)\s+(.+)$/i,
    /^(?:buscar|busca)\s+(?:a\s+)?(.+)$/i,
    /^(?:cuando|cuándo)\s+viene\s+(.+)$/i,
    /^(?:cual|cuál)\s+es\s+la\s+(?:proxima|próxima)\s+cita\s+de\s+(.+)$/i,
    /^(?:proxima|próxima)\s+cita\s+de\s+(.+)$/i,
    /^citas?\s+de\s+(.+)$/i,
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match?.[1]) return match[1].trim().replace(/[?¿!.]+$/g, '')
  }
  return null
}

function clock(hourValue: string, minuteValue?: string) {
  const enteredHour = Number(hourValue)
  const hour = Math.min(23, Math.max(0, enteredHour <= 7 ? enteredHour + 12 : enteredHour))
  const minute = Math.min(59, Math.max(0, Number(minuteValue ?? 0)))
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function singleDay(date: string, label: string) {
  return { startDate: date, endDate: date, label }
}

function weekday(iso: string) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay()
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function resolveYear(value: number) {
  return value < 100 ? 2000 + value : value
}

function validIso(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return isoDate(year, month, day)
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
