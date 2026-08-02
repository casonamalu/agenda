import { useEffect, useMemo, useState } from 'react'
import { formatClp, orderCode } from '../lib/operations'
import { supabase } from '../lib/supabase'
import type { Order } from '../types'

interface SummaryRow {
  order_id: string
  order_sequence: number
  final_sale_amount: number
  net_sales_amount: number
  tax_amount: number
  estimated_material_cost: number
  actual_material_cost: number
  estimated_labor_cost: number
  actual_labor_cost: number
  sales_commission: number
  card_fees: number
  paid_amount: number
}

export function Profitability({ refreshToken }: { refreshToken: number }) {
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [error, setError] = useState('')

  useEffect(() => { void loadData() }, [refreshToken])

  async function loadData() {
    const [summaryResult, ordersResult] = await Promise.all([
      supabase.from('order_financial_summary').select('*'),
      supabase.from('orders').select('*, client:clients(*)'),
    ])
    setError(summaryResult.error?.message ?? ordersResult.error?.message ?? '')
    setRows((summaryResult.data ?? []) as SummaryRow[])
    setOrders((ordersResult.data ?? []) as unknown as Order[])
  }

  const ordersById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])
  const filtered = useMemo(() => rows.filter((row) => {
    const order = ordersById.get(row.order_id)
    return !month || order?.sale_date?.slice(0, 7) === month
  }), [month, ordersById, rows])

  const totals = filtered.reduce((result, row) => {
    const cost = Number(row.actual_material_cost) + Number(row.actual_labor_cost) + Number(row.sales_commission) + Number(row.card_fees)
    result.sales += Number(row.net_sales_amount)
    result.costs += cost
    result.margin += Number(row.net_sales_amount) - cost
    result.paid += Number(row.paid_amount)
    return result
  }, { sales: 0, costs: 0, margin: 0, paid: 0 })

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Rentabilidad</h1><p>Venta, costo real, margen y cobranza por pedido.</p></div><label>Mes de venta<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="metric-grid four-metrics">
        <Metric label="Ventas netas (sin IVA)" value={formatClp(totals.sales)} />
        <Metric label="Costos reales" value={formatClp(totals.costs)} />
        <Metric label="Margen" value={formatClp(totals.margin)} />
        <Metric label="Cobrado" value={formatClp(totals.paid)} />
      </div>
      <div className="panel">
        <div className="table-card"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Venta neta</th><th>IVA</th><th>Materiales</th><th>Mano de obra</th><th>Comisiones</th><th>Margen</th><th>Cobrado</th></tr></thead><tbody>{filtered.map((row) => {
          const order = ordersById.get(row.order_id)
          const totalCost = Number(row.actual_material_cost) + Number(row.actual_labor_cost) + Number(row.sales_commission) + Number(row.card_fees)
          return <tr key={row.order_id}><td>{orderCode(row.order_sequence)}</td><td>{order?.client?.first_name} {order?.client?.last_name}</td><td>{formatClp(row.net_sales_amount)}</td><td>{formatClp(row.tax_amount)}</td><td>{formatClp(row.actual_material_cost)}</td><td>{formatClp(row.actual_labor_cost)}</td><td>{formatClp(Number(row.sales_commission) + Number(row.card_fees))}</td><td>{formatClp(Number(row.net_sales_amount) - totalCost)}</td><td>{formatClp(row.paid_amount)}</td></tr>
        })}{!filtered.length && <tr><td colSpan={9}>Aún no hay pedidos con ficha financiera en el período.</td></tr>}</tbody></table></div>
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>
}
