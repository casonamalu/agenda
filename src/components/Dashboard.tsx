import { useEffect, useMemo, useState } from 'react'
import { endOfMonth, startOfMonth, toIsoDate } from '../lib/date'
import { supabase } from '../lib/supabase'
import type { Appointment } from '../types'

interface CapacityByType {
  category_key: 'sale' | 'trial' | 'delivery'
  label: string
  color: string
  total_capacity: number
  booked: number
  available: number
}

interface DayLoad {
  date: string
  count: number
  minutes: number
}

export function Dashboard({ refreshToken }: { refreshToken: number }) {
  const [cursor, setCursor] = useState(new Date())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [capacity, setCapacity] = useState<CapacityByType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { void loadData() }, [cursor.getMonth(), cursor.getFullYear(), refreshToken])

  async function loadData() {
    setLoading(true)
    setError('')
    const from = toIsoDate(startOfMonth(cursor))
    const to = toIsoDate(endOfMonth(cursor))
    const [appointmentsResult, capacityResult] = await Promise.all([
      supabase
        .from('appointments')
        .select('*, client:clients(*, client_type:client_types(*)), appointment_type:appointment_types(*)')
        .gte('appointment_date', from)
        .lte('appointment_date', to),
      supabase.rpc('get_capacity_by_type_in_range', { p_from: from, p_to: to }),
    ])

    if (appointmentsResult.error) setError(appointmentsResult.error.message)
    else setAppointments((appointmentsResult.data ?? []) as Appointment[])

    if (capacityResult.error) setError((current) => current || capacityResult.error.message)
    else {
      setCapacity(((capacityResult.data ?? []) as CapacityByType[]).map((item) => ({
        ...item,
        total_capacity: Number(item.total_capacity),
        booked: Number(item.booked),
        available: Number(item.available),
      })))
    }
    setLoading(false)
  }

  const summary = useMemo(() => {
    const active = appointments.filter((appointment) => appointment.status !== 'cancelled')
    const totalMinutes = active.reduce((sum, appointment) => sum + appointmentMinutes(appointment), 0)
    const from = startOfMonth(cursor)
    const to = endOfMonth(cursor)
    const dailyMap = new Map<string, DayLoad>()

    for (const date = new Date(from); date <= to; date.setDate(date.getDate() + 1)) {
      if (date.getDay() === 0) continue
      const iso = toIsoDate(date)
      dailyMap.set(iso, { date: iso, count: 0, minutes: 0 })
    }

    active.forEach((appointment) => {
      const current = dailyMap.get(appointment.appointment_date)
      if (!current) return
      current.count += 1
      current.minutes += appointmentMinutes(appointment)
    })

    const daily = [...dailyMap.values()]
    const workingDays = daily.length
    const daysWithLoad = daily.filter((day) => day.count > 0).length
    const weeklyMap = new Map<number, { label: string; count: number; minutes: number }>()
    daily.forEach((day) => {
      const dayNumber = Number(day.date.slice(8, 10))
      const week = Math.floor((dayNumber - 1) / 7) + 1
      const current = weeklyMap.get(week) ?? { label: `Semana ${week}`, count: 0, minutes: 0 }
      current.count += day.count
      current.minutes += day.minutes
      weeklyMap.set(week, current)
    })

    const byTypeMap = new Map<string, { name: string; count: number; color: string }>()
    active.forEach((appointment) => {
      const name = appointment.appointment_type?.name ?? 'Sin tipo'
      const item = byTypeMap.get(name) ?? {
        name,
        count: 0,
        color: appointment.appointment_type?.color ?? '#7f3f52',
      }
      item.count += 1
      byTypeMap.set(name, item)
    })

    return {
      active,
      totalMinutes,
      workingDays,
      daysWithLoad,
      daily,
      weekly: [...weeklyMap.values()],
      byType: [...byTypeMap.values()].sort((a, b) => b.count - a.count),
      cancelled: appointments.filter((item) => item.status === 'cancelled').length,
      noShow: appointments.filter((item) => item.status === 'no_show').length,
    }
  }, [appointments, cursor])

  const maxType = Math.max(1, ...summary.byType.map((item) => item.count))
  const maxWeekMinutes = Math.max(1, ...summary.weekly.map((item) => item.minutes))
  const maxDayMinutes = Math.max(1, ...summary.daily.map((item) => item.minutes))
  const averagePerWorkingDay = summary.workingDays
    ? summary.active.length / summary.workingDays
    : 0

  return (
    <section className="page-section printable-area">
      <div className="page-heading">
        <div>
          <h1>Indicadores</h1>
          <p>Carga de trabajo y capacidad operacional del mes.</p>
        </div>
        <div className="month-picker no-print">
          <button className="icon-button" type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹</button>
          <strong>{new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' }).format(cursor)}</strong>
          <button className="icon-button" type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>›</button>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? <div className="loading-state">Calculando indicadores…</div> : (
        <>
          <div className="kpi-grid">
            <Kpi label="Citas activas" value={summary.active.length} />
            <Kpi label="Horas agendadas" value={formatHours(summary.totalMinutes)} />
            <Kpi label="Días con carga" value={summary.daysWithLoad} />
            <Kpi label="Promedio por día hábil" value={averagePerWorkingDay.toFixed(1)} />
            <Kpi label="Canceladas" value={summary.cancelled} />
            <Kpi label="No asistió" value={summary.noShow} />
          </div>

          <div className="dashboard-grid">
            <ChartCard title="Citas activas por tipo">
              {summary.byType.length
                ? summary.byType.map((item) => (
                    <Bar key={item.name} label={item.name} value={item.count} displayValue={String(item.count)} max={maxType} color={item.color} />
                  ))
                : <p>Sin citas para el período.</p>}
            </ChartCard>

            <ChartCard title="Carga de trabajo por semana">
              {summary.weekly.map((item) => (
                <Bar
                  key={item.label}
                  label={`${item.label} · ${item.count} citas`}
                  value={item.minutes}
                  displayValue={formatHours(item.minutes)}
                  max={maxWeekMinutes}
                />
              ))}
            </ChartCard>

            <article className="chart-card dashboard-span-two">
              <h2>Capacidad del mes por tipo operativo</h2>
              <p>Prueba 1 y Prueba 2 se muestran juntas porque comparten el máximo diario.</p>
              <div className="capacity-list">
                {capacity.map((item) => <CapacityRow key={item.category_key} item={item} />)}
              </div>
            </article>

            <article className="chart-card dashboard-span-two">
              <h2>Carga diaria completa del mes</h2>
              <p>Cada día muestra la cantidad de citas activas y las horas de atención programadas.</p>
              <div className="workload-grid">
                {summary.daily.map((day) => {
                  const date = new Date(`${day.date}T12:00:00`)
                  const intensity = day.minutes / maxDayMinutes
                  return (
                    <article
                      key={day.date}
                      className={`workload-day ${day.count ? '' : 'empty'}`}
                      style={{ '--load-intensity': intensity } as React.CSSProperties}
                    >
                      <span>{new Intl.DateTimeFormat('es-CL', { weekday: 'short' }).format(date)}</span>
                      <strong>{date.getDate()}</strong>
                      <small>{day.count} {day.count === 1 ? 'cita' : 'citas'}</small>
                      <small>{formatHours(day.minutes)}</small>
                    </article>
                  )
                })}
              </div>
            </article>
          </div>
        </>
      )}
    </section>
  )
}

function appointmentMinutes(appointment: Appointment) {
  const [startHour, startMinute] = appointment.start_time.slice(0, 5).split(':').map(Number)
  const [endHour, endMinute] = appointment.end_time.slice(0, 5).split(':').map(Number)
  return Math.max(0, (endHour * 60 + endMinute) - (startHour * 60 + startMinute))
}

function formatHours(minutes: number) {
  if (!minutes) return '0 h'
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return <article className="kpi-card"><span>{label}</span><strong>{value}</strong></article>
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="chart-card"><h2>{title}</h2><div className="bar-list">{children}</div></article>
}

function Bar({
  label,
  value,
  displayValue,
  max,
  color = '#7f3f52',
}: {
  label: string
  value: number
  displayValue: string
  max: number
  color?: string
}) {
  return (
    <div className="bar-item">
      <div><span>{label}</span><strong>{displayValue}</strong></div>
      <div className="bar-track"><span style={{ width: `${value ? Math.max(4, (value / max) * 100) : 0}%`, background: color }} /></div>
    </div>
  )
}

function CapacityRow({ item }: { item: CapacityByType }) {
  const bookedWidth = item.total_capacity > 0
    ? Math.min(100, Math.round((item.booked / item.total_capacity) * 100))
    : 0
  return (
    <div className="capacity-row">
      <div>
        <span className="capacity-dot" style={{ background: item.color }} />
        <strong>{item.label}</strong>
      </div>
      <div className="capacity-values">
        <span><strong>{item.total_capacity}</strong> total</span>
        <span><strong>{item.booked}</strong> agendados</span>
        <span><strong>{item.available}</strong> disponibles</span>
      </div>
      <div className="capacity-track">
        <span style={{ width: `${bookedWidth}%`, background: item.color }} />
      </div>
    </div>
  )
}
