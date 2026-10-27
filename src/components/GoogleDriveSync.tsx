import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  refreshToken: number
  onChanged: (message: string) => void
}

interface SyncConfig {
  active: boolean
  spreadsheet_url: string
  sheet_name: string
  last_export_at: string | null
  last_import_at: string | null
  last_error: string | null
}

type SyncAction = 'create' | 'update' | 'cancel' | 'no_show' | 'no_change' | 'error'

interface PreviewItem {
  rowNumber: number
  clientName: string
  appointmentType: string
  appointmentDate: string
  startTime: string
  action: SyncAction
  warning: string | null
  error: string | null
}

interface PreviewResult {
  items: PreviewItem[]
  summary: Record<SyncAction | 'overbook', number>
}

interface StatusResult {
  configured: boolean
  serviceAccountEmail: string | null
  config: SyncConfig
}

const actionLabels: Record<SyncAction, string> = {
  create: 'Crear',
  update: 'Actualizar',
  cancel: 'Cancelar',
  no_show: 'No asistió',
  no_change: 'Sin cambios',
  error: 'Error',
}

export function GoogleDriveSync({ refreshToken, onChanged }: Props) {
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<'push' | 'preview' | 'apply' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => { void loadStatus() }, [refreshToken])

  async function invoke<T>(action: 'status' | 'push' | 'preview' | 'apply') {
    const { data, error: invokeError } = await supabase.functions.invoke('google-drive-sync', { body: { action } })
    if (invokeError) {
      const context = invokeError.context as Response | undefined
      if (context) {
        const payload = await context.clone().json().catch(() => null) as { error?: string } | null
        if (payload?.error) throw new Error(payload.error)
      }
      throw invokeError
    }
    if (data?.error) throw new Error(data.error)
    return data as T
  }

  async function loadStatus() {
    setLoading(true)
    try {
      setStatus(await invoke<StatusResult>('status'))
      setError('')
    } catch (loadError) {
      setError(messageOf(loadError))
    } finally {
      setLoading(false)
    }
  }

  async function updateExcel() {
    setWorking('push')
    setError('')
    setNotice('')
    setPreview(null)
    try {
      const result = await invoke<{ exported: number }>('push')
      setNotice(`Planilla actualizada con ${result.exported} cita${result.exported === 1 ? '' : 's'}.`)
      onChanged('Google Drive actualizado.')
      await loadStatus()
    } catch (pushError) {
      setError(messageOf(pushError))
    } finally {
      setWorking(null)
    }
  }

  async function loadPreview() {
    setWorking('preview')
    setError('')
    setNotice('')
    try {
      setPreview(await invoke<PreviewResult>('preview'))
    } catch (previewError) {
      setError(messageOf(previewError))
    } finally {
      setWorking(null)
    }
  }

  async function applyChanges() {
    if (!preview || preview.summary.error > 0) {
      setError('Corrige las filas con error antes de cargar los cambios.')
      return
    }
    const changes = preview.summary.create + preview.summary.update + preview.summary.cancel + preview.summary.no_show
    if (!changes) {
      setNotice('No existen cambios para cargar.')
      return
    }
    if (!window.confirm(`Se cargarán ${changes} cambio${changes === 1 ? '' : 's'} y se enviarán los correos normales de agendamiento o reprogramación. ¿Continuar?`)) return

    setWorking('apply')
    setError('')
    setNotice('')
    try {
      const result = await invoke<{ created: number; updated: number; skipped: number; errors: Array<{ rowNumber: number; error: string }> }>('apply')
      if (result.errors.length) {
        setError(`La carga terminó con ${result.errors.length} fila(s) con error: ${result.errors.map((item) => `fila ${item.rowNumber}: ${item.error}`).join(' · ')}`)
      } else {
        setNotice(`Carga completada: ${result.created} creada${result.created === 1 ? '' : 's'} y ${result.updated} actualizada${result.updated === 1 ? '' : 's'}. Los correos quedaron en la cola normal del sistema.`)
        onChanged('Cambios de Google Drive cargados.')
      }
      setPreview(null)
      await loadStatus()
    } catch (applyError) {
      setError(messageOf(applyError))
    } finally {
      setWorking(null)
    }
  }

  if (loading && !status) return <div className="settings-card drive-sync-card"><div className="loading-state">Revisando conexión con Google Drive…</div></div>

  return (
    <section className="settings-card drive-sync-card">
      <div className="detail-heading">
        <div>
          <div className="drive-title-row">
            <h2>Agenda en Google Drive</h2>
            <span className={`badge ${status?.configured ? 'badge-success' : 'badge-muted'}`}>{status?.configured ? 'Conectado' : 'Configuración pendiente'}</span>
          </div>
          <p>Sincroniza la pestaña <strong>{status?.config.sheet_name ?? 'REGISTRO'}</strong>. Antes de cargar desde Excel siempre verás una vista previa.</p>
        </div>
        {status?.config.spreadsheet_url && <a className="btn btn-secondary btn-sm" href={status.config.spreadsheet_url} target="_blank" rel="noreferrer">Abrir planilla</a>}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="drive-sync-meta">
        <div><span>Actualización automática</span><strong>{status?.config.active ? 'Cada 1 hora' : 'Pendiente de activar'}</strong></div>
        <div><span>Última salida a Excel</span><strong>{formatTimestamp(status?.config.last_export_at)}</strong></div>
        <div><span>Última carga al sistema</span><strong>{formatTimestamp(status?.config.last_import_at)}</strong></div>
      </div>

      {!status?.configured && <p className="form-help">La función ya está preparada. Falta instalar la credencial privada de Google y compartir la planilla con la cuenta técnica indicada.</p>}
      {status?.config.last_error && <div className="drive-last-error">Último error: {status.config.last_error}</div>}

      <div className="drive-sync-actions">
        <button className="btn btn-primary" type="button" disabled={!status?.configured || Boolean(working)} onClick={() => void updateExcel()}>
          {working === 'push' ? 'Actualizando…' : 'Actualizar Excel'}
        </button>
        <button className="btn btn-secondary" type="button" disabled={!status?.configured || Boolean(working)} onClick={() => void loadPreview()}>
          {working === 'preview' ? 'Revisando…' : 'Cargar cambios'}
        </button>
        <span>Las cargas aplicadas envían los correos normales del sistema.</span>
      </div>

      {preview && (
        <div className="drive-preview">
          <div className="page-heading">
            <div><h3>Vista previa de cambios</h3><p>Revisa especialmente los sobrecupos y errores antes de confirmar.</p></div>
            <button className="btn btn-primary" type="button" disabled={Boolean(working) || preview.summary.error > 0} onClick={() => void applyChanges()}>
              {working === 'apply' ? 'Cargando…' : 'Confirmar carga y enviar correos'}
            </button>
          </div>
          <div className="drive-summary">
            <span><strong>{preview.summary.create}</strong> nuevas</span>
            <span><strong>{preview.summary.update}</strong> actualizaciones</span>
            <span><strong>{preview.summary.cancel + preview.summary.no_show}</strong> bajas</span>
            <span><strong>{preview.summary.overbook}</strong> sobrecupos</span>
            <span className={preview.summary.error ? 'has-error' : ''}><strong>{preview.summary.error}</strong> errores</span>
          </div>
          <div className="table-card drive-preview-table">
            <table>
              <thead><tr><th>Fila</th><th>Clienta</th><th>Cita</th><th>Fecha y hora</th><th>Acción</th><th>Detalle</th></tr></thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.rowNumber}>
                    <td>{item.rowNumber}</td><td>{item.clientName}</td><td>{item.appointmentType}</td>
                    <td>{formatSheetDate(item.appointmentDate)} · {item.startTime}</td>
                    <td><span className={`badge ${item.action === 'error' ? 'badge-danger' : item.action === 'no_change' ? 'badge-muted' : 'badge-success'}`}>{actionLabels[item.action]}</span></td>
                    <td className={item.error ? 'text-danger' : ''}>{item.error ?? item.warning ?? '—'}</td>
                  </tr>
                ))}
                {!preview.items.length && <tr><td colSpan={6}>No hay filas para revisar.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const item = error as { message?: unknown; error?: unknown }
    if (typeof item.error === 'string') return item.error
    if (typeof item.message === 'string') return item.message
    try { return JSON.stringify(error) } catch { return 'Ocurrió un error inesperado' }
  }
  return String(error)
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'Sin registros'
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatSheetDate(value: string) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}