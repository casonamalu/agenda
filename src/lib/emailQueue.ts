import type { EmailQueueItem } from '../types'

export interface EmailQueueFilters {
  search: string
  kind: string
  status: string
  dateFrom?: string
  dateTo?: string
}

export function isAppointmentEmail(item: EmailQueueItem) {
  return item.kind === 'appointment_created' || item.kind === 'reminder'
}

export function canResendAppointmentEmail(item: EmailQueueItem) {
  return isAppointmentEmail(item) && ['sent', 'failed', 'cancelled'].includes(item.status)
}

export function filterEmailQueue(items: EmailQueueItem[], filters: EmailQueueFilters) {
  const search = filters.search.trim().toLocaleLowerCase('es-CL')
  return items.filter((item) => {
    if (filters.kind && item.kind !== filters.kind) return false
    if (filters.status && item.status !== filters.status) return false
    const eventDate = chileIsoDate(item.sent_at ?? item.created_at)
    if (filters.dateFrom && eventDate < filters.dateFrom) return false
    if (filters.dateTo && eventDate > filters.dateTo) return false
    if (!search) return true
    const clients = [
      item.appointment?.client,
      ...(item.appointment?.participants ?? []).map((participant) => participant.client),
    ].filter(Boolean)
    const clientNames = clients
      .map((client) => `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim())
      .join(' ')
    return `${item.recipient} ${clientNames}`.toLocaleLowerCase('es-CL').includes(search)
  })
}

function chileIsoDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`
}

export function emailQueueSummary(items: EmailQueueItem[]) {
  const appointmentEmails = items.filter(isAppointmentEmail)
  return {
    confirmationsSent: appointmentEmails.filter((item) => item.kind === 'appointment_created' && item.status === 'sent').length,
    remindersSent: appointmentEmails.filter((item) => item.kind === 'reminder' && item.status === 'sent').length,
    pending: appointmentEmails.filter((item) => item.status === 'pending' || item.status === 'processing' || item.status === 'retry').length,
    problems: appointmentEmails.filter((item) => item.status === 'failed').length,
  }
}
