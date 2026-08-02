const chileDateFormatter = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function toIsoDate(date: Date): string {
  const parts = chileDateFormatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${year}-${month}-${day}`
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

export function addDays(date: Date, amount: number): Date {
  const clone = new Date(date)
  clone.setDate(clone.getDate() + amount)
  return clone
}

export function startOfWeek(date: Date): Date {
  const clone = new Date(date)
  const day = clone.getDay()
  const diff = day === 0 ? -6 : 1 - day
  clone.setDate(clone.getDate() + diff)
  clone.setHours(12, 0, 0, 0)
  return clone
}

export function endOfWeek(date: Date): Date {
  return addDays(startOfWeek(date), 5)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12)
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12)
}

export function getCalendarRange(view: 'day' | 'week' | 'month', cursor: Date) {
  if (view === 'day') {
    const iso = toIsoDate(cursor)
    return { from: iso, to: iso }
  }
  if (view === 'week') {
    return { from: toIsoDate(startOfWeek(cursor)), to: toIsoDate(endOfWeek(cursor)) }
  }
  return { from: toIsoDate(startOfMonth(cursor)), to: toIsoDate(endOfMonth(cursor)) }
}

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'medium',
    ...options,
  }).format(parseLocalDate(value))
}

export function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parseLocalDate(value))
}

export function formatTime(value: string): string {
  return value.slice(0, 5)
}

export function getMonthGrid(cursor: Date): Array<Date | null> {
  const first = startOfMonth(cursor)
  const last = endOfMonth(cursor)
  const startIndex = first.getDay() === 0 ? 6 : first.getDay() - 1
  const days: Array<Date | null> = Array.from({ length: startIndex }, () => null)
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push(new Date(cursor.getFullYear(), cursor.getMonth(), day, 12))
  }
  while (days.length % 7 !== 0) days.push(null)
  return days
}

export function appointmentDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time.slice(0, 5)}:00-04:00`)
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: 'Agendada',
    rescheduled: 'Reprogramada',
    cancelled: 'Cancelada',
    no_show: 'No asistió',
  }
  return labels[status] ?? status
}

export function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Administrador',
    seller: 'Vendedora',
    reception: 'Recepción',
    workshop: 'Taller',
  }
  return labels[role] ?? role
}
