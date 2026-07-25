import { useEffect, useMemo, useState } from 'react'
import {
  addDays,
  endOfMonth,
  endOfWeek,
  formatDate,
  formatLongDate,
  formatTime,
  getCalendarRange,
  getMonthGrid,
  startOfMonth,
  startOfWeek,
  statusLabel,
  toIsoDate,
} from '../lib/date'
import { supabase } from '../lib/supabase'
import type { Appointment, AppointmentType, CalendarView } from '../types'

interface Props {
  refreshToken: number
  onOpenAppointment: (appointment: Appointment) => void
  onDateForNewAppointment: (date: string) => void
}

function appointmentClass(appointment: Appointment) {
  return `appointment-card status-${appointment.status}${appointment.is_overbook ? ' overbook' : ''}`
}

export function Agenda({ refreshToken, onOpenAppointment, onDateForNewAppointment }: Props) {
  const [view, setView] = useState<CalendarView>('day')
  const [cursor, setCursor] = useState(new Date())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [types, setTypes] = useState<AppointmentType[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [error, setError] = useState('')

  const range = useMemo(() => getCalendarRange(view, cursor), [view, cursor])

  useEffect(() => {
    void loadData()
    const channel = supabase
      .channel('agenda-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => void loadData())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [range.from, range.to, refreshToken])

  async function loadData() {
    setLoading(true)
    setError('')
    const [appointmentsResult, typesResult] = await Promise.all([
      supabase
        .from('appointments')
        .select('*, client:clients(*, client_type:client_types(*)), appointment_type:appointment_types(*)')
        .gte('appointment_date', range.from)
        .lte('appointment_date', range.to)
        .order('appointment_date')
        .order('start_time'),
      supabase.from('appointment_types').select('*').eq('active', true).order('sort_order'),
    ])
    if (appointmentsResult.error) setError(appointmentsResult.error.message)
    setAppointments((appointmentsResult.data ?? []) as Appointment[])
    setTypes((typesResult.data ?? []) as AppointmentType[])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return appointments.filter((appointment) => {
      const client = appointment.client
      const haystack = `${client?.first_name ?? ''} ${client?.last_name ?? ''} ${client?.email ?? ''} ${client?.phone ?? ''}`.toLowerCase()
      return (
        (!normalized || haystack.includes(normalized)) &&
        (!typeFilter || appointment.appointment_type_id === typeFilter) &&
        (!statusFilter || appointment.status === statusFilter)
      )
    })
  }, [appointments, search, statusFilter, typeFilter])

  function navigate(amount: number) {
    if (view === 'day') setCursor(addDays(cursor, amount))
    if (view === 'week') setCursor(addDays(cursor, amount * 7))
    if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + amount, 1, 12))
  }

  function printAgenda() {
    window.print()
  }

  function title() {
    if (view === 'day') return formatLongDate(toIsoDate(cursor))
    if (view === 'week') return `${formatDate(toIsoDate(startOfWeek(cursor)))} — ${formatDate(toIsoDate(endOfWeek(cursor)))}`
    return new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' }).format(cursor)
  }

  return (
    <section className="page-section printable-area">
      <div className="page-heading">
        <div>
          <h1>Agenda</h1>
          <p>Consulta y administra todas las citas de Casona Malú.</p>
        </div>
        <button type="button" className="btn btn-secondary no-print" onClick={printAgenda}>Exportar a PDF</button>
      </div>

      <div className="toolbar no-print">
        <div className="segmented">
          {(['day', 'week', 'month'] as CalendarView[]).map((item) => (
            <button key={item} type="button" className={view === item ? 'active' : ''} onClick={() => setView(item)}>
              {item === 'day' ? 'Día' : item === 'week' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
        <div className="date-navigation">
          <button type="button" className="icon-button" onClick={() => navigate(-1)}>‹</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCursor(new Date())}>Hoy</button>
          <button type="button" className="icon-button" onClick={() => navigate(1)}>›</button>
          <strong>{title()}</strong>
        </div>
      </div>

      <div className="filter-grid no-print">
        <label>
          Buscar cliente
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, correo o teléfono" />
        </label>
        <label>
          Tipo de cita
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">Todos</option>
            {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </label>
        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos</option>
            <option value="scheduled">Agendada</option>
            <option value="rescheduled">Reprogramada</option>
            <option value="cancelled">Cancelada</option>
            <option value="no_show">No asistió</option>
          </select>
        </label>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? <div className="loading-state">Cargando agenda…</div> : (
        <>
          {view === 'day' && (
            <DayView
              date={toIsoDate(cursor)}
              appointments={filtered}
              onOpen={onOpenAppointment}
              onNew={onDateForNewAppointment}
            />
          )}
          {view === 'week' && (
            <WeekView
              cursor={cursor}
              appointments={filtered}
              onOpen={onOpenAppointment}
              onNew={onDateForNewAppointment}
            />
          )}
          {view === 'month' && (
            <MonthView
              cursor={cursor}
              appointments={filtered}
              onOpen={onOpenAppointment}
              onNew={onDateForNewAppointment}
            />
          )}
        </>
      )}
    </section>
  )
}

function AppointmentCard({ appointment, onOpen }: { appointment: Appointment; onOpen: (appointment: Appointment) => void }) {
  const type = appointment.appointment_type
  return (
    <button
      type="button"
      className={appointmentClass(appointment)}
      style={{ '--appointment-color': type?.color ?? '#7f3f52' } as React.CSSProperties}
      onClick={() => onOpen(appointment)}
    >
      <span className="appointment-time">{formatTime(appointment.start_time)}–{formatTime(appointment.end_time)}</span>
      <strong>{appointment.client?.first_name} {appointment.client?.last_name}</strong>
      <span>{type?.name ?? 'Cita'} · {statusLabel(appointment.status)}</span>
      {appointment.is_overbook && <em>Sobrecupo</em>}
    </button>
  )
}

function DayView({ date, appointments, onOpen, onNew }: { date: string; appointments: Appointment[]; onOpen: (appointment: Appointment) => void; onNew: (date: string) => void }) {
  const dayAppointments = appointments.filter((appointment) => appointment.appointment_date === date)
  return (
    <div className="day-view">
      <div className="calendar-day-header">
        <div>
          <strong>{formatLongDate(date)}</strong>
          <span>{dayAppointments.length} cita(s)</span>
        </div>
        <button type="button" className="btn btn-secondary btn-sm no-print" onClick={() => onNew(date)}>+ Agendar este día</button>
      </div>
      <div className="appointment-list">
        {dayAppointments.length === 0 ? <div className="empty-state">No existen citas para este día.</div> : dayAppointments.map((appointment) => (
          <AppointmentCard key={appointment.id} appointment={appointment} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

function WeekView({ cursor, appointments, onOpen, onNew }: { cursor: Date; appointments: Appointment[]; onOpen: (appointment: Appointment) => void; onNew: (date: string) => void }) {
  const start = startOfWeek(cursor)
  const days = Array.from({ length: 6 }, (_, index) => addDays(start, index))
  return (
    <div className="week-grid">
      {days.map((date) => {
        const iso = toIsoDate(date)
        const dayAppointments = appointments.filter((appointment) => appointment.appointment_date === iso)
        return (
          <article className="week-column" key={iso}>
            <header>
              <strong>{new Intl.DateTimeFormat('es-CL', { weekday: 'short' }).format(date)}</strong>
              <span>{date.getDate()}</span>
              <button type="button" className="mini-add no-print" onClick={() => onNew(iso)}>+</button>
            </header>
            <div className="week-appointments">
              {dayAppointments.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} onOpen={onOpen} />)}
              {dayAppointments.length === 0 && <small>Sin citas</small>}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function MonthView({ cursor, appointments, onOpen, onNew }: { cursor: Date; appointments: Appointment[]; onOpen: (appointment: Appointment) => void; onNew: (date: string) => void }) {
  const grid = getMonthGrid(cursor)
  const monthStart = toIsoDate(startOfMonth(cursor))
  const monthEnd = toIsoDate(endOfMonth(cursor))
  const monthAppointments = appointments.filter((appointment) => appointment.appointment_date >= monthStart && appointment.appointment_date <= monthEnd)
  return (
    <div className="month-wrapper">
      <div className="month-weekdays">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => <strong key={day}>{day}</strong>)}
      </div>
      <div className="month-grid">
        {grid.map((date, index) => {
          if (!date) return <div className="month-cell muted-cell" key={`empty-${index}`} />
          const iso = toIsoDate(date)
          const dayAppointments = monthAppointments.filter((appointment) => appointment.appointment_date === iso)
          return (
            <article className="month-cell" key={iso}>
              <header>
                <button type="button" onClick={() => onNew(iso)}>{date.getDate()}</button>
                <span>{dayAppointments.length}</span>
              </header>
              <div>
                {dayAppointments.slice(0, 3).map((appointment) => (
                  <button
                    key={appointment.id}
                    type="button"
                    className={`month-event status-${appointment.status}`}
                    style={{ '--appointment-color': appointment.appointment_type?.color ?? '#7f3f52' } as React.CSSProperties}
                    onClick={() => onOpen(appointment)}
                  >
                    {formatTime(appointment.start_time)} {appointment.client?.first_name}
                  </button>
                ))}
                {dayAppointments.length > 3 && <small>+{dayAppointments.length - 3} más</small>}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
