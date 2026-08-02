import { FormEvent, useEffect, useMemo, useState } from 'react'
import { addDays, formatDate, startOfWeek, toIsoDate } from '../lib/date'
import { orderCode, orderStatusLabels, orderStatuses, productionRouteLabels } from '../lib/operations'
import { supabase } from '../lib/supabase'
import type { Order, OrderStatus, Profile, WorkshopCapacityException } from '../types'

interface Props {
  profile: Profile
  refreshToken: number
  onChanged: (message: string, kind?: 'success' | 'error' | 'info') => void
}

export function Workshop({ profile, refreshToken, onChanged }: Props) {
  const [orders, setOrders] = useState<Order[]>([])
  const [exceptions, setExceptions] = useState<WorkshopCapacityException[]>([])
  const [defaultHours, setDefaultHours] = useState(40)
  const [warningPercent, setWarningPercent] = useState(85)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'late' | 'all'>('active')

  useEffect(() => { void loadData() }, [refreshToken])

  async function loadData() {
    const [ordersResult, capacityResult, settingsResult] = await Promise.all([
      supabase.from('orders').select('*, client:clients(*)').order('promised_delivery_date', { ascending: true, nullsFirst: false }),
      supabase.from('workshop_capacity_exceptions').select('*').order('week_start'),
      supabase.from('app_settings').select('setting_key,setting_value').in('setting_key', ['workshop_default_weekly_hours', 'workshop_capacity_warning_percent']),
    ])
    const firstError = ordersResult.error ?? capacityResult.error ?? settingsResult.error
    setError(firstError?.message ?? '')
    setOrders((ordersResult.data ?? []) as unknown as Order[])
    setExceptions((capacityResult.data ?? []) as WorkshopCapacityException[])
    const settings = Object.fromEntries((settingsResult.data ?? []).map((item) => [item.setting_key, Number(item.setting_value)]))
    setDefaultHours(settings.workshop_default_weekly_hours || 40)
    setWarningPercent(settings.workshop_capacity_warning_percent || 85)
  }

  const weeks = useMemo(() => Array.from({ length: 8 }, (_, index) => toIsoDate(addDays(startOfWeek(new Date()), index * 7))), [])
  const today = toIsoDate(new Date())
  const activeStatuses: OrderStatus[] = ['confirmed', 'pending_planning', 'planned', 'in_production', 'pending_fitting_1', 'corrections', 'pending_fitting_2', 'finishing', 'ready', 'on_hold']
  const filteredOrders = orders.filter((order) => {
    const active = activeStatuses.includes(order.status)
    const late = active && Boolean(order.promised_delivery_date && order.promised_delivery_date < today)
    if (statusFilter === 'late') return late
    if (statusFilter === 'active') return active
    return true
  })

  function availableForWeek(week: string) {
    return Number(exceptions.find((item) => item.week_start === week)?.available_hours ?? defaultHours)
  }

  function loadForWeek(week: string) {
    return orders.filter((item) => item.planned_week_start === week && activeStatuses.includes(item.status)).reduce((sum, item) => sum + Number(item.planned_hours ?? 0), 0)
  }

  async function saveCapacity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const { error: saveError } = await supabase.from('workshop_capacity_exceptions').upsert({
      week_start: String(form.get('week_start')),
      available_hours: Number(form.get('available_hours')),
      reason: String(form.get('reason')).trim() || null,
      created_by: profile.id,
      updated_by: profile.id,
    }, { onConflict: 'week_start' })
    if (saveError) setError(saveError.message)
    else { event.currentTarget.reset(); await loadData(); onChanged('Capacidad semanal actualizada.') }
  }

  async function updateOrder(event: FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const planned = nullableNumber(form.get('planned_hours'))
    const actual = nullableNumber(form.get('actual_hours'))
    const reason = String(form.get('variance_reason')).trim() || null
    if (planned !== null && actual !== null && planned !== actual && !reason) {
      setError(`Indica el motivo de la desviación en ${orderCode(order.order_sequence)}.`)
      return
    }
    const { error: updateError } = await supabase.from('orders').update({
      status: String(form.get('status')),
      planned_week_start: String(form.get('planned_week_start')) || null,
      planned_hours: planned,
      actual_hours: actual,
      variance_reason: reason,
      updated_by: profile.id,
    }).eq('id', order.id)
    if (updateError) setError(updateError.message)
    else { await loadData(); onChanged(`Pedido ${orderCode(order.order_sequence)} actualizado.`) }
  }

  const totalPlanned = filteredOrders.reduce((sum, item) => sum + Number(item.planned_hours ?? 0), 0)
  const totalActual = filteredOrders.reduce((sum, item) => sum + Number(item.actual_hours ?? 0), 0)
  const unplanned = orders.filter((item) => activeStatuses.includes(item.status) && (!item.planned_week_start || item.planned_hours === null)).length
  const late = orders.filter((item) => activeStatuses.includes(item.status) && item.promised_delivery_date && item.promised_delivery_date < today).length

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Taller</h1><p>Capacidad semanal y control simple de horas planificadas versus reales.</p></div></div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="metric-grid four-metrics">
        <Metric label="Horas planificadas" value={`${totalPlanned.toLocaleString('es-CL')} h`} />
        <Metric label="Horas reales" value={`${totalActual.toLocaleString('es-CL')} h`} />
        <Metric label="Sin planificar" value={String(unplanned)} />
        <Metric label="Pedidos atrasados" value={String(late)} danger={late > 0} />
      </div>

      <div className="panel">
        <div className="detail-heading"><div><h2>Capacidad de las próximas 8 semanas</h2><p>La carga corresponde a las horas planificadas de los pedidos asignados a cada semana.</p></div></div>
        <div className="capacity-week-grid">
          {weeks.map((week) => {
            const available = availableForWeek(week)
            const load = loadForWeek(week)
            const percent = available ? Math.round(load / available * 100) : load > 0 ? 100 : 0
            return <article className={`capacity-week ${percent > 100 ? 'overloaded' : percent >= warningPercent ? 'warning' : ''}`} key={week}><strong>Semana {formatDate(week)}</strong><span>{load} de {available} h</span><div className="progress-track"><div style={{ width: `${Math.min(percent, 100)}%` }} /></div><small>{percent}% utilizado</small></article>
          })}
        </div>
      </div>

      {(profile.role === 'admin' || profile.role === 'workshop') && (
        <form className="panel form-stack" onSubmit={saveCapacity}>
          <h2>Ajustar capacidad de una semana</h2>
          <div className="form-grid three-columns">
            <label>Lunes de la semana<input name="week_start" type="date" required /></label>
            <label>Horas disponibles<input name="available_hours" type="number" min="0" step="0.25" required defaultValue={defaultHours} /></label>
            <label>Motivo<input name="reason" placeholder="Feriado, vacaciones, refuerzo…" /></label>
          </div>
          <button className="btn btn-primary">Guardar capacidad</button>
        </form>
      )}

      <div className="panel">
        <div className="detail-heading"><div><h2>Pedidos del taller</h2><p>La jefa de taller registra el total previsto y el total real del pedido.</p></div><div className="segmented"><button type="button" className={statusFilter === 'active' ? 'active' : ''} onClick={() => setStatusFilter('active')}>Activos</button><button type="button" className={statusFilter === 'late' ? 'active' : ''} onClick={() => setStatusFilter('late')}>Atrasados</button><button type="button" className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>Todos</button></div></div>
        <div className="workshop-order-list">
          {filteredOrders.map((order) => (
            <form className="workshop-order-card" key={order.id} onSubmit={(event) => void updateOrder(event, order)}>
              <div><strong>{orderCode(order.order_sequence)} · {order.product_name}</strong><small>{order.client?.first_name} {order.client?.last_name} · {productionRouteLabels[order.production_route]}</small><small>Entrega: {order.promised_delivery_date ? formatDate(order.promised_delivery_date) : 'sin fecha'}</small></div>
              <label>Estado<select name="status" defaultValue={order.status}>{orderStatuses.map((status) => <option key={status} value={status}>{orderStatusLabels[status]}</option>)}</select></label>
              <label>Semana<input name="planned_week_start" type="date" defaultValue={order.planned_week_start ?? ''} /></label>
              <label>Horas plan.<input name="planned_hours" type="number" min="0" step="0.25" defaultValue={order.planned_hours ?? ''} /></label>
              <label>Horas reales<input name="actual_hours" type="number" min="0" step="0.25" defaultValue={order.actual_hours ?? ''} /></label>
              <label>Desviación<input name="variance_reason" defaultValue={order.variance_reason ?? ''} placeholder="Motivo si difieren" /></label>
              <button className="btn btn-secondary btn-sm">Guardar</button>
            </form>
          ))}
          {!filteredOrders.length && <p className="empty-state">No hay pedidos en este filtro.</p>}
        </div>
      </div>
    </section>
  )
}

function nullableNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text === '' ? null : Number(text)
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className={`metric-card ${danger ? 'metric-danger' : ''}`}><span>{label}</span><strong>{value}</strong></div>
}
