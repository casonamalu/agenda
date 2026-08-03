import { FormEvent, useEffect, useMemo, useState } from 'react'
import { formatDate, toIsoDate } from '../lib/date'
import { costCategoryLabels, formatClp, orderCode, orderStatusLabels, orderStatuses, productionRouteLabels } from '../lib/operations'
import { supabase } from '../lib/supabase'
import type { Appointment, AppointmentType, Client, CommercialProductType, CostCategory, CostPhase, Order, OrderFinancials, Profile, SellerProductCommission } from '../types'
import { OrderWizard } from './OrderWizard'

interface Props {
  profile: Profile
  refreshToken: number
  initialAppointmentId: string | null
  onLaunchHandled: () => void
  onChanged: (message: string, kind?: 'success' | 'error' | 'info') => void
}

const orderSelect = `
  *,
  client:clients(*, client_type:client_types(*)),
  financials:order_financials(*),
  cost_items:order_cost_items(*),
  payments:order_payments(*)
  ,seller:profiles!orders_seller_id_fkey(id,full_name,email,role,active,must_change_password)
  ,product_type:commercial_product_types(*)
`

export function Orders({ profile, refreshToken, initialAppointmentId, onLaunchHandled, onChanged }: Props) {
  const commercialAccess = profile.role === 'admin' || profile.role === 'seller'
  const costAccess = commercialAccess || profile.role === 'workshop'
  const [orders, setOrders] = useState<Order[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([])
  const [sellers, setSellers] = useState<Profile[]>([])
  const [productTypes, setProductTypes] = useState<CommercialProductType[]>([])
  const [commissions, setCommissions] = useState<SellerProductCommission[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [wizardAppointmentId, setWizardAppointmentId] = useState<string | null>(null)
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

  useEffect(() => {
    if (!initialAppointmentId || !appointments.length) return
    const source = appointments.find((item) => item.id === initialAppointmentId)
    if (source?.order_id) {
      setSelectedId(source.order_id)
      setShowNew(false)
      setWizardAppointmentId(null)
    } else if (source) {
      setWizardAppointmentId(source.id)
      setShowNew(true)
      setSelectedId(null)
    } else {
      setError('No fue posible recuperar la cita de venta seleccionada.')
    }
    onLaunchHandled()
  }, [appointments, initialAppointmentId, onLaunchHandled])

  function toggleNewOrder() {
    setError('')
    if (showNew) {
      setShowNew(false)
      setWizardAppointmentId(null)
      return
    }
    setWizardAppointmentId(null)
    setShowNew(true)
    setSelectedId(null)
  }

  async function loadData(selectId?: string) {
    setError('')
    const [ordersResult, clientsResult, appointmentsResult, appointmentTypesResult, sellersResult, productTypesResult, commissionsResult] = await Promise.all([
      supabase.from('orders').select(orderSelect).order('created_at', { ascending: false }),
      supabase.from('clients').select('*, client_type:client_types(*)').eq('active', true).order('last_name'),
      supabase.from('appointments').select('*, appointment_type:appointment_types(*), client:clients(*)').neq('status', 'cancelled').order('appointment_date', { ascending: false }).limit(300),
      supabase.from('appointment_types').select('*').eq('active', true).order('sort_order'),
      supabase.from('profiles').select('*').eq('active', true).in('role', ['admin', 'seller']).order('full_name'),
      supabase.from('commercial_product_types').select('*').eq('active', true).order('display_order'),
      supabase.from('seller_product_commissions').select('*'),
    ])
    if (ordersResult.error) setError(ordersResult.error.message)
    if (clientsResult.error) setError(clientsResult.error.message)
    setOrders((ordersResult.data ?? []) as unknown as Order[])
    setClients((clientsResult.data ?? []) as Client[])
    setAppointments((appointmentsResult.data ?? []) as unknown as Appointment[])
    setAppointmentTypes((appointmentTypesResult.data ?? []) as AppointmentType[])
    setSellers((sellersResult.data ?? []) as Profile[])
    setProductTypes((productTypesResult.data ?? []) as CommercialProductType[])
    setCommissions((commissionsResult.data ?? []) as SellerProductCommission[])
    if (selectId) setSelectedId(selectId)
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
    const { error: updateError } = await supabase.rpc('update_order_operations', {
      p_order_id: selected.id,
      p_status: String(form.get('status')),
      p_production_start_date: String(form.get('production_start_date')) || null,
      p_planned_week_start: String(form.get('planned_week_start')) || null,
      p_promised_delivery_date: String(form.get('promised_delivery_date')) || null,
      p_actual_delivery_date: String(form.get('actual_delivery_date')) || null,
      p_planned_hours: plannedHours,
      p_actual_hours: actualHours,
      p_variance_reason: varianceReason,
      p_needs_fitting_1: form.get('needs_fitting_1') === 'on',
      p_needs_fitting_2: form.get('needs_fitting_2') === 'on',
      p_internal_notes: String(form.get('internal_notes')).trim() || null,
    })
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

  async function changeCommissionStatus(status: 'approved' | 'paid') {
    if (!selected || profile.role !== 'admin') return
    const label = status === 'approved' ? 'aprobar' : 'marcar como pagada'
    if (!window.confirm(`¿Deseas ${label} la comisión de este pedido?`)) return
    const { error: statusError } = await supabase.rpc('set_order_commission_status', { p_order_id: selected.id, p_status: status })
    if (statusError) setError(statusError.message)
    else { await loadData(selected.id); onChanged(status === 'approved' ? 'Comisión aprobada y cálculo congelado.' : 'Comisión marcada como pagada.') }
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
        {commercialAccess && <button className="btn btn-primary" type="button" onClick={toggleNewOrder}>{showNew ? 'Cerrar' : '+ Nuevo pedido'}</button>}
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      {showNew && commercialAccess && (
        <OrderWizard
          profile={profile}
          clients={clients}
          appointments={appointments}
          appointmentTypes={appointmentTypes}
          sellers={sellers}
          productTypes={productTypes}
          commissions={commissions}
          initialAppointmentId={wizardAppointmentId}
          onCancel={() => { setShowNew(false); setWizardAppointmentId(null) }}
          onError={setError}
          onCreated={async (orderId, message) => { setShowNew(false); setWizardAppointmentId(null); await loadData(orderId); onChanged(message) }}
        />
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
                <div className="detail-heading"><div><h2>{orderCode(selected.order_sequence)} · {selected.product_name}</h2><p>{selected.client?.first_name} {selected.client?.last_name} · {selected.product_type?.name ?? 'Sin tipo'} · {productionRouteLabels[selected.production_route]}</p><small>Vendedora: {selected.seller?.full_name ?? 'Sin asignar'}</small></div><span className="badge badge-info">{orderStatusLabels[selected.status]}</span></div>
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
                    <label>Costo hora taller<input name="workshop_hourly_cost_snapshot" type="number" min="0" defaultValue={selected.financials.workshop_hourly_cost_snapshot} /></label>
                  </div>
                  <div className="snapshot-grid"><span>IVA histórico <strong>{selected.financials.tax_rate_snapshot}%</strong></span><span>Transbank histórico <strong>{selected.financials.card_fee_rate_snapshot}%</strong></span><span>Comisión vendedora <strong>{selected.financials.sales_commission_rate_snapshot}%</strong></span><span>Estado <strong>{selected.financials.commission_status === 'pending' ? 'Pendiente' : selected.financials.commission_status === 'approved' ? 'Aprobada' : 'Pagada'}</strong></span></div>
                  <small>Las tasas son la fotografía del pedido y no se pueden editar. IVA se aplica tanto a efectivo como a tarjeta.</small>
                  {profile.role === 'admin' && <div className="action-row">{selected.financials.commission_status === 'pending' && <button className="btn btn-secondary" type="button" onClick={() => void changeCommissionStatus('approved')}>Aprobar comisión</button>}{selected.financials.commission_status === 'approved' && <button className="btn btn-secondary" type="button" onClick={() => void changeCommissionStatus('paid')}>Marcar comisión pagada</button>}</div>}
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
