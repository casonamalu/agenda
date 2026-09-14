import { FormEvent, useEffect, useMemo, useState } from 'react'
import { orderPaymentTotal as paymentTotal, orderSaleTotal as saleTotal } from '../lib/business'
import { formatClp, operationalPaymentMethods, orderCode, paymentMethodLabels } from '../lib/operations'
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
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { void loadData() }, [refreshToken])

  useEffect(() => {
    if (!selectedOrderId && orders.length) setSelectedOrderId(orders[0].id)
  }, [orders, selectedOrderId])

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

  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? null
  const selectedSale = saleTotal(selectedOrder)
  const selectedPaid = paymentTotal(selectedOrder)
  const selectedBalance = Math.max(0, selectedSale - selectedPaid)

  const monthPayments = useMemo(() => payments.filter((item) => item.paid_at.slice(0, 7) === month), [month, payments])
  const monthMovements = useMemo(() => movements.filter((item) => item.occurred_at.slice(0, 7) === month), [month, movements])
  const paymentIncome = monthPayments.reduce((sum, item) => sum + Number(item.amount), 0)
  const manualIncome = monthMovements.filter((item) => item.direction === 'income').reduce((sum, item) => sum + Number(item.amount), 0)
  const expenses = monthMovements.filter((item) => item.direction === 'expense').reduce((sum, item) => sum + Number(item.amount), 0)
  const cardFees = monthPayments
    .filter((item) => item.method === 'debit_card' || item.method === 'credit_card')
    .reduce((sum, item) => sum + Number(item.amount) * Number(item.card_fee_rate_snapshot) / 100, 0)

  async function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!selectedOrder) {
      setError('Selecciona una venta.')
      return
    }

    const amount = Number(form.get('amount'))
    if (amount <= 0 || amount > selectedBalance) {
      setError(`El monto debe ser mayor que cero y no superar el saldo de ${formatClp(selectedBalance)}.`)
      return
    }

    setSaving(true)
    setError('')
    const { error: insertError } = await supabase.rpc('record_order_payment', {
      p_order_id: selectedOrder.id,
      p_amount: amount,
      p_method: String(form.get('method')) as PaymentMethod,
      p_paid_at: new Date(String(form.get('paid_at'))).toISOString(),
      p_reference: String(form.get('reference')).trim() || null,
      p_document_number: null,
      p_notes: null,
    })
    setSaving(false)

    if (insertError) setError(insertError.message)
    else {
      event.currentTarget.reset()
      await loadData()
      onChanged('Pago registrado. El saldo de la venta fue actualizado.')
    }
  }

  async function addMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (profile.role !== 'admin') return
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError('')
    const { error: insertError } = await supabase.rpc('record_cash_movement', {
      p_order_id: String(form.get('order_id')) || null,
      p_direction: String(form.get('direction')),
      p_category: String(form.get('category')).trim(),
      p_amount: Number(form.get('amount')),
      p_method: String(form.get('method')),
      p_occurred_at: new Date(String(form.get('occurred_at'))).toISOString(),
      p_description: String(form.get('description')).trim(),
      p_reference: String(form.get('reference')).trim() || null,
    })
    setSaving(false)
    if (insertError) setError(insertError.message)
    else {
      event.currentTarget.reset()
      await loadData()
      onChanged('Movimiento de caja registrado.')
    }
  }

  async function reversePayment(id: string) {
    if (profile.role !== 'admin') return
    const reason = window.prompt('Motivo del reverso del pago:')?.trim()
    if (!reason) return
    const { error: reverseError } = await supabase.rpc('reverse_order_payment', { p_payment_id: id, p_reason: reason })
    if (reverseError) setError(reverseError.message)
    else {
      await loadData()
      onChanged('Pago reversado. El movimiento original se conserva para auditoría.')
    }
  }

  async function reverseMovement(id: string) {
    if (profile.role !== 'admin') return
    const reason = window.prompt('Motivo del reverso del movimiento:')?.trim()
    if (!reason) return
    const { error: reverseError } = await supabase.rpc('reverse_cash_movement', { p_movement_id: id, p_reason: reason })
    if (reverseError) setError(reverseError.message)
    else {
      await loadData()
      onChanged('Movimiento reversado. El registro original se conserva.')
    }
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <div><h1>Caja</h1><p>Registra el pago de una venta y revisa su saldo en una sola pantalla.</p></div>
        <label>Período<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="metric-grid four-metrics">
        <Metric label="Pagos de ventas" value={formatClp(paymentIncome)} />
        <Metric label="Otros ingresos" value={profile.role === 'admin' ? formatClp(manualIncome) : 'Administración'} />
        <Metric label="Egresos" value={profile.role === 'admin' ? formatClp(expenses) : 'Administración'} />
        <Metric label="Flujo neto" value={formatClp(paymentIncome + manualIncome - expenses - cardFees)} />
      </div>

      <form className="panel form-stack" onSubmit={addPayment}>
        <div className="detail-heading">
          <div><h2>Registrar pago</h2><p>Selecciona la venta; el total pagado y el saldo se calculan automáticamente.</p></div>
        </div>
        <label>
          Venta
          <select name="order_id" required value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}>
            <option value="" disabled>Seleccionar…</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {orderCode(order.order_sequence)} · {order.client?.first_name} {order.client?.last_name} · saldo {formatClp(Math.max(0, saleTotal(order) - paymentTotal(order)))}
              </option>
            ))}
          </select>
        </label>

        <div className="metric-grid four-metrics">
          <Metric label="Total venta" value={formatClp(selectedSale)} />
          <Metric label="Pagado" value={formatClp(selectedPaid)} />
          <Metric label="Saldo" value={formatClp(selectedBalance)} />
          <Metric label="Producto" value={selectedOrder?.product_name ?? '—'} />
        </div>

        <div className="form-grid two-columns">
          <label>Monto<input name="amount" type="number" min="1" max={selectedBalance || undefined} step="1" required disabled={!selectedOrder || selectedBalance === 0} /></label>
          <label>Medio de pago<select name="method" defaultValue="cash">{operationalPaymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
          <label>Fecha y hora<input name="paid_at" type="datetime-local" required defaultValue={localDateTime()} /></label>
          <label>Referencia (opcional)<input name="reference" placeholder="Transferencia, comprobante u observación breve" /></label>
        </div>
        <button className="btn btn-primary" disabled={saving || !selectedOrder || selectedBalance === 0}>
          {saving ? 'Registrando…' : selectedBalance === 0 && selectedOrder ? 'Venta pagada' : 'Registrar pago'}
        </button>
      </form>

      <div className="panel">
        <h2>Pagos del período</h2>
        <div className="table-card">
          <table>
            <thead><tr><th>Fecha</th><th>Venta</th><th>Medio</th><th>Monto</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {monthPayments.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.paid_at).toLocaleString('es-CL')}</td>
                  <td>{item.order ? orderCode(item.order.order_sequence) : '—'}</td>
                  <td>{paymentMethodLabels[item.method]}</td>
                  <td>{formatClp(item.amount)}</td>
                  <td>{item.status === 'posted' ? 'Contabilizado' : 'Reverso'}</td>
                  <td>{profile.role === 'admin' && item.status === 'posted' && !payments.some((candidate) => candidate.reversal_of === item.id) && <button className="btn btn-danger btn-sm" type="button" onClick={() => void reversePayment(item.id)}>Reversar</button>}</td>
                </tr>
              ))}
              {!monthPayments.length && <tr><td colSpan={6}>No hay pagos en el período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {profile.role === 'admin' && (
        <details className="panel">
          <summary><strong>Otros ingresos o egresos (administración)</strong></summary>
          <form className="form-stack" onSubmit={addMovement}>
            <div className="form-grid two-columns">
              <label>Tipo<select name="direction" defaultValue="expense"><option value="income">Ingreso</option><option value="expense">Egreso</option></select></label>
              <label>Categoría<input name="category" required placeholder="Arriendo, sueldo, insumos…" /></label>
              <label>Monto<input name="amount" type="number" min="1" step="1" required /></label>
              <label>Medio<select name="method" defaultValue="cash">{operationalPaymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
              <label>Fecha y hora<input name="occurred_at" type="datetime-local" required defaultValue={localDateTime()} /></label>
              <label>Venta relacionada<select name="order_id" defaultValue=""><option value="">No aplica</option>{orders.map((order) => <option key={order.id} value={order.id}>{orderCode(order.order_sequence)}</option>)}</select></label>
            </div>
            <label>Descripción<input name="description" required /></label>
            <label>Referencia (opcional)<input name="reference" /></label>
            <button className="btn btn-primary" disabled={saving}>Registrar movimiento</button>
          </form>

          <div className="table-card">
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th>Monto</th><th /></tr></thead>
              <tbody>
                {monthMovements.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.occurred_at).toLocaleString('es-CL')}</td>
                    <td>{item.direction === 'income' ? 'Ingreso' : 'Egreso'}</td>
                    <td>{item.category}</td>
                    <td>{item.description}</td>
                    <td>{formatClp(item.direction === 'income' ? item.amount : -item.amount)}</td>
                    <td>{item.status === 'posted' && !movements.some((candidate) => candidate.reversal_of === item.id) && <button className="btn btn-danger btn-sm" type="button" onClick={() => void reverseMovement(item.id)}>Reversar</button>}</td>
                  </tr>
                ))}
                {!monthMovements.length && <tr><td colSpan={6}>No hay movimientos adicionales.</td></tr>}
              </tbody>
            </table>
          </div>
        </details>
      )}
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
