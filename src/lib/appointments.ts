import type { Appointment, AppointmentParticipant, Client } from '../types'

export const GROUP_SALE_DURATION_MINUTES = 90

export function appointmentClients(appointment: Appointment): Client[] {
  return [
    ...(appointment.client ? [appointment.client] : []),
    ...(appointment.participants ?? []).flatMap((participant) => participant.client ? [participant.client] : []),
  ]
}

export function appointmentClientNames(appointment: Appointment) {
  return appointmentClients(appointment)
    .map((client) => `${client.first_name} ${client.last_name}`.trim())
    .filter(Boolean)
    .join(' + ')
}

export function groupSaleDuration(hasCompanion: boolean, baseDuration: number) {
  return hasCompanion ? GROUP_SALE_DURATION_MINUTES : baseDuration
}

export function commercialPeople(appointment: Appointment): Array<{
  kind: 'primary' | 'companion'
  client: Client
  participant?: AppointmentParticipant
}> {
  const people: Array<{ kind: 'primary' | 'companion'; client: Client; participant?: AppointmentParticipant }> = []
  if (appointment.client) people.push({ kind: 'primary', client: appointment.client })
  for (const participant of appointment.participants ?? []) {
    if (participant.client) people.push({ kind: 'companion', client: participant.client, participant })
  }
  return people
}
