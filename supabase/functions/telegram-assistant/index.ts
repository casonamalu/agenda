import { createClient } from 'npm:@supabase/supabase-js@2.110.8'
import { clientSearchTokens, matchesClientName, type AgendaIntent, parseTelegramIntent } from './intent.ts'

type TelegramUser = {
  id: number
  first_name?: string
  username?: string
}

type TelegramChat = {
  id: number
  type: string
}

type TelegramMessage = {
  message_id: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
}

type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
}

type AppointmentRow = {
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  is_overbook: boolean
  client: unknown
  participants: unknown
  appointment_type: unknown
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TIME_ZONE = 'America/Santiago'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
      return json({ error: 'Configuración incompleta' }, 500)
    }

    const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
    if (!secureEqual(receivedSecret, TELEGRAM_WEBHOOK_SECRET)) {
      return json({ error: 'No autorizado' }, 401)
    }

    const update = await request.json() as TelegramUpdate
    if (update.message?.text) await handleMessage(update.message)
    return json({ ok: true })
  } catch (error) {
    console.error('telegram-assistant', error)
    // Telegram retries non-2xx responses. Once the request is authenticated,
    // acknowledge processing errors to avoid duplicate replies.
    return json({ ok: true })
  }
})

async function handleMessage(message: TelegramMessage) {
  if (message.chat.type !== 'private') {
    await sendMessage(message.chat.id, 'Por seguridad, usa este asistente en un chat privado.')
    return
  }

  const chatId = String(message.chat.id)
  const text = (message.text ?? '').trim()

  if (!isAuthorized(chatId)) {
    await sendMessage(
      message.chat.id,
      [
        `Hola${message.from?.first_name ? `, ${message.from.first_name}` : ''}.`,
        '',
        'El asistente está conectado, pero este chat aún no está autorizado.',
        `Tu identificador es: ${chatId}`,
        '',
        'Agrega este número al secreto TELEGRAM_ALLOWED_CHAT_IDS en Supabase. Si autorizas más de un chat, sepáralos con coma.',
      ].join('\n'),
    )
    return
  }

  const intent = parseTelegramIntent(text, localDate(0))
  if (intent.kind === 'help') {
    await sendMessage(message.chat.id, helpText(), mainKeyboard())
  } else if (intent.kind === 'agenda') {
    await sendAgenda(message.chat.id, intent)
  } else if (intent.kind === 'search') {
    await searchClients(message.chat.id, intent.term, intent.nextAppointment)
  } else if (intent.kind === 'search_guide') {
    await sendMessage(message.chat.id, 'Escribe el nombre, correo o teléfono. Por ejemplo:\n“Buscar a Daniela Pérez”\n“¿Cuándo viene Daniela?”\n“/buscar daniela@gmail.com”')
  } else if (intent.kind === 'date_guide') {
    await sendMessage(message.chat.id, 'Escribe la fecha como prefieras. Por ejemplo:\n“Citas del próximo viernes”\n“Agenda del 24 de septiembre”\n“Entregas de octubre”')
  } else {
    await sendMessage(
      message.chat.id,
      'No alcancé a entenderlo. Puedes escribir “citas de hoy”, “próxima cita de Daniela” o usar uno de los botones.',
      mainKeyboard(),
    )
  }
}

function isAuthorized(chatId: string) {
  const allowed = (Deno.env.get('TELEGRAM_ALLOWED_CHAT_IDS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return allowed.includes(chatId)
}

async function sendAgenda(chatId: number, intent: AgendaIntent) {
  const { data, error } = await supabase
    .from('appointments')
    .select('appointment_date,start_time,end_time,status,is_overbook,client:clients(first_name,last_name,email,phone),participants:appointment_participants(client_id,client:clients(first_name,last_name,email,phone)),appointment_type:appointment_types(name,category)')
    .gte('appointment_date', intent.startDate)
    .lte('appointment_date', intent.endDate)
    .neq('status', 'cancelled')
    .order('appointment_date')
    .order('start_time')

  if (error) {
    console.error('Error consultando agenda', error)
    await sendMessage(chatId, 'No pude consultar la agenda. Intenta nuevamente en unos minutos.')
    return
  }

  const appointments = ((data ?? []) as unknown as AppointmentRow[]).filter((appointment) => {
    const type = one(appointment.appointment_type) as Record<string, unknown> | null
    if (intent.category && type?.category !== intent.category) return false
    const start = shortTime(appointment.start_time)
    if (intent.timeFrom && start < intent.timeFrom) return false
    if (intent.timeTo && start >= intent.timeTo) return false
    return true
  })
  if (!appointments.length) {
    await sendMessage(chatId, `No hay citas que coincidan con ${intent.label}.`, mainKeyboard())
    return
  }

  const lines = appointments.map((appointment, index) => {
    const type = one(appointment.appointment_type) as Record<string, unknown> | null
    const primary = one(appointment.client) as Record<string, unknown> | null
    const participants = many(appointment.participants)
      .map((participant) => one((participant as Record<string, unknown>).client) as Record<string, unknown> | null)
      .filter(Boolean)
    const names = [primary, ...participants]
      .filter(Boolean)
      .map((client) => `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim())
      .join(' + ')
    const overbook = appointment.is_overbook ? ' · sobrecupo' : ''
    const date = intent.startDate === intent.endDate ? '' : `${shortDate(appointment.appointment_date)} · `
    return `${index + 1}. ${date}${shortTime(appointment.start_time)}–${shortTime(appointment.end_time)} · ${type?.name ?? 'Cita'}\n${names || 'Cliente sin nombre'}${overbook}`
  })

  const heading = intent.startDate === intent.endDate
    ? `Agenda ${intent.label} (${formatDate(intent.startDate)})`
    : `Agenda de ${intent.label}`
  await sendLongMessage(chatId, `${heading}\n\n${lines.join('\n\n')}`)
}

async function searchClients(chatId: number, rawTerm: string, nextAppointment: boolean) {
  const term = rawTerm.trim().replace(/[,%()]/g, '')
  if (term.length < 2) {
    await sendMessage(chatId, 'Escribe al menos 2 caracteres para buscar.')
    return
  }

  const tokens = clientSearchTokens(term)
  const isEmail = term.includes('@')
  const isPhone = /^[+\d\s()-]+$/.test(term)
  const filters = isEmail
    ? `email.ilike.%${term}%`
    : isPhone
      ? `phone.ilike.%${term.replace(/[^+\d]/g, '')}%`
      : tokens.flatMap((token) => [
        `first_name.ilike.%${token}%`,
        `last_name.ilike.%${token}%`,
      ]).join(',')

  const { data: candidates, error } = await supabase
    .from('clients')
    .select('id,first_name,last_name,email,phone')
    .or(filters)
    .order('last_name')
    .limit(isEmail || isPhone ? 10 : 100)

  if (error) {
    console.error('Error buscando clientes', error)
    await sendMessage(chatId, 'No pude realizar la búsqueda. Intenta nuevamente.')
    return
  }

  const data = (candidates ?? [])
    .filter((client) => isEmail || isPhone || matchesClientName(client.first_name, client.last_name, term))
    .slice(0, 10)

  if (!data.length) {
    await sendMessage(chatId, `No encontré clientes para “${term}”.`)
    return
  }

  const nextByClient = nextAppointment ? await loadNextAppointments(data.map((client) => client.id)) : new Map()
  const lines = data.map((client, index) => {
    const next = nextByClient.get(client.id)
    const appointmentLine = next
      ? `\nPróxima cita: ${formatDate(next.appointment_date)} a las ${shortTime(next.start_time)} · ${next.type}`
      : nextAppointment ? '\nSin próximas citas agendadas' : ''
    return `${index + 1}. ${client.first_name} ${client.last_name}\n${client.email} · ${client.phone}${appointmentLine}`
  })
  await sendLongMessage(chatId, `Resultados para “${term}”\n\n${lines.join('\n\n')}`)
}

async function loadNextAppointments(clientIds: string[]) {
  const nextByClient = new Map<string, { appointment_date: string; start_time: string; type: string }>()
  if (!clientIds.length) return nextByClient

  const [{ data: primary }, { data: participantLinks }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id,client_id,appointment_date,start_time,appointment_type:appointment_types(name)')
      .in('client_id', clientIds)
      .gte('appointment_date', localDate(0))
      .neq('status', 'cancelled')
      .order('appointment_date')
      .order('start_time'),
    supabase.from('appointment_participants').select('appointment_id,client_id').in('client_id', clientIds),
  ])

  const participantAppointmentIds = [...new Set((participantLinks ?? []).map((link) => link.appointment_id))]
  const { data: shared } = participantAppointmentIds.length
    ? await supabase
      .from('appointments')
      .select('id,client_id,appointment_date,start_time,appointment_type:appointment_types(name)')
      .in('id', participantAppointmentIds)
      .gte('appointment_date', localDate(0))
      .neq('status', 'cancelled')
      .order('appointment_date')
      .order('start_time')
    : { data: [] }

  for (const appointment of primary ?? []) {
    if (!nextByClient.has(appointment.client_id)) nextByClient.set(appointment.client_id, appointmentSummary(appointment))
  }
  const sharedById = new Map((shared ?? []).map((appointment) => [appointment.id, appointment]))
  for (const link of participantLinks ?? []) {
    if (nextByClient.has(link.client_id)) continue
    const appointment = sharedById.get(link.appointment_id)
    if (appointment) nextByClient.set(link.client_id, appointmentSummary(appointment))
  }
  return nextByClient
}

function appointmentSummary(appointment: Record<string, any>) {
  const type = one(appointment.appointment_type) as Record<string, unknown> | null
  return {
    appointment_date: appointment.appointment_date as string,
    start_time: appointment.start_time as string,
    type: String(type?.name ?? 'Cita'),
  }
}

function helpText() {
  return [
    'Asistente Agenda Casona Malú',
    '',
    'Consultas disponibles:',
    '• “¿Cuáles son las citas de hoy después de las 3?”',
    '• “Entregas del próximo viernes”',
    '• “Pruebas de esta semana”',
    '• “¿Cuándo viene Daniela?”',
    '• “Busca a María González”',
    '• “Agenda del 25 de septiembre”',
    '',
    'Las consultas son inmediatas. Las acciones que cambien datos siempre pedirán confirmación.',
  ].join('\n')
}

function localDate(offsetDays: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() + offsetDays * 86_400_000))
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00Z`))
}

function shortTime(value: string) {
  return String(value).slice(0, 5)
}

function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] ?? null : value
}

function many(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

async function sendLongMessage(chatId: number, text: string) {
  const chunks = chunkText(text, 3900)
  for (const chunk of chunks) await sendMessage(chatId, chunk)
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('es-CL', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' })
    .format(new Date(`${value}T12:00:00Z`))
}

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: '📅 Agenda de hoy' }, { text: '➡️ Agenda de mañana' }],
      [{ text: '🗓 Próximos 7 días' }, { text: '🔎 Buscar clienta' }],
      [{ text: '👗 Ventas de esta semana' }, { text: '📦 Entregas de esta semana' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  }
}

async function sendMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>) {
  const response = await telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })
  if (!response.ok) throw new Error(`Telegram rechazó el mensaje: ${response.description ?? 'sin detalle'}`)
}

async function telegramRequest(method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await response.json()
}

function chunkText(value: string, maxLength: number) {
  const chunks: string[] = []
  let remaining = value
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf('\n', maxLength)
    if (cut < maxLength / 2) cut = maxLength
    chunks.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut).replace(/^\n+/, '')
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  let mismatch = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return mismatch === 0
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
