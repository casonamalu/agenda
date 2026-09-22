import { createClient } from 'npm:@supabase/supabase-js@2.110.8'
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'
import { appointmentConfirmationText, looksLikeAppointmentRequest, parseAppointmentConfirmationText, parseAppointmentDraft } from './actions.ts'
import { clientSearchTokens, matchesClientName, type AgendaIntent, parseTelegramIntent } from './intent.ts'

type TelegramUser = { id: number; first_name?: string; username?: string }
type TelegramChat = { id: number; type: string }
type TelegramMessage = { message_id: number; chat: TelegramChat; from?: TelegramUser; text?: string }
type TelegramCallbackQuery = { id: string; from: TelegramUser; message?: TelegramMessage; data?: string }
type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }
type AccessRole = 'full' | 'workshop' | 'denied'
type AppointmentRow = { id: string; appointment_date: string; start_time: string; end_time: string; status: string; is_overbook: boolean; client: unknown; participants: unknown; appointment_type: unknown }

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TIME_ZONE = 'America/Santiago'
const ACTOR_BY_CHAT_HASH: Record<string, string> = {
  '7abf98caeb19ff9e6d30c4fc224df67cbb284fd8f493a8238dfb8bd796d8ce33': '0fe5c1af-617f-45d7-b735-881ab9496099',
  '913d21e8b8b7e04843afde64e98d4f48442c5ea2f1081327ae7fc02a6fd6deaa': 'b3fa34a7-23fb-48c4-a888-3d2e10544b04',
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) return json({ error: 'Configuración incompleta' }, 500)
    if (!secureEqual(request.headers.get('x-telegram-bot-api-secret-token') ?? '', TELEGRAM_WEBHOOK_SECRET)) return json({ error: 'No autorizado' }, 401)
    const update = await request.json() as TelegramUpdate
    if (update.callback_query) await handleCallback(update.callback_query)
    else if (update.message?.text) await handleMessage(update.message)
    return json({ ok: true })
  } catch (error) {
    console.error('telegram-assistant', error)
    return json({ ok: true })
  }
})

async function handleMessage(message: TelegramMessage) {
  if (message.chat.type !== 'private') return sendMessage(message.chat.id, 'Por seguridad, usa este asistente en un chat privado.')
  const chatId = String(message.chat.id)
  const text = (message.text ?? '').trim()
  const role = accessRole(chatId)
  if (role === 'denied') {
    return sendMessage(message.chat.id, [`Hola${message.from?.first_name ? `, ${message.from.first_name}` : ''}.`, '', 'Este chat no está autorizado para usar el asistente.', `Tu identificador es: ${chatId}`, '', 'Solicita a la administradora que autorice este identificador.'].join('\n'))
  }
  if (looksLikeAppointmentRequest(text)) {
    if (role !== 'full') return sendMessage(message.chat.id, 'Tu perfil es de consulta. No tiene permiso para registrar citas.')
    return prepareAppointment(message.chat.id, chatId, text)
  }
  if (/\b(reenviar|reenvia|reenvía)\b.*\b(correo|confirmacion|confirmación|recordatorio)\b/i.test(text)) {
    if (role !== 'full') return sendMessage(message.chat.id, 'Tu perfil es de consulta. No tiene permiso para reenviar correos.')
    return prepareEmailResend(message.chat.id, text)
  }
  if (/\b(genera|generar|generame|genérame)\b.*\breporte\b|^reporte\b/i.test(text)) {
    if (role !== 'full') return sendMessage(message.chat.id, 'Tu perfil es de consulta. No tiene permiso para generar reportes.')
    return sendReport(message.chat.id, text)
  }

  const intent = parseTelegramIntent(text, localDate(0))
  if (intent.kind === 'help') await sendMessage(message.chat.id, helpText(role), mainKeyboard(role))
  else if (intent.kind === 'agenda' && role === 'workshop' && intent.category === 'sale') await sendMessage(message.chat.id, 'Tu perfil de taller permite consultar solamente citas de prueba y entrega.')
  else if (intent.kind === 'agenda') await sendAgenda(message.chat.id, intent, role)
  else if (intent.kind === 'search') await searchClients(message.chat.id, intent.term, intent.nextAppointment, role)
  else if (intent.kind === 'search_guide') await sendMessage(message.chat.id, 'Escribe el nombre, correo o teléfono. Por ejemplo:\n“Buscar a Daniela Pérez”\n“¿Cuándo viene Daniela?”\n“/buscar daniela@gmail.com”')
  else if (intent.kind === 'date_guide') await sendMessage(message.chat.id, 'Escribe la fecha como prefieras. Por ejemplo:\n“Citas del próximo viernes”\n“Agenda del 24 de septiembre”\n“Entregas de octubre”')
  else await sendMessage(message.chat.id, 'No alcancé a entenderlo. Escribe “ayuda” para ver ejemplos.', mainKeyboard(role))
}

async function handleCallback(callback: TelegramCallbackQuery) {
  const message = callback.message
  if (!message || message.chat.type !== 'private') return answerCallback(callback.id, 'Acción no disponible.')
  const chatId = String(message.chat.id)
  if (accessRole(chatId) !== 'full') return answerCallback(callback.id, 'No tienes permiso para esta acción.', true)
  const actorId = await actorForChat(chatId)
  if (!actorId) return answerCallback(callback.id, 'Tu usuario de Telegram no está vinculado al sistema.', true)
  if (callback.data === 'cancel_action') {
    await answerCallback(callback.id, 'Acción cancelada.')
    return editMessage(message.chat.id, message.message_id, `${message.text ?? 'Acción'}\n\nCANCELADA`)
  }
  if (callback.data === 'create_appointment') {
    const draft = parseAppointmentConfirmationText(message.text ?? '')
    if (!draft) return answerCallback(callback.id, 'Los datos de confirmación ya no son válidos.', true)
    const configuration = await appointmentConfiguration(draft.appointmentType, draft.clientType)
    if (!configuration) return answerCallback(callback.id, 'No encontré el tipo de cita o cliente.', true)
    await answerCallback(callback.id, 'Registrando cita…')
    const { error } = await supabase.rpc('telegram_execute_action_v1', {
      p_actor_id: actorId, p_action: 'create_appointment', p_request_key: callback.id,
      p_payload: {
        appointment_type_id: configuration.type.id, client_type_id: configuration.clientType.id,
        duration_minutes: configuration.type.duration_minutes, date: draft.appointmentDate,
        start_time: draft.startTime, first_name: draft.firstName, last_name: draft.lastName,
        email: draft.email, phone: draft.phone, instagram: draft.instagram, internal_notes: draft.notes,
      },
    })
    if (error) return sendMessage(message.chat.id, `No se creó la cita: ${friendlyError(error.message)}`)
    return editMessage(message.chat.id, message.message_id, `${message.text}\n\n✅ CITA REGISTRADA\nEl correo de confirmación quedó programado.`)
  }
  if (callback.data?.startsWith('resend:')) {
    await answerCallback(callback.id, 'Programando reenvío…')
    const { error } = await supabase.rpc('telegram_execute_action_v1', { p_actor_id: actorId, p_action: 'resend_email', p_request_key: callback.id, p_payload: { queue_id: callback.data.slice(7) } })
    if (error) return sendMessage(message.chat.id, `No se pudo reenviar: ${friendlyError(error.message)}`)
    return editMessage(message.chat.id, message.message_id, `${message.text}\n\n✅ REENVÍO PROGRAMADO`)
  }
  await answerCallback(callback.id, 'Acción desconocida.')
}

async function prepareAppointment(chatId: number, rawChatId: string, text: string) {
  const parsed = parseAppointmentDraft(text, localDate(0))
  if (!parsed.ok) return sendMessage(chatId, `Faltan datos o hay datos inconsistentes:\n• ${parsed.errors.join('\n• ')}\n\nCorrige y envía nuevamente el mensaje completo.`)
  const actorId = await actorForChat(rawChatId)
  if (!actorId) return sendMessage(chatId, 'Tu Telegram está autorizado para consultar, pero aún no está vinculado a un usuario administrador del sistema.')
  const configuration = await appointmentConfiguration(parsed.draft.appointmentType, parsed.draft.clientType)
  if (!configuration) return sendMessage(chatId, 'No encontré activo el tipo de cita o el tipo de cliente indicado.')
  const { data, error } = await supabase.rpc('telegram_execute_action_v1', {
    p_actor_id: actorId, p_action: 'availability', p_request_key: `availability:${crypto.randomUUID()}`,
    p_payload: { appointment_type_id: configuration.type.id, date: parsed.draft.appointmentDate, duration_minutes: configuration.type.duration_minutes },
  })
  if (error) return sendMessage(chatId, `No pude validar el horario: ${friendlyError(error.message)}`)
  const slots = Array.isArray(data?.slots) ? data.slots : []
  const chosen = slots.find((slot: Record<string, unknown>) => shortTime(String(slot.start_time)) === parsed.draft.startTime)
  if (!chosen?.available) {
    const alternatives = slots.filter((slot: Record<string, unknown>) => slot.available).slice(0, 4).map((slot: Record<string, unknown>) => shortTime(String(slot.start_time))).join(', ')
    return sendMessage(chatId, `El horario ${parsed.draft.startTime} no está disponible${chosen?.reason ? `: ${chosen.reason}` : '.'}${alternatives ? `\nHorarios disponibles: ${alternatives}` : '\nNo hay horarios disponibles ese día.'}`)
  }
  await sendMessage(chatId, appointmentConfirmationText(parsed.draft, configuration.type.duration_minutes), { inline_keyboard: [[{ text: '✅ Confirmar cita', callback_data: 'create_appointment' }, { text: '❌ Cancelar', callback_data: 'cancel_action' }]] })
}

async function appointmentConfiguration(appointmentType: string, clientType: string) {
  const [{ data: types }, { data: clientTypes }] = await Promise.all([
    supabase.from('appointment_types').select('id,name,category,duration_minutes').eq('active', true),
    supabase.from('client_types').select('id,name').eq('active', true),
  ])
  const type = (types ?? []).find((item) => normalize(item.name) === normalize(appointmentType))
  const selectedClientType = (clientTypes ?? []).find((item) => normalize(item.name) === normalize(clientType))
  return type && selectedClientType ? { type, clientType: selectedClientType } : null
}

async function prepareEmailResend(chatId: number, text: string) {
  const term = text.replace(/^.*?\b(?:de|a)\s+/i, '').replace(/[?.!]+$/, '').trim()
  if (term.length < 2 || normalize(term) === normalize(text)) return sendMessage(chatId, 'Indica la clienta. Ejemplo: “Reenviar correo de Ana María Pichara”.')
  const clients = await findClients(term, 5)
  if (clients.length !== 1) {
    const detail = clients.length ? `Encontré más de una coincidencia:\n${clients.map((c) => `• ${c.first_name} ${c.last_name}`).join('\n')}` : 'No encontré esa clienta.'
    return sendMessage(chatId, `${detail}\nEscribe el nombre completo o el correo.`)
  }
  const client = clients[0]
  const { data: appointments } = await supabase.from('appointments').select('id,appointment_date,start_time,appointment_type:appointment_types(name)').eq('client_id', client.id).gte('appointment_date', localDate(0)).neq('status', 'cancelled').order('appointment_date').order('start_time').limit(1)
  const appointment = appointments?.[0]
  if (!appointment) return sendMessage(chatId, 'La clienta no tiene una próxima cita que permita reenviar el correo.')
  const { data: emails } = await supabase.from('email_queue').select('id,kind,status,sent_at,created_at').eq('appointment_id', appointment.id).in('kind', ['appointment_created', 'reminder']).not('status', 'in', '(pending,processing)').order('created_at', { ascending: false }).limit(1)
  const email = emails?.[0]
  if (!email) return sendMessage(chatId, 'No encontré una confirmación o recordatorio enviado/fallido que se pueda reenviar.')
  const type = one(appointment.appointment_type) as Record<string, unknown> | null
  await sendMessage(chatId, ['CONFIRMAR REENVÍO DE CORREO', `Cliente: ${client.first_name} ${client.last_name}`, `Correo: ${client.email}`, `Cita: ${formatDate(appointment.appointment_date)} ${shortTime(appointment.start_time)} · ${type?.name ?? 'Cita'}`, `Mensaje: ${email.kind === 'reminder' ? 'Recordatorio' : 'Confirmación'}`, '', 'El correo se agregará nuevamente a la cola de envío.'].join('\n'), { inline_keyboard: [[{ text: '✅ Confirmar reenvío', callback_data: `resend:${email.id}` }, { text: '❌ Cancelar', callback_data: 'cancel_action' }]] })
}

async function sendReport(chatId: number, text: string) {
  const query = text.replace(/^.*?reporte(?:\s+de)?\s*/i, '').trim() || 'hoy'
  const parsed = parseTelegramIntent(query, localDate(0))
  const intent: AgendaIntent = parsed.kind === 'agenda' ? parsed : { kind: 'agenda', startDate: localDate(0), endDate: localDate(0), label: 'hoy' }
  const appointments = await loadAgenda(intent)
  const bytes = await createReportPdf(appointments, intent)
  await sendDocument(chatId, bytes, `reporte-agenda-${intent.startDate}-${intent.endDate}.pdf`, `Reporte de ${intent.label}: ${appointments.length} cita(s).`)
}

async function sendAgenda(chatId: number, intent: AgendaIntent, role: AccessRole) {
  let appointments = await loadAgenda(intent)
  if (role === 'workshop') appointments = appointments.filter((appointment) => {
    const type = one(appointment.appointment_type) as Record<string, unknown> | null
    return ['trial', 'delivery'].includes(String(type?.category))
  })
  if (!appointments.length) return sendMessage(chatId, `No hay citas que coincidan con ${intent.label}.`, mainKeyboard(role))
  const lines = appointments.map((appointment, index) => {
    const type = one(appointment.appointment_type) as Record<string, unknown> | null
    const primary = one(appointment.client) as Record<string, unknown> | null
    const participants = many(appointment.participants).map((p) => one((p as Record<string, unknown>).client) as Record<string, unknown> | null).filter(Boolean)
    const names = [primary, ...participants].filter(Boolean).map((c) => `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim()).join(' + ')
    const date = intent.startDate === intent.endDate ? '' : `${shortDate(appointment.appointment_date)} · `
    return `${index + 1}. ${date}${shortTime(appointment.start_time)}–${shortTime(appointment.end_time)} · ${type?.name ?? 'Cita'}\n${names || 'Cliente sin nombre'}${appointment.is_overbook ? ' · sobrecupo' : ''}`
  })
  const heading = intent.startDate === intent.endDate ? `Agenda ${intent.label} (${formatDate(intent.startDate)})` : `Agenda de ${intent.label}`
  await sendLongMessage(chatId, `${heading}\n\n${lines.join('\n\n')}`)
}

async function loadAgenda(intent: AgendaIntent): Promise<AppointmentRow[]> {
  const { data, error } = await supabase.from('appointments').select('id,appointment_date,start_time,end_time,status,is_overbook,client:clients(first_name,last_name,email,phone),participants:appointment_participants(client_id,client:clients(first_name,last_name,email,phone)),appointment_type:appointment_types(name,category)').gte('appointment_date', intent.startDate).lte('appointment_date', intent.endDate).neq('status', 'cancelled').order('appointment_date').order('start_time')
  if (error) throw error
  return ((data ?? []) as unknown as AppointmentRow[]).filter((appointment) => {
    const type = one(appointment.appointment_type) as Record<string, unknown> | null
    if (intent.category && type?.category !== intent.category) return false
    const start = shortTime(appointment.start_time)
    return !(intent.timeFrom && start < intent.timeFrom) && !(intent.timeTo && start >= intent.timeTo)
  })
}

async function searchClients(chatId: number, rawTerm: string, nextAppointment: boolean, role: AccessRole) {
  const data = await findClients(rawTerm, 10)
  if (!data.length) return sendMessage(chatId, `No encontré clientes para “${rawTerm}”.`)
  const nextByClient = nextAppointment ? await loadNextAppointments(data.map((client) => client.id), role) : new Map()
  const lines = data.map((client, index) => { const next = nextByClient.get(client.id); return `${index + 1}. ${client.first_name} ${client.last_name}\n${client.email} · ${client.phone}${next ? `\nPróxima cita: ${formatDate(next.appointment_date)} a las ${shortTime(next.start_time)} · ${next.type}` : nextAppointment ? '\nSin próximas citas permitidas para tu perfil' : ''}` })
  await sendLongMessage(chatId, `Resultados para “${rawTerm}”\n\n${lines.join('\n\n')}`)
}

async function findClients(rawTerm: string, limit: number) {
  const term = rawTerm.trim().replace(/[,%()]/g, '')
  const tokens = clientSearchTokens(term)
  const isEmail = term.includes('@')
  const isPhone = /^[+\d\s()-]+$/.test(term)
  const filters = isEmail ? `email.ilike.%${term}%` : isPhone ? `phone.ilike.%${term.replace(/[^+\d]/g, '')}%` : tokens.flatMap((token) => [`first_name.ilike.%${token}%`, `last_name.ilike.%${token}%`]).join(',')
  const { data, error } = await supabase.from('clients').select('id,first_name,last_name,email,phone').or(filters).order('last_name').limit(100)
  if (error) throw error
  return (data ?? []).filter((client) => isEmail || isPhone || matchesClientName(client.first_name, client.last_name, term)).slice(0, limit)
}

async function loadNextAppointments(clientIds: string[], role: AccessRole) {
  const result = new Map<string, { appointment_date: string; start_time: string; type: string }>()
  if (!clientIds.length) return result
  const { data } = await supabase.from('appointments').select('client_id,appointment_date,start_time,appointment_type:appointment_types(name,category)').in('client_id', clientIds).gte('appointment_date', localDate(0)).neq('status', 'cancelled').order('appointment_date').order('start_time')
  for (const appointment of data ?? []) {
    const type = one(appointment.appointment_type) as Record<string, unknown> | null
    if (role === 'workshop' && !['trial', 'delivery'].includes(String(type?.category))) continue
    if (!result.has(appointment.client_id)) result.set(appointment.client_id, { appointment_date: appointment.appointment_date, start_time: appointment.start_time, type: String(type?.name ?? 'Cita') })
  }
  return result
}

async function createReportPdf(appointments: AppointmentRow[], intent: AgendaIntent) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page = pdf.addPage([842, 595]); let y = 555
  const drawHeader = () => {
    page.drawText('Casona Malu - Reporte de agenda', { x: 35, y, size: 17, font: bold, color: rgb(0.45, 0.2, 0.3) }); y -= 22
    page.drawText(`${safePdf(intent.label)} | ${intent.startDate} a ${intent.endDate}`, { x: 35, y, size: 10, font: regular }); y -= 24
    const headers = [['Fecha', 35], ['Hora', 105], ['Tipo', 165], ['Cliente', 280], ['Telefono', 500], ['Estado', 650]] as const
    headers.forEach(([value, x]) => page.drawText(value, { x, y, size: 9, font: bold })); y -= 14
  }
  drawHeader()
  for (const appointment of appointments) {
    if (y < 35) { page = pdf.addPage([842, 595]); y = 555; drawHeader() }
    const client = one(appointment.client) as Record<string, unknown> | null
    const type = one(appointment.appointment_type) as Record<string, unknown> | null
    const values = [shortDate(appointment.appointment_date), shortTime(appointment.start_time), String(type?.name ?? 'Cita'), `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim(), String(client?.phone ?? ''), appointment.status]
    const positions = [35, 105, 165, 280, 500, 650]
    values.forEach((value, index) => page.drawText(safePdf(value).slice(0, index === 3 ? 34 : 20), { x: positions[index], y, size: 8.5, font: regular })); y -= 16
  }
  if (!appointments.length) page.drawText('No hay citas para el periodo seleccionado.', { x: 35, y, size: 11, font: regular })
  return await pdf.save()
}

function accessRole(chatId: string): AccessRole { if (envIds('TELEGRAM_ALLOWED_CHAT_IDS').includes(chatId)) return 'full'; if (envIds('TELEGRAM_WORKSHOP_CHAT_IDS').includes(chatId)) return 'workshop'; return 'denied' }
async function actorForChat(chatId: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chatId)); const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); return ACTOR_BY_CHAT_HASH[hash] ?? null }
function envIds(name: string) { return (Deno.env.get(name) ?? '').split(',').map((v) => v.trim()).filter(Boolean) }
function normalize(value: string) { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() }
function friendlyError(value: string) { return value.replace(/^.*?message[:=]\s*/i, '').replace(/\s+/g, ' ').slice(0, 500) }
function safePdf(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '') }
function helpText(role: AccessRole) { return ['Asistente Agenda Casona Malú', '', '• “Citas de hoy” / “Entregas del viernes”', '• “¿Cuándo viene Daniela?” / “Buscar a María”', ...(role === 'full' ? ['• Envía la ficha completa para registrar una cita', '• “Reenviar correo de Daniela Pérez”', '• “Generar reporte próximos 14 días”'] : ['• Acceso de taller: clientes, pruebas y entregas']), '', 'Toda acción que cambie datos solicita confirmación.'].join('\n') }
function mainKeyboard(role: AccessRole) { return { keyboard: [[{ text: '📅 Agenda de hoy' }, { text: '➡️ Agenda de mañana' }], [{ text: '🗓 Próximos 7 días' }, { text: '🔎 Buscar clienta' }], role === 'workshop' ? [{ text: '👗 Pruebas de esta semana' }, { text: '📦 Entregas de esta semana' }] : [{ text: '👗 Ventas de esta semana' }, { text: '📦 Entregas de esta semana' }]], resize_keyboard: true, is_persistent: true } }
function localDate(offsetDays: number) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + offsetDays * 86_400_000)); const map = Object.fromEntries(parts.map((p) => [p.type, p.value])); return `${map.year}-${map.month}-${map.day}` }
function formatDate(value: string) { return new Intl.DateTimeFormat('es-CL', { timeZone: TIME_ZONE, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`)) }
function shortTime(value: string) { return String(value).slice(0, 5) }
function shortDate(value: string) { return new Intl.DateTimeFormat('es-CL', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' }).format(new Date(`${value}T12:00:00Z`)) }
function one(value: unknown): unknown { return Array.isArray(value) ? value[0] ?? null : value }
function many(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
async function sendLongMessage(chatId: number, text: string) { for (const chunk of chunkText(text, 3900)) await sendMessage(chatId, chunk) }
async function sendMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>) { const result = await telegramRequest('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }); if (!result.ok) throw new Error(result.description ?? 'Telegram rechazó el mensaje') }
async function editMessage(chatId: number, messageId: number, text: string) { await telegramRequest('editMessageText', { chat_id: chatId, message_id: messageId, text }) }
async function answerCallback(id: string, text: string, showAlert = false) { await telegramRequest('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert }) }
async function sendDocument(chatId: number, bytes: Uint8Array, filename: string, caption: string) { const form = new FormData(); form.append('chat_id', String(chatId)); form.append('caption', caption); form.append('document', new Blob([bytes], { type: 'application/pdf' }), filename); const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: form }); const result = await response.json(); if (!result.ok) throw new Error(result.description ?? 'Telegram rechazó el PDF') }
async function telegramRequest(method: string, body: Record<string, unknown>) { const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await response.json() }
function chunkText(value: string, max: number) { const chunks: string[] = []; let remaining = value; while (remaining.length > max) { let cut = remaining.lastIndexOf('\n', max); if (cut < max / 2) cut = max; chunks.push(remaining.slice(0, cut)); remaining = remaining.slice(cut).replace(/^\n+/, '') } if (remaining) chunks.push(remaining); return chunks }
function secureEqual(left: string, right: string) { const encoder = new TextEncoder(); const a = encoder.encode(left); const b = encoder.encode(right); let mismatch = a.length ^ b.length; const length = Math.max(a.length, b.length); for (let i = 0; i < length; i += 1) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0); return mismatch === 0 }
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }) }
