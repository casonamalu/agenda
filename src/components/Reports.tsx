import { FormEvent, useEffect, useMemo, useState } from 'react'
import { reportDateRange } from '../lib/business'
import { supabase } from '../lib/supabase'
import type { AppointmentStatus, AppointmentType, Profile, ScheduledReport } from '../types'

interface Props {
  profile: Profile
  refreshToken: number
  onChanged: (message: string) => void
}

interface ReportForm {
  name: string
  active: boolean
  weekdays: number[]
  send_time: string
  recipients: string
  period_type: ScheduledReport['period_type']
  appointment_type_ids: string[]
  statuses: AppointmentStatus[]
  send_empty: boolean
}

interface PrintableAppointment {
  appointment_date: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  client: { first_name: string; last_name: string; phone: string } | null
  appointment_type: { name: string } | null
}

const weekdays = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
]

const statuses: Array<{ value: AppointmentStatus; label: string }> = [
  { value: 'scheduled', label: 'Agendada' },
  { value: 'rescheduled', label: 'Reprogramada' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'no_show', label: 'No asistió' },
]

const initialForm: ReportForm = {
  name: '',
  active: true,
  weekdays: [1],
  send_time: '18:00',
  recipients: '',
  period_type: 'tomorrow',
  appointment_type_ids: [],
  statuses: ['scheduled', 'rescheduled'],
  send_empty: false,
}

export function Reports({ profile, refreshToken, onChanged }: Props) {
  const [reports, setReports] = useState<ScheduledReport[]>([])
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([])
  const [form, setForm] = useState<ReportForm>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => { void loadData() }, [refreshToken])

  async function loadData() {
    setLoading(true)
    const [reportsResult, typesResult] = await Promise.all([
      supabase.from('scheduled_reports').select('*').order('name'),
      supabase.from('appointment_types').select('*').eq('active', true).order('sort_order'),
    ])
    if (reportsResult.error) setError(reportsResult.error.message)
    else setReports((reportsResult.data ?? []) as ScheduledReport[])
    if (typesResult.error) setError(typesResult.error.message)
    else setAppointmentTypes((typesResult.data ?? []) as AppointmentType[])
    setLoading(false)
  }

  const appointmentTypeNames = useMemo(
    () => new Map(appointmentTypes.map((type) => [type.id, type.name])),
    [appointmentTypes],
  )

  function toggleWeekday(value: number) {
    setForm((current) => ({
      ...current,
      weekdays: current.weekdays.includes(value)
        ? current.weekdays.filter((day) => day !== value)
        : [...current.weekdays, value].sort(),
    }))
  }

  function toggleType(id: string) {
    setForm((current) => ({
      ...current,
      appointment_type_ids: current.appointment_type_ids.includes(id)
        ? current.appointment_type_ids.filter((typeId) => typeId !== id)
        : [...current.appointment_type_ids, id],
    }))
  }

  function toggleStatus(status: AppointmentStatus) {
    setForm((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((item) => item !== status)
        : [...current.statuses, status],
    }))
  }

  async function saveReport(event: FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')

    const recipients = [...new Set(form.recipients
      .split(/[,;\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean))]

    if (!form.name.trim() || !form.weekdays.length || !form.statuses.length) {
      setError('Completa el nombre y selecciona al menos un día y un estado.')
      return
    }
    if (!recipients.length || recipients.some((email) => !email.includes('@'))) {
      setError('Ingresa uno o más correos válidos, separados por coma.')
      return
    }

    const payload = {
      name: form.name.trim(),
      active: form.active,
      weekdays: form.weekdays,
      send_time: form.send_time,
      recipients,
      period_type: form.period_type,
      appointment_type_ids: form.appointment_type_ids.length ? form.appointment_type_ids : null,
      statuses: form.statuses,
      selected_fields: ['date', 'time', 'appointment_type', 'client_name', 'phone', 'status'],
      send_empty: form.send_empty,
      created_by: profile.id,
    }

    setSaving(true)
    const result = editingId
      ? await supabase.from('scheduled_reports').update(payload).eq('id', editingId)
      : await supabase.from('scheduled_reports').insert(payload)
    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    setForm(initialForm)
    setEditingId(null)
    await loadData()
    setNotice(editingId ? 'El reporte fue actualizado correctamente.' : 'El reporte fue programado correctamente.')
    onChanged(editingId ? 'Reporte actualizado.' : 'Reporte programado.')
  }

  function editReport(report: ScheduledReport) {
    setEditingId(report.id)
    setError('')
    setNotice('')
    setForm({
      name: report.name,
      active: report.active,
      weekdays: report.weekdays,
      send_time: report.send_time.slice(0, 5),
      recipients: report.recipients.join(', '),
      period_type: report.period_type,
      appointment_type_ids: report.appointment_type_ids ?? [],
      statuses: report.statuses ?? ['scheduled', 'rescheduled'],
      send_empty: report.send_empty,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function deleteReport(id: string) {
    if (!window.confirm('¿Eliminar esta programación de reporte?')) return
    setError('')
    const { error: deleteError } = await supabase.from('scheduled_reports').delete().eq('id', id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    await loadData()
    setNotice('La programación fue eliminada.')
    onChanged('Reporte eliminado.')
  }

  async function generatePdf(report: ScheduledReport) {
    const preview = window.open('', '_blank', 'width=1100,height=800')
    if (!preview) {
      setError('El navegador bloqueó la vista previa. Habilita las ventanas emergentes e inténtalo nuevamente.')
      return
    }
    preview.document.write('<p style="font-family:sans-serif;padding:24px">Preparando reporte…</p>')
    setGeneratingId(report.id)
    setError('')
    setNotice('')

    const range = reportDateRange(report.period_type)
    let query = supabase
      .from('appointments')
      .select('appointment_date,start_time,end_time,status,client:clients(first_name,last_name,phone),appointment_type:appointment_types(name)')
      .gte('appointment_date', range.from)
      .lte('appointment_date', range.to)
      .order('appointment_date')
      .order('start_time')

    if (report.appointment_type_ids?.length) query = query.in('appointment_type_id', report.appointment_type_ids)
    if (report.statuses?.length) query = query.in('status', report.statuses)

    const { data, error: reportError } = await query
    setGeneratingId(null)
    if (reportError) {
      preview.close()
      setError(reportError.message)
      return
    }

    const appointments = (data ?? []) as unknown as PrintableAppointment[]
    preview.document.open()
    preview.document.write(reportDocument(report, appointments, range))
    preview.document.close()
    window.setTimeout(() => {
      preview.focus()
      preview.print()
    }, 300)
    setNotice('Vista previa generada. En el diálogo de impresión selecciona “Guardar como PDF”.')
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <div>
          <h1>Reportes programados</h1>
          <p>Envío automático de la agenda según día, horario, período y tipo de cita.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <form className="settings-card report-form" onSubmit={saveReport}>
        <div className="page-heading">
          <div>
            <h2>{editingId ? 'Editar reporte' : 'Nuevo reporte'}</h2>
            <p>Si no seleccionas tipos de cita, el reporte incluirá todos.</p>
          </div>
          {editingId && (
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setEditingId(null); setForm(initialForm) }}>
              Cancelar edición
            </button>
          )}
        </div>

        <div className="form-grid three-columns">
          <label>Nombre del reporte<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Hora de envío<input required type="time" value={form.send_time} onChange={(event) => setForm({ ...form, send_time: event.target.value })} /></label>
          <label>
            Período informado
            <select value={form.period_type} onChange={(event) => setForm({ ...form, period_type: event.target.value as ScheduledReport['period_type'] })}>
              <option value="today">Agenda del mismo día</option>
              <option value="tomorrow">Agenda del día siguiente</option>
              <option value="week">Próximos 7 días</option>
              <option value="fortnight">Próximos 14 días</option>
            </select>
          </label>
          <label className="span-two">Destinatarios<input required placeholder="correo1@dominio.cl, correo2@dominio.cl" value={form.recipients} onChange={(event) => setForm({ ...form, recipients: event.target.value })} /></label>
          <label className="check-row align-end"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Programación activa</label>
        </div>

        <fieldset className="form-section">
          <legend>Días de envío</legend>
          <div className="choice-grid">
            {weekdays.map((day) => (
              <label className="check-row" key={day.value}>
                <input type="checkbox" checked={form.weekdays.includes(day.value)} onChange={() => toggleWeekday(day.value)} />
                {day.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Tipos de cita</legend>
          <div className="choice-grid">
            {appointmentTypes.map((type) => (
              <label className="check-row" key={type.id}>
                <input type="checkbox" checked={form.appointment_type_ids.includes(type.id)} onChange={() => toggleType(type.id)} />
                {type.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Estados incluidos</legend>
          <div className="choice-grid">
            {statuses.map((status) => (
              <label className="check-row" key={status.value}>
                <input type="checkbox" checked={form.statuses.includes(status.value)} onChange={() => toggleStatus(status.value)} />
                {status.label}
              </label>
            ))}
            <label className="check-row">
              <input type="checkbox" checked={form.send_empty} onChange={(event) => setForm({ ...form, send_empty: event.target.checked })} />
              Enviar aunque no existan citas
            </label>
          </div>
        </fieldset>

        <button className="btn btn-primary" disabled={saving} type="submit">
          {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Programar reporte'}
        </button>
      </form>

      {loading ? <div className="loading-state">Cargando reportes…</div> : (
        <div className="table-card">
          <table>
            <thead><tr><th>Reporte</th><th>Envío</th><th>Contenido</th><th>Destinatarios</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td><strong>{report.name}</strong></td>
                  <td>{report.weekdays.map((day) => weekdays.find((item) => item.value === day)?.label.slice(0, 3)).join(', ')} · {report.send_time.slice(0, 5)}</td>
                  <td>
                    {periodLabel(report.period_type)}
                    <br />
                    <small>{report.appointment_type_ids?.length
                      ? report.appointment_type_ids.map((id) => appointmentTypeNames.get(id) ?? 'Tipo eliminado').join(', ')
                      : 'Todos los tipos'}</small>
                  </td>
                  <td>{report.recipients.join(', ')}</td>
                  <td><span className={`badge ${report.active ? 'badge-success' : 'badge-muted'}`}>{report.active ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-primary btn-sm" type="button" disabled={generatingId === report.id} onClick={() => void generatePdf(report)}>{generatingId === report.id ? 'Generando…' : 'Generar PDF'}</button>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => editReport(report)}>Editar</button>
                      <button className="btn btn-danger btn-sm" type="button" onClick={() => void deleteReport(report.id)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!reports.length && <tr><td colSpan={6}>No existen reportes programados.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function periodLabel(period: ScheduledReport['period_type']) {
  if (period === 'today') return 'Mismo día'
  if (period === 'tomorrow') return 'Día siguiente'
  if (period === 'fortnight') return 'Próximos 14 días'
  return 'Próximos 7 días'
}

function reportDocument(
  report: ScheduledReport,
  appointments: PrintableAppointment[],
  range: { from: string; to: string },
) {
  const rows = appointments.map((appointment) => `
    <tr>
      <td>${escapeHtml(formatPdfDate(appointment.appointment_date))}</td>
      <td>${escapeHtml(appointment.start_time.slice(0, 5))}</td>
      <td>${escapeHtml(appointment.appointment_type?.name ?? '—')}</td>
      <td>${escapeHtml(`${appointment.client?.first_name ?? ''} ${appointment.client?.last_name ?? ''}`.trim() || '—')}</td>
      <td>${escapeHtml(appointment.client?.phone ?? '—')}</td>
      <td>${escapeHtml(statusLabel(appointment.status))}</td>
    </tr>
  `).join('')

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(report.name)}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        body { color: #291f23; font-family: Arial, sans-serif; font-size: 11px; }
        h1 { color: #7f3f52; font-size: 22px; margin: 0 0 4px; }
        p { margin: 0 0 14px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border-bottom: 1px solid #ded5d8; padding: 7px 6px; text-align: left; }
        th { background: #f3ecee; color: #5b2737; }
        .empty { padding: 28px; text-align: center; }
        .meta { color: #675b60; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(report.name)}</h1>
      <p class="meta">${escapeHtml(periodLabel(report.period_type))} · ${escapeHtml(formatPdfDate(range.from))} al ${escapeHtml(formatPdfDate(range.to))} · ${appointments.length} cita${appointments.length === 1 ? '' : 's'}</p>
      <table>
        <thead><tr><th>Fecha</th><th>Hora</th><th>Tipo</th><th>Cliente</th><th>Teléfono</th><th>Estado</th></tr></thead>
        <tbody>${rows || '<tr><td class="empty" colspan="6">No existen citas para los filtros seleccionados.</td></tr>'}</tbody>
      </table>
    </body>
  </html>`
}

function formatPdfDate(value: string) {
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}

function statusLabel(status: AppointmentStatus) {
  return statuses.find((item) => item.value === status)?.label ?? status
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] ?? character)
}
