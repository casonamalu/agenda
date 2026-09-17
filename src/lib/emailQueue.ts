import type { EmailQueueItem } from '../types'

export interface EmailQueueFilters {
  search: string
  kind: string
  status: string
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
    if (!search) return true
    const clientName = item.appointment?.client
      ? `${item.appointment.client.first_name} ${item.appointment.client.last_name}`
      : ''
    return `${item.recipient} ${clientName}`.toLocaleLowerCase('es-CL').includes(search)
  })
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
