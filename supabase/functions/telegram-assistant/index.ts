import { createClient } from 'npm:@supabase/supabase-js@2.110.8'

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
  const normalized = normalize(text)

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

  if (normalized === '/start' || normalized === '/ayuda' || normalized === 'ayuda') {
    await sendMessage(message.chat.id, helpText())
    return
  }

  if (isTodayIntent(normalized)) {
    await sendAgenda(message.chat.id, localDate(0), 'hoy')
    return
  }

  if (isTomorrowIntent(normalized)) {
    await sendAgenda(message.chat.id, localDate(1), 'mañana')
    return
  }

  const requestedDate = extractDate(text)
  if (requestedDate) {
    await sendAgenda(message.chat.id, requestedDate, requestedDate)
    return
  }

  const searchTerm = extractSearchTerm(text)
  if (searchTerm) {
    await searchClients(message.chat.id, searchTerm)
    return
  }

  await sendMessage(
    message.chat.id,
    'No entendí la solicitud. Escribe /ayuda para ver ejemplos disponibles.',
  )
}

function isAuthorized(chatId: string) {
  const allowed = (Deno.env.get('TELEGRAM_ALLOWED_CHAT_IDS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return allowed.includes(chatId)
}

async function sendAgenda(chatId: number, date: string, label: string) {
  const { data, error } = await supabase
    .from('appointments')
    .select('appointment_date,start_time,end_time,status,is_overbook,client:clients(first_name,last_name,email,phone),participants:appointment_participants(client:clients(first_name,last_name,email,phone)),appointment_type:appointment_types(name)')
    .eq('appointment_date', date)
    .neq('status', 'cancelled')
    .order('start_time')

  if (error) {
    console.error('Error consultando agenda', error)
    await sendMessage(chatId, 'No pude consultar la agenda. Intenta nuevamente en unos minutos.')
    return
  }

  const appointments = (data ?? []) as unknown as AppointmentRow[]
  if (!appointments.length) {
    await sendMessage(chatId, `No hay citas agendadas para ${label}.`)
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
    return `${index + 1}. ${shortTime(appointment.start_time)}–${shortTime(appointment.end_time)} · ${type?.name ?? 'Cita'}\n${names || 'Cliente sin nombre'}${overbook}`
  })

  await sendLongMessage(chatId, `Agenda ${label} (${formatDate(date)})\n\n${lines.join('\n\n')}`)
}

async function searchClients(chatId: number, rawTerm: string) {
  const term = rawTerm.trim().replace(/[,%()]/g, '')
  if (term.length < 2) {
    await sendMessage(chatId, 'Escribe al menos 2 caracteres para buscar.')
    return
  }

  const { data, error } = await supabase
    .from('clients')
    .select('id,first_name,last_name,email,phone')
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`)
    .order('last_name')
    .limit(10)

  if (error) {
    console.error('Error buscando clientes', error)
    await sendMessage(chatId, 'No pude realizar la búsqueda. Intenta nuevamente.')
    return
  }

  if (!data?.length) {
    await sendMessage(chatId, `No encontré clientes para “${term}”.`)
    return
  }

  const lines = data.map((client, index) =>
    `${index + 1}. ${client.first_name} ${client.last_name}\n${client.email} · ${client.phone}`
  )
  await sendLongMessage(chatId, `Resultados para “${term}”\n\n${lines.join('\n\n')}`)
}

function helpText() {
  return [
    'Asistente Agenda Casona Malú',
    '',
    'Consultas disponibles:',
    '• “¿Cuáles son las citas de hoy?”',
    '• “Agenda de mañana”',
    '• /fecha 25-09-2026',
    '• /buscar nombre, correo o teléfono',
    '',
    'Las acciones que cambian datos se habilitarán con confirmación explícita después de validar este chat.',
  ].join('\n')
}

function isTodayIntent(value: string) {
  return value === '/hoy' || value.includes('citas de hoy') || value.includes('agenda de hoy') ||
    value.includes('citas para hoy') || value.includes('agenda para hoy')
}

function isTomorrowIntent(value: string) {
  return value === '/manana' || value.includes('citas de manana') || value.includes('agenda de manana') ||
    value.includes('citas para manana') || value.includes('agenda para manana')
}

function extractSearchTerm(value: string) {
  const match = value.match(/^\/(?:buscar|cliente)\s+(.+)$/i) ?? value.match(/^buscar\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function extractDate(value: string) {
  const match = value.match(/(?:\/fecha\s+)?(\d{4})-(\d{2})-(\d{2})/) ??
    value.match(/(?:\/fecha\s+)?(\d{1,2})[-/]([0-1]?\d)[-/](\d{4})/)
  if (!match) return null

  const iso = match[1].length === 4
    ? `${match[1]}-${match[2]}-${match[3]}`
    : `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  const date = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : iso
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

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
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

async function sendMessage(chatId: number, text: string) {
  const response = await telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
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
