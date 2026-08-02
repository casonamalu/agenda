import { FormEvent, useEffect, useMemo, useState } from 'react'
import { formatClp, orderCode, paymentMethodLabels } from '../lib/operations'
import { supabase } from '../lib/supabase'
import type { CashMovement, Order, OrderPayment, PaymentMethod, Profile } from '../types'

interface Props {
  profile: Profile
  refreshToken: number
  onChanged: (message: string, kind?: 'success' | 'error' | 'info') => void
}

interface PaymentWithOrder extends OrderPayment {
  order?: Pick<Order, 'order_sequence' | 'product_name'> | null
}

export function Cash({ profile, refreshToken, onChanged }: Props) {
  const [orders, setOrders] = useState<Order[]>([])
  const [payments, setPayments] = useState<PaymentWithOrder[]>([])
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { void loadData() }, [refreshToken])

  async function loadData() {
    const [ordersResult, paymentsResult, movementsResult] = await Promise.all([
      supabase.from('orders').select('*, client:clients(*), financials:order_financials(*), payments:order_payments(*)').not('status', 'in', '(cancelled,closed)').order('created_at', { ascending: false }),
      supabase.from('order_payments').select('*, order:orders(order_sequence,product_name)').order('paid_at', { ascending: false }).limit(500),
      supabase.from('cash_movements').select('*, order:orders(order_sequence,product_name)').order('occurred_at', { ascending: false }).limit(500),
    ])
    const firstError = ordersResult.error ?? paymentsResult.error ?? movementsResult.error
    setError(firstError?.message ?? '')
    setOrders((ordersResult.data ?? []) as unknown as Order[])
    setPayments((paymentsResult.data ?? []) as unknown as PaymentWithOrder[])
    setMovements((movementsResult.data ?? []) as unknown as CashMovement[])
  }

  const monthPayments = useMemo(() => payments.filter((item) => item.paid_at.slice(0, 7) === month), [month, payments])
  const monthMovements = useMemo(() => movements.filter((item) => item.occurred_at.slice(0, 7) === month), [month, movements])
  const paymentIncome = monthPayments.reduce((sum, item) => sum + Number(item.amount), 0)
  const manualIncome = monthMovements.filter((item) => item.direction === 'income').reduce((sum, item) => sum + Number(item.amount), 0)
  const expenses = monthMovements.filter((item) => item.direction === 'expense').reduce((sum, item) => sum + Number(item.amount), 0)
  const cardFees = monthPayments
    .filter((item) => item.method === 'debit_card' || item.method === 'credit_card')
    .reduce((sum, item) => sum + Math.abs(Number(item.amount)) * Number(item.card_fee_rate_snapshot) / 100, 0)

  async function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const order = orders.find((item) => item.id === String(form.get('order_id')))
    if (!order) return
    setSaving(true)
    const { error: insertError } = await supabase.from('order_payments').insert({
      order_id: order.id,
      amount: Number(form.get('amount')),
      method: String(form.get('method')) as PaymentMethod,
      paid_at: new Date(String(form.get('paid_at'))).toISOString(),
      reference: String(form.get('reference')).trim() || null,
      document_number: String(form.get('document_number')).trim() || null,
      card_fee_rate_snapshot: Number(order.financials?.card_fee_rate_snapshot ?? 0),
      notes: String(form.get('notes')).trim() || null,
      created_by: profile.id,
    })
    setSaving(false)
    if (insertError) setError(insertError.message)
    else { event.currentTarget.reset(); await loadData(); onChanged('Pago registrado en caja.') }
  }

  async function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    const { error: insertError } = await supabase.from('cash_movements').insert({
      order_id: String(form.get('order_id')) || null,
      direction: String(form.get('direction')),
      category: String(form.get('category')).trim(),
      amount: Number(form.get('amount')),
      method: String(form.get('method')),
      occurred_at: new Date(String(form.get('occurred_at'))).toISOString(),
      description: String(form.get('description')).trim(),
      reference: String(form.get('reference')).trim() || null,
      created_by: profile.id,
    })
    setSaving(false)
    if (insertError) setError(insertError.message)
    else { event.currentTarget.reset(); await loadData(); onChanged('Movimiento de caja registrado.') }
  }

  async function reversePayment(id: string) {
    const reason = window.prompt('Motivo del reverso del pago:')?.trim()
    if (!reason) return
    const { error: reverseError } = await supabase.rpc('reverse_order_payment', { p_payment_id: id, p_reason: reason })
    if (reverseError) setError(reverseError.message)
    else { await loadData(); onChanged('Pago reversado. El movimiento original se conserva para auditoría.') }
  }

  async function reverseMovement(id: string) {
    const reason = window.prompt('Motivo del reverso del movimiento:')?.trim()
    if (!reason) return
    const { error: reverseError } = await supabase.rpc('reverse_cash_movement', { p_movement_id: id, p_reason: reason })
    if (reverseError) setError(reverseError.message)
    else { await loadData(); onChanged('Movimiento reversado. El registro original se conserva.') }
  }

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Caja</h1><p>Pagos asociados a pedidos, ingresos, egresos y saldo del período.</p></div><label>Período<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="metric-grid four-metrics">
        <Metric label="Ingresos" value={formatClp(paymentIncome + manualIncome)} />
        <Metric label="Egresos" value={formatClp(expenses)} />
        <Metric label="Comisiones tarjeta" value={formatClp(cardFees)} />
        <Metric label="Flujo neto" value={formatClp(paymentIncome + manualIncome - expenses - cardFees)} />
      </div>

      <div className="two-column-layout">
        <form className="panel form-stack" onSubmit={addPayment}>
          <h2>Registrar pago de pedido</h2>
          <label>Pedido<select name="order_id" required defaultValue=""><option value="" disabled>Seleccionar…</option>{orders.map((order) => <option key={order.id} value={order.id}>{orderCode(order.order_sequence)} · {order.client?.first_name} {order.client?.last_name}</option>)}</select></label>
          <div className="form-grid two-columns">
            <label>Monto<input name="amount" type="number" min="1" step="1" required /></label>
            <label>Medio de pago<select name="method" defaultValue="transfer">{Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Fecha y hora<input name="paid_at" type="datetime-local" required defaultValue={localDateTime()} /></label>
            <label>N.º documento<input name="document_number" /></label>
            <label>Referencia<input name="reference" /></label>
            <label>Observación<input name="notes" /></label>
          </div>
          <button className="btn btn-primary" disabled={saving}>Registrar pago</button>
        </form>

        <form className="panel form-stack" onSubmit={addMovement}>
          <h2>Otro ingreso o egreso</h2>
          <div className="form-grid two-columns">
            <label>Tipo<select name="direction" defaultValue="expense"><option value="income">Ingreso</option><option value="expense">Egreso</option></select></label>
            <label>Categoría<input name="category" required placeholder="Arriendo, sueldo, insumos…" /></label>
            <label>Monto<input name="amount" type="number" min="1" step="1" required /></label>
            <label>Medio<select name="method" defaultValue="transfer">{Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Fecha y hora<input name="occurred_at" type="datetime-local" required defaultValue={localDateTime()} /></label>
            <label>Pedido relacionado<select name="order_id" defaultValue=""><option value="">No aplica</option>{orders.map((order) => <option key={order.id} value={order.id}>{orderCode(order.order_sequence)}</option>)}</select></label>
          </div>
          <label>Descripción<input name="description" required /></label>
          <label>Referencia<input name="reference" /></label>
          <button className="btn btn-primary" disabled={saving}>Registrar movimiento</button>
        </form>
      </div>

      <div className="panel">
        <h2>Pagos de pedidos</h2>
        <div className="table-card"><table><thead><tr><th>Fecha</th><th>Pedido</th><th>Medio</th><th>Monto</th><th>Estado</th><th></th></tr></thead><tbody>{monthPayments.map((item) => <tr key={item.id}><td>{new Date(item.paid_at).toLocaleString('es-CL')}</td><td>{item.order ? orderCode(item.order.order_sequence) : '—'}</td><td>{paymentMethodLabels[item.method]}</td><td>{formatClp(item.amount)}</td><td>{item.status === 'posted' ? 'Contabilizado' : 'Reverso'}</td><td>{item.status === 'posted' && !payments.some((candidate) => candidate.reversal_of === item.id) && <button className="btn btn-danger btn-sm" type="button" onClick={() => void reversePayment(item.id)}>Reversar</button>}</td></tr>)}{!monthPayments.length && <tr><td colSpan={6}>No hay pagos en el período.</td></tr>}</tbody></table></div>
      </div>

      <div className="panel">
        <h2>Otros movimientos</h2>
        <div className="table-card"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th>Monto</th><th></th></tr></thead><tbody>{monthMovements.map((item) => <tr key={item.id}><td>{new Date(item.occurred_at).toLocaleString('es-CL')}</td><td>{item.direction === 'income' ? 'Ingreso' : 'Egreso'}</td><td>{item.category}</td><td>{item.description}</td><td>{formatClp(item.direction === 'income' ? item.amount : -item.amount)}</td><td>{item.status === 'posted' && !movements.some((candidate) => candidate.reversal_of === item.id) && <button className="btn btn-danger btn-sm" type="button" onClick={() => void reverseMovement(item.id)}>Reversar</button>}</td></tr>)}{!monthMovements.length && <tr><td colSpan={6}>No hay movimientos adicionales.</td></tr>}</tbody></table></div>
      </div>
    </section>
  )
}

function localDateTime() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>
}
