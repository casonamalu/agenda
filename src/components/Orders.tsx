import { FormEvent, useEffect, useMemo, useState } from 'react'
import { formatDate, toIsoDate } from '../lib/date'
import { costCategoryLabels, formatClp, orderCode, orderStatusLabels, orderStatuses, productionRouteLabels } from '../lib/operations'
import { supabase } from '../lib/supabase'
import type { Appointment, Client, CostCategory, CostPhase, Order, OrderFinancials, Profile, ProductionRoute } from '../types'

interface Props {
  profile: Profile
  refreshToken: number
  onChanged: (message: string, kind?: 'success' | 'error' | 'info') => void
}

const orderSelect = `
  *,
  client:clients(*, client_type:client_types(*)),
  financials:order_financials(*),
  cost_items:order_cost_items(*),
  payments:order_payments(*)
`

export function Orders({ profile, refreshToken, onChanged }: Props) {
  const commercialAccess = profile.role === 'admin' || profile.role === 'seller'
  const costAccess = commercialAccess || profile.role === 'workshop'
  const [orders, setOrders] = useState<Order[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selected = orders.find((order) => order.id === selectedId) ?? null
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es-CL')
    if (!term) return orders
    return orders.filter((order) => [
      orderCode(order.order_sequence),
      order.product_name,
      order.client?.first_name,
      order.client?.last_name,
      productionRouteLabels[order.production_route],
      orderStatusLabels[order.status],
    ].some((value) => value?.toLocaleLowerCase('es-CL').includes(term)))
  }, [orders, query])

  useEffect(() => { void loadData() }, [refreshToken])

  async function loadData(selectId?: string) {
    setError('')
    const [ordersResult, clientsResult, appointmentsResult] = await Promise.all([
      supabase.from('orders').select(orderSelect).order('created_at', { ascending: false }),
      supabase.from('clients').select('*, client_type:client_types(*)').eq('active', true).order('last_name'),
      supabase.from('appointments').select('*, appointment_type:appointment_types(*), client:clients(*)').neq('status', 'cancelled').order('appointment_date', { ascending: false }).limit(300),
    ])
    if (ordersResult.error) setError(ordersResult.error.message)
    if (clientsResult.error) setError(clientsResult.error.message)
    setOrders((ordersResult.data ?? []) as unknown as Order[])
    setClients((clientsResult.data ?? []) as Client[])
    setAppointments((appointmentsResult.data ?? []) as unknown as Appointment[])
    if (selectId) setSelectedId(selectId)
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const appointmentId = String(form.get('source_appointment_id') ?? '') || null
    const { data, error: createError } = await supabase.rpc('create_order_with_financials', {
      p_client_id: String(form.get('client_id')),
      p_source_appointment_id: appointmentId,
      p_production_route: String(form.get('production_route')) as ProductionRoute,
      p_product_name: String(form.get('product_name')).trim(),
      p_design_description: String(form.get('design_description')).trim() || null,
      p_sale_date: String(form.get('sale_date')) || null,
      p_event_date: String(form.get('event_date')) || null,
      p_promised_delivery_date: String(form.get('promised_delivery_date')) || null,
      p_gross_sale_amount: Number(form.get('gross_sale_amount') || 0),
      p_discount_amount: Number(form.get('discount_amount') || 0),
      p_internal_notes: String(form.get('internal_notes')).trim() || null,
    })
    setLoading(false)
    if (createError) {
      setError(createError.message)
      return
    }
    event.currentTarget.reset()
    setShowNew(false)
    await loadData(data as string)
    onChanged('Pedido creado y enviado a planificación de taller.')
  }

  async function saveOperations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const form = new FormData(event.currentTarget)
    const plannedHours = nullableNumber(form.get('planned_hours'))
    const actualHours = nullableNumber(form.get('actual_hours'))
    const varianceReason = String(form.get('variance_reason') ?? '').trim() || null
    if (plannedHours !== null && actualHours !== null && plannedHours !== actualHours && !varianceReason) {
      setError('Indica el motivo cuando las horas reales son distintas a las planificadas.')
      return
    }
    setLoading(true)
    const { error: updateError } = await supabase.from('orders').update({
      status: String(form.get('status')),
      production_start_date: String(form.get('production_start_date')) || null,
      planned_week_start: String(form.get('planned_week_start')) || null,
      promised_delivery_date: String(form.get('promised_delivery_date')) || null,
      actual_delivery_date: String(form.get('actual_delivery_date')) || null,
      planned_hours: plannedHours,
      actual_hours: actualHours,
      variance_reason: varianceReason,
      needs_fitting_1: form.get('needs_fitting_1') === 'on',
      needs_fitting_2: form.get('needs_fitting_2') === 'on',
      internal_notes: String(form.get('internal_notes')).trim() || null,
      updated_by: profile.id,
    }).eq('id', selected.id)
    setLoading(false)
    if (updateError) setError(updateError.message)
    else { await loadData(selected.id); onChanged('Planificación y avance del pedido actualizados.') }
  }

  async function saveFinancials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected?.financials || !commercialAccess) return
    const form = new FormData(event.currentTarget)
    const payload: Partial<OrderFinancials> = {
      gross_sale_amount: Number(form.get('gross_sale_amount') || 0),
      discount_amount: Number(form.get('discount_amount') || 0),
      tax_rate_snapshot: Number(form.get('tax_rate_snapshot') || 0),
      sales_commission_rate_snapshot: Number(form.get('sales_commission_rate_snapshot') || 0),
      card_fee_rate_snapshot: Number(form.get('card_fee_rate_snapshot') || 0),
      workshop_hourly_cost_snapshot: Number(form.get('workshop_hourly_cost_snapshot') || 0),
    }
    setLoading(true)
    const { error: updateError } = await supabase.from('order_financials').update({ ...payload, updated_by: profile.id }).eq('order_id', selected.id)
    setLoading(false)
    if (updateError) setError(updateError.message)
    else { await loadData(selected.id); onChanged('Datos comerciales del pedido actualizados.') }
  }

  async function addCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !costAccess) return
    const form = new FormData(event.currentTarget)
    const { error: insertError } = await supabase.from('order_cost_items').insert({
      order_id: selected.id,
      phase: String(form.get('phase')) as CostPhase,
      category: String(form.get('category')) as CostCategory,
      description: String(form.get('description')).trim(),
      quantity: Number(form.get('quantity') || 1),
      unit: String(form.get('unit')).trim() || 'unidad',
      unit_cost: Number(form.get('unit_cost') || 0),
      created_by: profile.id,
    })
    if (insertError) setError(insertError.message)
    else { event.currentTarget.reset(); await loadData(selected.id); onChanged('Costo agregado al pedido.') }
  }

  async function removeCost(id: string) {
    if (!window.confirm('¿Eliminar esta línea de costo?')) return
    const { error: deleteError } = await supabase.from('order_cost_items').delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
    else if (selected) { await loadData(selected.id); onChanged('Línea de costo eliminada.') }
  }

  async function linkAppointment(appointmentId: string) {
    if (!selected || !appointmentId) return
    const { error: linkError } = await supabase.rpc('link_appointment_to_order', { p_appointment_id: appointmentId, p_order_id: selected.id })
    if (linkError) setError(linkError.message)
    else { await loadData(selected.id); onChanged('Cita vinculada al pedido.') }
  }

  const linkedAppointments = selected ? appointments.filter((item) => item.order_id === selected.id) : []
  const linkableAppointments = selected ? appointments.filter((item) => item.client_id === selected.client_id && !item.order_id) : []
  const estimatedCosts = sumCosts(selected, 'estimated')
  const actualCosts = sumCosts(selected, 'actual')
  const paid = selected?.payments?.reduce((sum, item) => sum + Number(item.amount), 0) ?? 0
  const finalSale = Math.max(0, Number(selected?.financials?.gross_sale_amount ?? 0) - Number(selected?.financials?.discount_amount ?? 0))

  return (
    <section className="page-section">
      <div className="page-heading">
        <div><h1>Pedidos</h1><p>Seguimiento comercial, costos y trazabilidad desde la venta hasta la entrega.</p></div>
        {commercialAccess && <button className="btn btn-primary" type="button" onClick={() => setShowNew((open) => !open)}>{showNew ? 'Cerrar' : '+ Nuevo pedido'}</button>}
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      {showNew && commercialAccess && (
        <form className="panel form-stack" onSubmit={createOrder}>
          <h2>Registrar pedido</h2>
          <div className="form-grid three-columns">
            <label>Cliente<select name="client_id" required defaultValue=""><option value="" disabled>Seleccionar…</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.first_name} {client.last_name}</option>)}</select></label>
            <label>Ruta de producción<select name="production_route" required defaultValue="stock_adjustments">{Object.entries(productionRouteLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Producto / vestido<input name="product_name" required placeholder="Ej.: Vestido modelo Aurora" /></label>
            <label>Fecha de venta<input name="sale_date" type="date" defaultValue={toIsoDate(new Date())} /></label>
            <label>Fecha del evento<input name="event_date" type="date" /></label>
            <label>Entrega comprometida<input name="promised_delivery_date" type="date" /></label>
            <label>Valor venta (IVA incluido)<input name="gross_sale_amount" type="number" min="0" step="1" defaultValue="0" /></label>
            <label>Descuento<input name="discount_amount" type="number" min="0" step="1" defaultValue="0" /></label>
            <label>Cita que originó la venta<select name="source_appointment_id" defaultValue=""><option value="">Sin vincular</option>{appointments.filter((item) => item.appointment_type?.category === 'sale' && !item.order_id).map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)} · {item.client?.first_name} {item.client?.last_name}</option>)}</select></label>
          </div>
          <label>Descripción del diseño<textarea name="design_description" rows={2} /></label>
          <label>Observaciones internas<textarea name="internal_notes" rows={2} /></label>
          <button className="btn btn-primary" disabled={loading}>{loading ? 'Guardando…' : 'Crear pedido'}</button>
        </form>
      )}

      <div className="split-workspace">
        <div className="panel order-list-panel">
          <label>Buscar pedidos<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, código, producto o estado" /></label>
          <div className="order-list">
            {filtered.map((order) => (
              <button type="button" key={order.id} className={selectedId === order.id ? 'order-list-item active' : 'order-list-item'} onClick={() => setSelectedId(order.id)}>
                <span><strong>{orderCode(order.order_sequence)}</strong><small>{order.client?.first_name} {order.client?.last_name}</small></span>
                <span><strong>{order.product_name}</strong><small>{orderStatusLabels[order.status]}</small></span>
              </button>
            ))}
            {!filtered.length && <p className="empty-state">No hay pedidos para mostrar.</p>}
          </div>
        </div>

        <div className="order-detail">
          {!selected && <div className="panel empty-state">Selecciona un pedido para revisar su ficha.</div>}
          {selected && (
            <>
              <div className="panel">
                <div className="detail-heading"><div><h2>{orderCode(selected.order_sequence)} · {selected.product_name}</h2><p>{selected.client?.first_name} {selected.client?.last_name} · {productionRouteLabels[selected.production_route]}</p></div><span className="badge badge-info">{orderStatusLabels[selected.status]}</span></div>
                <div className="metric-grid four-metrics">
                  <Metric label="Venta final" value={commercialAccess ? formatClp(finalSale) : 'Restringido'} />
                  <Metric label="Pagado" value={commercialAccess ? formatClp(paid) : 'Restringido'} />
                  <Metric label="Costo real" value={costAccess ? formatClp(actualCosts) : 'Restringido'} />
                  <Metric label="Saldo" value={commercialAccess ? formatClp(finalSale - paid) : 'Restringido'} />
                </div>
              </div>

              <form className="panel form-stack" onSubmit={saveOperations}>
                <h3>Planificación y avance</h3>
                <div className="form-grid three-columns">
                  <label>Estado<select name="status" defaultValue={selected.status}>{orderStatuses.map((status) => <option key={status} value={status}>{orderStatusLabels[status]}</option>)}</select></label>
                  <label>Semana planificada<input name="planned_week_start" type="date" defaultValue={selected.planned_week_start ?? ''} /></label>
                  <label>Inicio producción<input name="production_start_date" type="date" defaultValue={selected.production_start_date ?? ''} /></label>
                  <label>Entrega comprometida<input name="promised_delivery_date" type="date" defaultValue={selected.promised_delivery_date ?? ''} /></label>
                  <label>Entrega real<input name="actual_delivery_date" type="date" defaultValue={selected.actual_delivery_date ?? ''} /></label>
                  <label>Horas planificadas<input name="planned_hours" type="number" min="0" step="0.25" defaultValue={selected.planned_hours ?? ''} /></label>
                  <label>Horas reales<input name="actual_hours" type="number" min="0" step="0.25" defaultValue={selected.actual_hours ?? ''} /></label>
                  <label className="checkbox-label"><input name="needs_fitting_1" type="checkbox" defaultChecked={selected.needs_fitting_1} /> Requiere prueba 1</label>
                  <label className="checkbox-label"><input name="needs_fitting_2" type="checkbox" defaultChecked={selected.needs_fitting_2} /> Requiere prueba 2</label>
                </div>
                <label>Motivo de desviación<textarea name="variance_reason" rows={2} defaultValue={selected.variance_reason ?? ''} placeholder="Obligatorio si las horas reales difieren" /></label>
                <label>Observaciones internas<textarea name="internal_notes" rows={2} defaultValue={selected.internal_notes ?? ''} /></label>
                <button className="btn btn-primary" disabled={loading}>Guardar avance</button>
              </form>

              {commercialAccess && selected.financials && (
                <form className="panel form-stack" onSubmit={saveFinancials}>
                  <h3>Ficha comercial y tasas históricas</h3>
                  <div className="form-grid three-columns">
                    <label>Venta bruta<input name="gross_sale_amount" type="number" min="0" defaultValue={selected.financials.gross_sale_amount} /></label>
                    <label>Descuento<input name="discount_amount" type="number" min="0" defaultValue={selected.financials.discount_amount} /></label>
                    <label>IVA (%)<input name="tax_rate_snapshot" type="number" min="0" max="100" step="0.01" defaultValue={selected.financials.tax_rate_snapshot} /></label>
                    <label>Comisión venta (%)<input name="sales_commission_rate_snapshot" type="number" min="0" max="100" step="0.01" defaultValue={selected.financials.sales_commission_rate_snapshot} /></label>
                    <label>Comisión Transbank (%)<input name="card_fee_rate_snapshot" type="number" min="0" max="100" step="0.01" defaultValue={selected.financials.card_fee_rate_snapshot} /></label>
                    <label>Costo hora taller<input name="workshop_hourly_cost_snapshot" type="number" min="0" defaultValue={selected.financials.workshop_hourly_cost_snapshot} /></label>
                  </div>
                  <small>Estas tasas son la fotografía del pedido. Cambiar los valores generales no altera pedidos anteriores.</small>
                  <button className="btn btn-primary" disabled={loading}>Guardar ficha comercial</button>
                </form>
              )}

              {costAccess && (
                <div className="panel form-stack">
                  <div className="detail-heading"><div><h3>Costos de producción</h3><p>Estimado {formatClp(estimatedCosts)} · Real {formatClp(actualCosts)}</p></div></div>
                  <form className="inline-cost-form" onSubmit={addCost}>
                    <select name="phase" required defaultValue="estimated"><option value="estimated">Estimado</option><option value="actual">Real</option></select>
                    <select name="category" required defaultValue="fabric">{Object.entries(costCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                    <input name="description" required placeholder="Descripción" />
                    <input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" aria-label="Cantidad" />
                    <input name="unit" defaultValue="unidad" aria-label="Unidad" />
                    <input name="unit_cost" type="number" min="0" step="1" defaultValue="0" aria-label="Costo unitario" />
                    <button className="btn btn-secondary" type="submit">Agregar</button>
                  </form>
                  <div className="table-card"><table><thead><tr><th>Fase</th><th>Categoría</th><th>Descripción</th><th>Cantidad</th><th>Total</th><th></th></tr></thead><tbody>{selected.cost_items?.map((item) => <tr key={item.id}><td>{item.phase === 'estimated' ? 'Estimado' : 'Real'}</td><td>{costCategoryLabels[item.category]}</td><td>{item.description}</td><td>{item.quantity} {item.unit}</td><td>{formatClp(item.total_cost)}</td><td><button className="btn btn-danger btn-sm" type="button" onClick={() => void removeCost(item.id)}>Eliminar</button></td></tr>)}{!selected.cost_items?.length && <tr><td colSpan={6}>Sin costos registrados.</td></tr>}</tbody></table></div>
                </div>
              )}

              <div className="panel form-stack">
                <h3>Citas vinculadas</h3>
                {linkableAppointments.length > 0 && <label>Agregar cita<select defaultValue="" onChange={(event) => { void linkAppointment(event.target.value); event.target.value = '' }}><option value="">Seleccionar…</option>{linkableAppointments.map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)} · {item.appointment_type?.name}</option>)}</select></label>}
                <ul className="simple-list">{linkedAppointments.map((item) => <li key={item.id}><strong>{item.appointment_type?.name}</strong><span>{formatDate(item.appointment_date)} · {item.start_time.slice(0, 5)}</span></li>)}{!linkedAppointments.length && <li>Sin citas vinculadas.</li>}</ul>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function nullableNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text === '' ? null : Number(text)
}

function sumCosts(order: Order | null, phase: CostPhase) {
  return order?.cost_items?.filter((item) => item.phase === phase).reduce((sum, item) => sum + Number(item.total_cost), 0) ?? 0
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card compact"><span>{label}</span><strong>{value}</strong></div>
}
