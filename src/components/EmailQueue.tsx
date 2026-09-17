import { useEffect, useMemo, useState } from 'react'
import { canResendAppointmentEmail, emailQueueSummary, filterEmailQueue } from '../lib/emailQueue'
import { supabase } from '../lib/supabase'
import type { EmailQueueItem } from '../types'

const CHILE_TIMEZONE = 'America/Santiago'

export function EmailQueue({ refreshToken }: { refreshToken: number }) {
  const [items, setItems] = useState<EmailQueueItem[]>([])
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [workingId, setWorkingId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { void loadItems() }, [refreshToken])

  const filteredItems = useMemo(
    () => filterEmailQueue(items, { search, kind, status }),
    [items, search, kind, status],
  )
  const summary = useMemo(() => emailQueueSummary(items), [items])

  async function loadItems() {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase
      .from('email_queue')
      .select('*, appointment:appointments(appointment_date,start_time,end_time,status,client:clients(first_name,last_name))')
      .order('created_at', { ascending: false })
      .limit(300)
    setLoading(false)
    if (loadError) {
      setError(`No fue posible cargar los correos: ${loadError.message}`)
      return
    }
    setItems((data ?? []) as EmailQueueItem[])
  }

  async function resendItem(item: EmailQueueItem) {
    const type = kindLabels[item.kind] ?? item.kind
    if (!window.confirm(`¿Enviar nuevamente “${type}” a ${item.recipient}? Se conservará el envío anterior en el historial.`)) return
    setWorkingId(item.id)
    setError('')
    setMessage('')
    const { error: resendError } = await supabase.rpc('resend_appointment_email', { p_queue_id: item.id })
    setWorkingId('')
    if (resendError) {
      setError(resendError.message)
      return
    }
    setMessage('Reenvío solicitado. El sistema lo procesará durante el próximo minuto y conservará el envío anterior.')
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
    setMessage('Correo pendiente cancelado.')
    await loadItems()
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <h1>Validación de correos</h1>
          <p>Revisa confirmaciones y recordatorios, su hora de envío y solicita un reenvío manual.</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => void loadItems()} disabled={loading}>Actualizar</button>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="alert alert-info">
        <strong>Importante:</strong> “Enviado” confirma que el proveedor aceptó el correo a la hora indicada. El destinatario aún podría encontrarlo en Spam o Promociones.
      </div>

      <div className="metric-grid four-metrics">
        <div className="metric-card compact"><span>Confirmaciones enviadas</span><strong>{summary.confirmationsSent}</strong></div>
        <div className="metric-card compact"><span>Recordatorios enviados</span><strong>{summary.remindersSent}</strong></div>
        <div className="metric-card compact"><span>Pendientes o en proceso</span><strong>{summary.pending}</strong></div>
        <div className={`metric-card compact${summary.problems ? ' metric-danger' : ''}`}><span>Con problemas</span><strong>{summary.problems}</strong></div>
      </div>

      <div className="filter-grid email-filters">
        <label>Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Correo o nombre de clienta" /></label>
        <label>Tipo<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">Todos</option><option value="appointment_created">Confirmación de cita</option><option value="reminder">Recordatorio</option></select></label>
        <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="pending">Pendiente</option><option value="processing">Procesando</option><option value="sent">Enviado</option><option value="retry">Reintento automático</option><option value="failed">Fallido</option><option value="cancelled">Cancelado</option></select></label>
      </div>

      <div className="table-card">
        <table>
          <thead><tr><th>Destinatario</th><th>Correo</th><th>Cita</th><th>Programado</th><th>Estado</th><th>Enviado a las</th><th>Intentos</th><th>Detalle</th><th>Acciones</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="loading-state">Cargando historial de correos…</td></tr>}
            {!loading && filteredItems.length === 0 && <tr><td colSpan={9} className="empty-state">No hay correos que coincidan con los filtros.</td></tr>}
            {!loading && filteredItems.map((item) => (
              <tr key={item.id}>
                <td><strong>{clientName(item)}</strong><small className="table-secondary email-recipient">{item.recipient}</small></td>
                <td>{kindLabels[item.kind] ?? item.kind}</td>
                <td>{formatAppointment(item)}</td>
                <td>{formatDateTime(item.scheduled_for)}</td>
                <td><span className={`badge badge-${item.status}`}>{statusLabels[item.status]}</span></td>
                <td>{item.sent_at ? <><strong>{formatDateTime(item.sent_at)}</strong><small className="table-secondary">Proveedor aceptó el envío</small></> : '—'}</td>
                <td>{item.attempts}</td>
                <td><small>{item.last_error ?? (item.provider_message_id ? `ID: ${item.provider_message_id}` : '—')}</small></td>
                <td>
                  <div className="table-actions">
                    {canResendAppointmentEmail(item) && <button className="btn btn-warning btn-sm" disabled={workingId === item.id} type="button" onClick={() => void resendItem(item)}>{workingId === item.id ? 'Solicitando…' : 'Enviar nuevamente'}</button>}
                    {(item.status === 'pending' || item.status === 'retry') && <button className="btn btn-danger btn-sm" disabled={workingId === item.id} type="button" onClick={() => void cancelItem(item.id)}>Cancelar</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function clientName(item: EmailQueueItem) {
  const client = item.appointment?.client
  return client ? `${client.first_name} ${client.last_name}`.trim() : 'Sin nombre asociado'
}

function formatAppointment(item: EmailQueueItem) {
  const appointment = item.appointment
  if (!appointment) return '—'
  const date = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: CHILE_TIMEZONE })
    .format(new Date(`${appointment.appointment_date}T12:00:00Z`))
  return `${date} · ${appointment.start_time.slice(0, 5)}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: CHILE_TIMEZONE,
  }).format(new Date(value))
}

const kindLabels: Record<string, string> = {
  appointment_created: 'Confirmación de cita',
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
  retry: 'Reintento automático',
  failed: 'Fallido',
  cancelled: 'Cancelado',
}
