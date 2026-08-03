import { useEffect, useMemo, useState } from 'react'
import { formatClp, orderCode } from '../lib/operations'
import { supabase } from '../lib/supabase'
import type { CommissionStatus, Order } from '../types'

interface SummaryRow {
  order_id: string
  order_sequence: number
  gross_sale_amount: number
  discount_amount: number
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
  seller_id: string | null
  product_type_id: string | null
  commission_status: CommissionStatus
  commission_base: number
  cash_paid: number
  card_paid: number
  other_paid: number
}

type PaymentFilter = 'all' | 'cash' | 'card'

export function Profitability({ refreshToken }: { refreshToken: number }) {
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [sellerId, setSellerId] = useState('')
  const [productTypeId, setProductTypeId] = useState('')
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [error, setError] = useState('')

  useEffect(() => { void loadData() }, [refreshToken])

  async function loadData() {
    const [summaryResult, ordersResult] = await Promise.all([
      supabase.from('order_financial_summary').select('*'),
      supabase.from('orders').select('*, client:clients(*), seller:profiles!orders_seller_id_fkey(*), product_type:commercial_product_types(*)'),
    ])
    setError(summaryResult.error?.message ?? ordersResult.error?.message ?? '')
    setRows((summaryResult.data ?? []) as SummaryRow[])
    setOrders((ordersResult.data ?? []) as unknown as Order[])
  }

  const ordersById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])
  const sellers = useMemo(() => [...new Map(orders.filter((order) => order.seller).map((order) => [order.seller!.id, order.seller!])).values()], [orders])
  const productTypes = useMemo(() => [...new Map(orders.filter((order) => order.product_type).map((order) => [order.product_type!.id, order.product_type!])).values()], [orders])
  const filtered = useMemo(() => rows.filter((row) => {
    const order = ordersById.get(row.order_id)
    if (month && order?.sale_date?.slice(0, 7) !== month) return false
    if (sellerId && row.seller_id !== sellerId) return false
    if (productTypeId && row.product_type_id !== productTypeId) return false
    if (paymentFilter === 'cash' && Number(row.cash_paid) <= 0) return false
    if (paymentFilter === 'card' && Number(row.card_paid) <= 0) return false
    return true
  }), [month, ordersById, paymentFilter, productTypeId, rows, sellerId])

  const totals = filtered.reduce((result, row) => {
    const cost = Number(row.actual_material_cost) + Number(row.actual_labor_cost) + Number(row.sales_commission) + Number(row.card_fees)
    result.gross += Number(row.gross_sale_amount)
    result.discounts += Number(row.discount_amount)
    result.net += Number(row.net_sales_amount)
    result.tax += Number(row.tax_amount)
    result.costs += cost
    result.cardFees += Number(row.card_fees)
    result.commissions += Number(row.sales_commission)
    result.margin += Number(row.net_sales_amount) - cost
    result.paid += Number(row.paid_amount)
    result.cash += Number(row.cash_paid)
    result.card += Number(row.card_paid)
    return result
  }, { gross: 0, discounts: 0, net: 0, tax: 0, costs: 0, cardFees: 0, commissions: 0, margin: 0, paid: 0, cash: 0, card: 0 })

  const byProduct = groupRows(filtered, (row) => ordersById.get(row.order_id)?.product_type?.name ?? 'Sin tipo')
  const bySeller = groupRows(filtered, (row) => ordersById.get(row.order_id)?.seller?.full_name ?? 'Sin vendedora')

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Rentabilidad y comisiones</h1><p>Indicadores comerciales mensuales con IVA para todas las ventas y Transbank solo para tarjeta.</p></div></div>
      <div className="panel filter-bar">
        <label>Mes de venta<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label>Vendedora<select value={sellerId} onChange={(event) => setSellerId(event.target.value)}><option value="">Todas</option>{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.full_name}</option>)}</select></label>
        <label>Producto<select value={productTypeId} onChange={(event) => setProductTypeId(event.target.value)}><option value="">Todos</option>{productTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
        <label>Medio de pago<select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}><option value="all">Todos</option><option value="cash">Efectivo</option><option value="card">Tarjeta</option></select></label>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="kpi-grid commercial-kpis">
        <Metric label="Pedidos" value={String(filtered.length)} />
        <Metric label="Venta bruta" value={formatClp(totals.gross)} />
        <Metric label="Descuentos" value={formatClp(totals.discounts)} />
        <Metric label="Venta neta sin IVA" value={formatClp(totals.net)} />
        <Metric label="IVA" value={formatClp(totals.tax)} />
        <Metric label="Transbank" value={formatClp(totals.cardFees)} />
        <Metric label="Comisiones vendedoras" value={formatClp(totals.commissions)} />
        <Metric label="Margen estimado" value={formatClp(totals.margin)} />
        <Metric label="Pagado en efectivo" value={formatClp(totals.cash)} />
        <Metric label="Pagado con tarjeta" value={formatClp(totals.card)} />
      </div>
      <div className="two-column-layout">
        <Distribution title="Ventas por tipo de producto" rows={byProduct} />
        <Distribution title="Ventas y comisiones por vendedora" rows={bySeller} showCommission />
      </div>
      <div className="panel">
        <h2>Detalle del período</h2>
        <div className="table-card"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Producto</th><th>Vendedora</th><th>Neto</th><th>IVA</th><th>Transbank</th><th>Comisión</th><th>Estado comisión</th><th>Cobrado</th></tr></thead><tbody>{filtered.map((row) => {
          const order = ordersById.get(row.order_id)
          return <tr key={row.order_id}><td>{orderCode(row.order_sequence)}</td><td>{order?.client?.first_name} {order?.client?.last_name}</td><td>{order?.product_type?.name ?? '—'}</td><td>{order?.seller?.full_name ?? '—'}</td><td>{formatClp(row.net_sales_amount)}</td><td>{formatClp(row.tax_amount)}</td><td>{formatClp(row.card_fees)}</td><td>{formatClp(row.sales_commission)}</td><td>{commissionLabel(row.commission_status)}</td><td>{formatClp(row.paid_amount)}</td></tr>
        })}{!filtered.length && <tr><td colSpan={10}>Aún no hay pedidos con ficha financiera para estos filtros.</td></tr>}</tbody></table></div>
      </div>
    </section>
  )
}

function groupRows(rows: SummaryRow[], label: (row: SummaryRow) => string) {
  const grouped = new Map<string, { label: string; count: number; sales: number; commission: number }>()
  rows.forEach((row) => {
    const key = label(row)
    const current = grouped.get(key) ?? { label: key, count: 0, sales: 0, commission: 0 }
    current.count += 1
    current.sales += Number(row.final_sale_amount)
    current.commission += Number(row.sales_commission)
    grouped.set(key, current)
  })
  return [...grouped.values()].sort((a, b) => b.sales - a.sales)
}

function Distribution({ title, rows, showCommission = false }: { title: string; rows: ReturnType<typeof groupRows>; showCommission?: boolean }) {
  return <article className="panel"><h2>{title}</h2><div className="table-card"><table><thead><tr><th>Grupo</th><th>Pedidos</th><th>Ventas</th>{showCommission && <th>Comisión</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.count}</td><td>{formatClp(row.sales)}</td>{showCommission && <td>{formatClp(row.commission)}</td>}</tr>)}{!rows.length && <tr><td colSpan={showCommission ? 4 : 3}>Sin datos.</td></tr>}</tbody></table></div></article>
}

function commissionLabel(status: CommissionStatus) {
  return status === 'pending' ? 'Pendiente' : status === 'approved' ? 'Aprobada' : 'Pagada'
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>
}
