import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { Column } from 'write-excel-file/browser'
import { chileIsoDate, daysBetweenIso, reportDateRange } from '../lib/business'
import {
  buildFollowUpReportRows,
  FOLLOW_UP_APPOINTMENT_TYPES,
  formatShortReportDate,
  type FollowUpReportAppointment,
  type FollowUpReportRow,
} from '../lib/followUpReport'
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
  participants: Array<{ client: { first_name: string; last_name: string; phone: string } | null }>
  appointment_type: { name: string } | null
}

type FollowUpPeriod = 'custom' | 'today' | 'week' | 'fortnight' | 'next_30_days'

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
  const [followUpPeriod, setFollowUpPeriod] = useState<FollowUpPeriod>('custom')
  const [followUpFrom, setFollowUpFrom] = useState(() => chileIsoDate())
  const [followUpTo, setFollowUpTo] = useState(() => addIsoDays(chileIsoDate(), 14))
  const [followUpRows, setFollowUpRows] = useState<FollowUpReportRow[]>([])
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [followUpSearched, setFollowUpSearched] = useState(false)
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

  function changeFollowUpPeriod(period: FollowUpPeriod) {
    setFollowUpPeriod(period)
    if (period === 'custom') return

    const today = chileIsoDate()
    const days = period === 'today' ? 0 : period === 'week' ? 6 : period === 'fortnight' ? 13 : 29
    setFollowUpFrom(today)
    setFollowUpTo(addIsoDays(today, days))
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
      .select('appointment_date,start_time,end_time,status,client:clients(first_name,last_name,phone),participants:appointment_participants(client:clients(first_name,last_name,phone)),appointment_type:appointment_types(name)')
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

  async function generateFollowUpReport(event?: FormEvent) {
    event?.preventDefault()
    setError('')
    setNotice('')

    if (!followUpFrom || !followUpTo || followUpFrom > followUpTo) {
      setError('Selecciona un rango de fechas válido.')
      return
    }
    if (daysBetweenIso(followUpFrom, followUpTo) > 366) {
      setError('El reporte permite consultar como máximo 367 días por vez.')
      return
    }

    const typeIds = appointmentTypes
      .filter((type) => FOLLOW_UP_APPOINTMENT_TYPES.includes(type.name as typeof FOLLOW_UP_APPOINTMENT_TYPES[number]))
      .map((type) => type.id)
    if (!typeIds.length) {
      setError('No se encontraron los tipos Prueba 1, Prueba 2 o Entrega.')
      return
    }

    setFollowUpLoading(true)
    const { data, error: reportError } = await supabase
      .from('appointments')
      .select('appointment_date,event_date,client:clients(first_name,last_name,phone),participants:appointment_participants(client:clients(first_name,last_name,phone)),appointment_type:appointment_types(name)')
      .in('appointment_type_id', typeIds)
      .in('status', ['scheduled', 'rescheduled'])
      .gte('appointment_date', followUpFrom)
      .lte('appointment_date', followUpTo)
      .order('appointment_date')
      .order('start_time')
    setFollowUpLoading(false)
    setFollowUpSearched(true)

    if (reportError) {
      setFollowUpRows([])
      setError(reportError.message)
      return
    }

    const rows = buildFollowUpReportRows((data ?? []) as unknown as FollowUpReportAppointment[])
    setFollowUpRows(rows)
    setNotice(`Reporte generado con ${rows.length} fila${rows.length === 1 ? '' : 's'}.`)
  }

  async function exportFollowUpXlsx() {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const columns: Column<FollowUpReportRow>[] = [
      { header: 'Clienta', cell: (row) => row.clientName, width: 27 },
      { header: 'Teléfono', cell: (row) => row.phone, width: 18 },
      { header: 'Tipo Cita', cell: (row) => row.appointmentType, width: 18 },
      { header: 'Fecha Cita', cell: (row) => formatShortReportDate(row.appointmentDate), width: 15 },
      { header: 'Entrega interna', cell: (row) => formatShortReportDate(row.internalDeliveryDate), width: 17 },
      { header: 'Fecha evento (sistema)', cell: (row) => formatShortReportDate(row.eventDate), width: 21 },
      { header: 'Observación', cell: (row) => row.observation, width: 34 },
    ]
    await writeXlsxFile(followUpRows, { columns, sheet: 'Pruebas y entregas' })
      .toFile(`reporte-pruebas-entregas-${followUpFrom}-al-${followUpTo}.xlsx`)
    onChanged(`Se exportaron ${followUpRows.length} filas a Excel.`)
  }

  function printFollowUpReport() {
    const preview = window.open('', '_blank', 'width=1100,height=800')
    if (!preview) {
      setError('El navegador bloqueó la vista previa. Habilita las ventanas emergentes e inténtalo nuevamente.')
      return
    }
    preview.document.open()
    preview.document.write(followUpDocument(followUpRows, followUpFrom, followUpTo))
    preview.document.close()
    window.setTimeout(() => {
      preview.focus()
      preview.print()
    }, 300)
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

      <section className="settings-card follow-up-report" aria-labelledby="follow-up-report-title">
        <div className="page-heading">
          <div>
            <h2 id="follow-up-report-title">Reporte de pruebas y entregas</h2>
            <p>Una fila por cita. La entrega interna se calcula dos días antes de la entrega a la clienta.</p>
          </div>
          <div className="action-row">
            <button className="btn btn-secondary" type="button" disabled={!followUpRows.length} onClick={printFollowUpReport}>Generar PDF</button>
            <button className="btn btn-primary" type="button" disabled={!followUpRows.length} onClick={() => void exportFollowUpXlsx()}>Exportar Excel</button>
          </div>
        </div>

        <form className="follow-up-filters" onSubmit={generateFollowUpReport}>
          <label>
            Período
            <select value={followUpPeriod} onChange={(event) => changeFollowUpPeriod(event.target.value as FollowUpPeriod)}>
              <option value="custom">Personalizado</option>
              <option value="today">Hoy</option>
              <option value="week">Próximos 7 días</option>
              <option value="fortnight">Próximos 14 días</option>
              <option value="next_30_days">Próximos 30 días</option>
            </select>
          </label>
          <label>Desde<input required type="date" value={followUpFrom} onChange={(event) => { setFollowUpFrom(event.target.value); setFollowUpPeriod('custom') }} /></label>
          <label>Hasta<input required type="date" value={followUpTo} onChange={(event) => { setFollowUpTo(event.target.value); setFollowUpPeriod('custom') }} /></label>
          <button className="btn btn-primary" type="submit" disabled={followUpLoading || loading}>
            {followUpLoading ? 'Consultando…' : 'Consultar reporte'}
          </button>
        </form>

        {followUpRows.length ? (
          <div className="table-card follow-up-table-card">
            <table className="follow-up-table">
              <thead><tr><th>Clienta</th><th>Teléfono</th><th>Tipo Cita</th><th>Fecha Cita</th><th>Entrega interna</th><th>Fecha evento (sistema)</th><th>Observación</th></tr></thead>
              <tbody>
                {followUpRows.map((row, index) => (
                  <tr key={`${row.clientName}-${row.appointmentDate}-${row.appointmentType}-${index}`}>
                    <td>{row.clientName}</td>
                    <td>{row.phone || '—'}</td>
                    <td className="follow-up-type">{row.appointmentType}</td>
                    <td className="follow-up-date">{formatShortReportDate(row.appointmentDate)}</td>
                    <td>{formatShortReportDate(row.internalDeliveryDate) || '—'}</td>
                    <td>{formatShortReportDate(row.eventDate) || '—'}</td>
                    <td aria-label="Observación en blanco" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : followUpSearched ? (
          <div className="empty-state">No existen pruebas ni entregas en el período seleccionado.</div>
        ) : null}
      </section>

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
              <option value="next_30_days">Próximos 30 días</option>
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
  if (period === 'next_30_days') return 'Próximos 30 días'
  if (period === 'next_31_days') return 'Próximos 31 días'
  return 'Próximos 7 días'
}

function reportDocument(
  report: ScheduledReport,
  appointments: PrintableAppointment[],
  range: { from: string; to: string },
) {
  const rows = appointments.map((appointment) => {
    const clients = [appointment.client, ...(appointment.participants ?? []).map((item) => item.client)].filter(Boolean)
    const names = clients.map((client) => `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim()).join(' + ')
    const phones = clients.map((client) => client?.phone ?? '').filter(Boolean).join(' · ')
    return `
    <tr>
      <td>${escapeHtml(formatPdfDate(appointment.appointment_date))}</td>
      <td>${escapeHtml(appointment.start_time.slice(0, 5))}</td>
      <td>${escapeHtml(appointment.appointment_type?.name ?? '—')}</td>
      <td>${escapeHtml(names || '—')}</td>
      <td>${escapeHtml(phones || '—')}</td>
      <td>${escapeHtml(statusLabel(appointment.status))}</td>
    </tr>
  `}).join('')

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

function followUpDocument(rows: FollowUpReportRow[], from: string, to: string) {
  const body = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.clientName)}</td>
      <td>${escapeHtml(row.phone || '—')}</td>
      <td class="type">${escapeHtml(row.appointmentType)}</td>
      <td class="date">${escapeHtml(formatShortReportDate(row.appointmentDate))}</td>
      <td>${escapeHtml(formatShortReportDate(row.internalDeliveryDate))}</td>
      <td>${escapeHtml(formatShortReportDate(row.eventDate))}</td>
      <td></td>
    </tr>
  `).join('')

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Reporte de pruebas y entregas</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { color: #291f23; font-family: Arial, sans-serif; font-size: 10px; }
        h1 { color: #7f3f52; font-size: 20px; margin: 0 0 4px; }
        p { color: #675b60; margin: 0 0 12px; }
        table { border-collapse: collapse; table-layout: fixed; width: 100%; }
        th, td { border: 1px solid #d9d9d9; padding: 6px 5px; text-align: left; vertical-align: middle; overflow-wrap: anywhere; }
        th { background: #874158; color: #fff; font-size: 10px; text-align: center; }
        td.type { background: #874158; color: #fff; font-weight: 700; text-align: center; }
        td.date { background: #bfe5f5; text-align: center; }
        th:nth-child(1) { width: 18%; }
        th:nth-child(2) { width: 15%; }
        th:nth-child(3) { width: 12%; }
        th:nth-child(4), th:nth-child(5) { width: 13%; }
        th:nth-child(6) { width: 15%; }
        th:nth-child(7) { width: 14%; }
        .empty { padding: 24px; text-align: center; color: #675b60; }
      </style>
    </head>
    <body>
      <h1>Reporte de pruebas y entregas</h1>
      <p>${escapeHtml(formatShortReportDate(from))} al ${escapeHtml(formatShortReportDate(to))} · ${rows.length} fila${rows.length === 1 ? '' : 's'}</p>
      <table>
        <thead><tr><th>Clienta</th><th>Teléfono</th><th>Tipo Cita</th><th>Fecha Cita</th><th>Entrega interna</th><th>Fecha evento (sistema)</th><th>Observación</th></tr></thead>
        <tbody>${body || '<tr><td class="empty" colspan="7">No existen citas para el período seleccionado.</td></tr>'}</tbody>
      </table>
    </body>
  </html>`
}

function addIsoDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
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
