import { useEffect, useMemo, useState } from 'react'
import { endOfMonth, startOfMonth, toIsoDate } from '../lib/date'
import { supabase } from '../lib/supabase'
import type { Appointment, DashboardStats } from '../types'

const weekdayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export function Dashboard({ refreshToken }: { refreshToken: number }) {
  const [cursor, setCursor] = useState(new Date())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [availableSlots, setAvailableSlots] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { void loadData() }, [cursor.getMonth(), cursor.getFullYear(), refreshToken])

  async function loadData() {
    setLoading(true)
    const from = toIsoDate(startOfMonth(cursor))
    const to = toIsoDate(endOfMonth(cursor))
    const [{ data }, { data: capacityData }] = await Promise.all([
      supabase
        .from('appointments')
        .select('*, client:clients(*, client_type:client_types(*)), appointment_type:appointment_types(*)')
        .gte('appointment_date', from)
        .lte('appointment_date', to),
      supabase.rpc('count_available_slots_in_range', { p_from: from, p_to: to }),
    ])
    setAppointments((data ?? []) as Appointment[])
    setAvailableSlots(Number(capacityData ?? 0))
    setLoading(false)
  }

  const stats = useMemo<DashboardStats>(() => {
    const active = appointments.filter((appointment) => appointment.status !== 'cancelled')
    const byTypeMap = new Map<string, { name: string; count: number; color: string }>()
    const byClientTypeMap = new Map<string, number>()
    const byWeekdayMap = new Map<string, number>()
    appointments.forEach((appointment) => {
      const typeName = appointment.appointment_type?.name ?? 'Sin tipo'
      const existingType = byTypeMap.get(typeName) ?? { name: typeName, count: 0, color: appointment.appointment_type?.color ?? '#7f3f52' }
      existingType.count += 1
      byTypeMap.set(typeName, existingType)
      const clientType = appointment.client?.client_type?.name ?? 'Sin tipo'
      byClientTypeMap.set(clientType, (byClientTypeMap.get(clientType) ?? 0) + 1)
      const weekday = weekdayNames[new Date(`${appointment.appointment_date}T12:00:00`).getDay()]
      byWeekdayMap.set(weekday, (byWeekdayMap.get(weekday) ?? 0) + 1)
    })
    return {
      total: appointments.length,
      scheduled: appointments.filter((item) => item.status === 'scheduled').length,
      rescheduled: appointments.filter((item) => item.status === 'rescheduled').length,
      cancelled: appointments.filter((item) => item.status === 'cancelled').length,
      noShow: appointments.filter((item) => item.status === 'no_show').length,
      byType: Array.from(byTypeMap.values()).sort((a, b) => b.count - a.count),
      byClientType: Array.from(byClientTypeMap, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      byWeekday: Array.from(byWeekdayMap, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      utilization: availableSlots > 0 ? Math.min(100, Math.round((active.length / availableSlots) * 100)) : 0,
    }
  }, [appointments, availableSlots])

  const maxType = Math.max(1, ...stats.byType.map((item) => item.count))
  const maxClientType = Math.max(1, ...stats.byClientType.map((item) => item.count))
  const maxWeekday = Math.max(1, ...stats.byWeekday.map((item) => item.count))

  return (
    <section className="page-section printable-area">
      <div className="page-heading">
        <div>
          <h1>Indicadores</h1>
          <p>Resumen operacional de la agenda.</p>
        </div>
        <div className="month-picker no-print">
          <button className="icon-button" type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹</button>
          <strong>{new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' }).format(cursor)}</strong>
          <button className="icon-button" type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>›</button>
        </div>
      </div>
      {loading ? <div className="loading-state">Calculando indicadores…</div> : (
        <>
          <div className="kpi-grid">
            <Kpi label="Citas del mes" value={stats.total} />
            <Kpi label="Agendadas" value={stats.scheduled} />
            <Kpi label="Reprogramadas" value={stats.rescheduled} />
            <Kpi label="Canceladas" value={stats.cancelled} />
            <Kpi label="No asistió" value={stats.noShow} />
            <Kpi label="Utilización estimada" value={`${stats.utilization}%`} />
          </div>
          <div className="dashboard-grid">
            <ChartCard title="Citas por tipo">
              {stats.byType.map((item) => <Bar key={item.name} label={item.name} count={item.count} max={maxType} color={item.color} />)}
            </ChartCard>
            <ChartCard title="Citas por tipo de cliente">
              {stats.byClientType.map((item) => <Bar key={item.name} label={item.name} count={item.count} max={maxClientType} />)}
            </ChartCard>
            <ChartCard title="Demanda por día">
              {stats.byWeekday.map((item) => <Bar key={item.name} label={item.name} count={item.count} max={maxWeekday} />)}
            </ChartCard>
            <ChartCard title="Capacidad del período">
              <div className="capacity-ring" style={{ '--percentage': `${stats.utilization * 3.6}deg` } as React.CSSProperties}>
                <strong>{stats.utilization}%</strong>
                <span>{appointments.filter((item) => item.status !== 'cancelled').length} de {availableSlots} cupos</span>
              </div>
            </ChartCard>
          </div>
        </>
      )}
    </section>
  )
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return <article className="kpi-card"><span>{label}</span><strong>{value}</strong></article>
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="chart-card"><h2>{title}</h2><div className="bar-list">{children}</div></article>
}

function Bar({ label, count, max, color = '#7f3f52' }: { label: string; count: number; max: number; color?: string }) {
  return (
    <div className="bar-item">
      <div><span>{label}</span><strong>{count}</strong></div>
      <div className="bar-track"><span style={{ width: `${Math.max(4, (count / max) * 100)}%`, background: color }} /></div>
    </div>
  )
}
