import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { EmailQueueItem } from '../types'

export function EmailQueue({ refreshToken }: { refreshToken: number }) {
  const [items, setItems] = useState<EmailQueueItem[]>([])
  const [status, setStatus] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [workingId, setWorkingId] = useState('')

  useEffect(() => { void loadItems() }, [refreshToken, status])

  async function loadItems() {
    let query = supabase.from('email_queue').select('*').order('created_at', { ascending: false }).limit(200)
    if (status) query = query.eq('status', status)
    const { data } = await query
    setItems((data ?? []) as EmailQueueItem[])
  }

  async function retryItem(id: string) {
    setWorkingId(id)
    setError('')
    setMessage('')
    const { error: retryError } = await supabase.rpc('retry_email_queue_item', { p_queue_id: id })
    setWorkingId('')
    if (retryError) {
      setError(retryError.message)
      return
    }
    setMessage('El correo quedó disponible para un nuevo ciclo de envío.')
    await loadItems()
  }

  async function cancelItem(id: string) {
    if (!window.confirm('¿Cancelar este correo pendiente?')) return
    setWorkingId(id)
    setError('')
    setMessage('')
    const { error: cancelError } = await supabase.rpc('cancel_email_queue_item', { p_queue_id: id })
    setWorkingId('')
    if (cancelError) {
      setError(cancelError.message)
      return
    }
    setMessage('Correo cancelado.')
    await loadItems()
  }

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Correos</h1><p>Control de confirmaciones, recordatorios y errores.</p></div><button className="btn btn-secondary" type="button" onClick={() => void loadItems()}>Actualizar</button></div>
      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="filter-grid one-filter"><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="pending">Pendiente</option><option value="sent">Enviado</option><option value="retry">Reintento</option><option value="failed">Fallido</option><option value="cancelled">Cancelado</option></select></label></div>
      <div className="table-card"><table><thead><tr><th>Destinatario</th><th>Tipo</th><th>Programado</th><th>Estado</th><th>Intentos</th><th>Error</th><th>Acciones</th></tr></thead><tbody>{items.map((item) => (
        <tr key={item.id}>
          <td>{item.recipient}</td>
          <td>{kindLabels[item.kind] ?? item.kind}</td>
          <td>{new Date(item.scheduled_for).toLocaleString('es-CL')}</td>
          <td><span className={`badge badge-${item.status}`}>{statusLabels[item.status]}</span></td>
          <td>{item.attempts}</td>
          <td><small>{item.last_error}</small></td>
          <td>
            <div className="table-actions">
              {(item.status === 'failed' || item.status === 'retry') && <button className="btn btn-warning btn-sm" disabled={workingId === item.id} type="button" onClick={() => void retryItem(item.id)}>Reintentar</button>}
              {(item.status === 'pending' || item.status === 'retry') && <button className="btn btn-danger btn-sm" disabled={workingId === item.id} type="button" onClick={() => void cancelItem(item.id)}>Cancelar</button>}
            </div>
          </td>
        </tr>
      ))}</tbody></table></div>
    </section>
  )
}

const kindLabels: Record<string, string> = {
  appointment_created: 'Cita agendada',
  reminder: 'Recordatorio',
  rescheduled: 'Reprogramación',
  cancelled: 'Cancelación',
  no_show: 'Inasistencia',
  report: 'Reporte',
  alert: 'Alerta',
}

const statusLabels: Record<EmailQueueItem['status'], string> = {
  pending: 'Pendiente',
  processing: 'Procesando',
  sent: 'Enviado',
  retry: 'Reintento',
  failed: 'Fallido',
  cancelled: 'Cancelado',
}
