export interface FollowUpReportClient {
  first_name: string
  last_name: string
  phone: string
}

export interface FollowUpReportAppointment {
  appointment_date: string
  event_date: string | null
  client: FollowUpReportClient | FollowUpReportClient[] | null
  participants: Array<{
    client: FollowUpReportClient | FollowUpReportClient[] | null
  }>
  appointment_type: { name: string } | Array<{ name: string }> | null
}

export interface FollowUpReportRow {
  clientName: string
  phone: string
  appointmentType: string
  appointmentDate: string
  internalDeliveryDate: string
  eventDate: string
  observation: string
}

export const FOLLOW_UP_APPOINTMENT_TYPES = ['Prueba 1', 'Prueba 2', 'Entrega'] as const

export function buildFollowUpReportRows(
  appointments: FollowUpReportAppointment[],
): FollowUpReportRow[] {
  return appointments.flatMap((appointment) => {
    const appointmentType = firstValue(appointment.appointment_type)?.name ?? ''
    const clients = [
      firstValue(appointment.client),
      ...(appointment.participants ?? []).map((participant) => firstValue(participant.client)),
    ].filter((client): client is FollowUpReportClient => Boolean(client))

    return clients.map((client) => ({
      clientName: `${client.first_name} ${client.last_name}`.trim(),
      phone: client.phone,
      appointmentType: appointmentType === 'Entrega' ? 'Entrega cliente' : appointmentType,
      appointmentDate: appointment.appointment_date,
      internalDeliveryDate: addIsoDays(appointment.appointment_date, -2),
      eventDate: appointment.event_date ?? '',
      observation: '',
    }))
  }).sort((left, right) => (
    left.clientName.localeCompare(right.clientName, 'es-CL')
    || left.appointmentDate.localeCompare(right.appointmentDate)
    || reportTypeOrder(left.appointmentType) - reportTypeOrder(right.appointmentType)
  ))
}

export function formatShortReportDate(value: string) {
  if (!value) return ''
  const [year, month, day] = value.split('-')
  return `${day}-${month}-${year}`
}

function addIsoDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function firstValue<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function reportTypeOrder(value: string) {
  if (value === 'Prueba 1') return 1
  if (value === 'Prueba 2') return 2
  if (value === 'Entrega cliente') return 3
  return 4
}
