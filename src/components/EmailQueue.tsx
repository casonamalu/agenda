import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { EmailQueueItem } from '../types'

export function EmailQueue({ refreshToken }: { refreshToken: number }) {
  const [items, setItems] = useState<EmailQueueItem[]>([])
  const [status, setStatus] = useState('')

  useEffect(() => { void loadItems() }, [refreshToken, status])

  async function loadItems() {
    let query = supabase.from('email_queue').select('*').order('created_at', { ascending: false }).limit(200)
    if (status) query = query.eq('status', status)
    const { data } = await query
    setItems((data ?? []) as EmailQueueItem[])
  }

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Correos</h1><p>Control de confirmaciones, recordatorios y errores.</p></div><button className="btn btn-secondary" type="button" onClick={() => void loadItems()}>Actualizar</button></div>
      <div className="filter-grid one-filter"><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="pending">Pendiente</option><option value="sent">Enviado</option><option value="retry">Reintento</option><option value="failed">Fallido</option><option value="cancelled">Cancelado</option></select></label></div>
      <div className="table-card"><table><thead><tr><th>Destinatario</th><th>Tipo</th><th>Programado</th><th>Estado</th><th>Intentos</th><th>Error</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.recipient}</td><td>{item.kind}</td><td>{new Date(item.scheduled_for).toLocaleString('es-CL')}</td><td><span className={`badge badge-${item.status}`}>{item.status}</span></td><td>{item.attempts}</td><td><small>{item.last_error}</small></td></tr>)}</tbody></table></div>
    </section>
  )
}
