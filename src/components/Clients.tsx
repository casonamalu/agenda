import { FormEvent, useEffect, useMemo, useState } from 'react'
import writeXlsxFile, { type Column } from 'write-excel-file/browser'
import { formatDate } from '../lib/date'
import { supabase } from '../lib/supabase'
import type { Client, ClientType, Profile } from '../types'

interface Props {
  profile: Profile
  refreshToken: number
  onChanged: (message: string) => void
}

export function Clients({ profile, refreshToken, onChanged }: Props) {
  const [clients, setClients] = useState<Client[]>([])
  const [clientTypes, setClientTypes] = useState<ClientType[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [emailFilter, setEmailFilter] = useState<'all' | 'with' | 'without'>('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [consentFilter, setConsentFilter] = useState<'all' | 'yes' | 'no'>('all')
  const [lastAppointments, setLastAppointments] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Client | null>(null)
  const [mergeSource, setMergeSource] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { void loadClients() }, [refreshToken])

  async function loadClients() {
    setLoading(true)
    const [{ data, error: clientsError }, { data: typesData }, { data: appointmentData }] = await Promise.all([
      supabase.from('clients').select('*, client_type:client_types(*)').order('last_name').order('first_name'),
      supabase.from('client_types').select('*').eq('active', true).order('display_order'),
      supabase.from('appointments').select('client_id,appointment_date').not('status', 'eq', 'cancelled').order('appointment_date', { ascending: false }),
    ])
    if (clientsError) setError(clientsError.message)
    setClients((data ?? []) as Client[])
    setClientTypes((typesData ?? []) as ClientType[])
    const lastByClient: Record<string, string> = {}
    for (const item of appointmentData ?? []) {
      if (!lastByClient[item.client_id]) lastByClient[item.client_id] = item.appointment_date
    }
    setLastAppointments(lastByClient)
    setLoading(false)
  }

  const filtered = useMemo(() => clients.filter((client) => {
    const haystack = `${client.first_name} ${client.last_name} ${client.email} ${client.phone} ${client.instagram ?? ''}`.toLocaleLowerCase('es-CL')
    return haystack.includes(search.toLocaleLowerCase('es-CL').replace(/^@/, ''))
      && (!typeFilter || client.client_type_id === typeFilter)
      && (emailFilter === 'all' || (emailFilter === 'with' ? Boolean(client.email) : !client.email))
      && (activeFilter === 'all' || (activeFilter === 'active' ? client.active : !client.active))
      && (consentFilter === 'all' || (consentFilter === 'yes' ? client.marketing_consent : !client.marketing_consent))
  }), [activeFilter, clients, consentFilter, emailFilter, search, typeFilter])

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const { error: updateError } = await supabase
      .from('clients')
      .update({
        first_name: editing.first_name.trim(),
        last_name: editing.last_name.trim(),
        email: editing.email.trim().toLowerCase(),
        phone: editing.phone.trim(),
        instagram: editing.instagram?.trim().replace(/^@+/, '') || null,
        client_type_id: editing.client_type_id,
        active: editing.active,
        marketing_consent: editing.marketing_consent,
        marketing_consent_at: editing.marketing_consent ? (editing.marketing_consent_at ?? new Date().toISOString()) : null,
        marketing_consent_source: editing.marketing_consent ? (editing.marketing_consent_source?.trim() || 'Registro administrativo') : null,
      })
      .eq('id', editing.id)
    if (updateError) setError(updateError.message)
    else {
      setEditing(null)
      await loadClients()
      onChanged('Los datos del cliente fueron corregidos.')
    }
  }

  function exportRows() {
    return filtered.map((client) => ({
      Nombre: client.first_name,
      Apellido: client.last_name,
      Correo: client.email,
      Teléfono: client.phone,
      Instagram: client.instagram ? `@${client.instagram}` : '',
      'Tipo de cliente': client.client_type?.name ?? '',
      Estado: client.active ? 'Activo' : 'Inactivo',
      'Autoriza campañas': client.marketing_consent ? 'Sí' : 'No',
      'Origen autorización': client.marketing_consent_source ?? '',
      'Última cita': lastAppointments[client.id] ? formatDate(lastAppointments[client.id]) : '',
    }))
  }

  async function recordExport(format: 'csv' | 'xlsx', count: number) {
    const { error: logError } = await supabase.rpc('log_client_export', {
      p_format: format,
      p_filters: { search, typeFilter, emailFilter, activeFilter, consentFilter },
      p_exported_count: count,
    })
    if (logError) setError(`El archivo fue generado, pero no se pudo registrar la auditoría: ${logError.message}`)
  }

  function downloadBlob(blob: Blob, filename: string) {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function exportCsv() {
    const rows = exportRows()
    const headers = Object.keys(rows[0] ?? {
      Nombre: '', Apellido: '', Correo: '', Teléfono: '', Instagram: '', 'Tipo de cliente': '', Estado: '', 'Autoriza campañas': '', 'Origen autorización': '', 'Última cita': '',
    })
    const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const csv = [
      headers.map(escapeCsv).join(';'),
      ...rows.map((row) => headers.map((header) => escapeCsv(row[header as keyof typeof row])).join(';')),
    ].join('\r\n')
    downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `clientes-casona-malu-${new Date().toISOString().slice(0, 10)}.csv`)
    await recordExport('csv', rows.length)
    onChanged(`Se exportaron ${rows.length} clientes a CSV.`)
  }

  async function exportXlsx() {
    const rows = exportRows()
    type Row = (typeof rows)[number]
    const columns: Column<Row>[] = [
      { header: 'Nombre', cell: (row) => row.Nombre, width: 18 },
      { header: 'Apellido', cell: (row) => row.Apellido, width: 20 },
      { header: 'Correo', cell: (row) => row.Correo, width: 30 },
      { header: 'Teléfono', cell: (row) => row.Teléfono, width: 18 },
      { header: 'Instagram', cell: (row) => row.Instagram, width: 22 },
      { header: 'Tipo de cliente', cell: (row) => row['Tipo de cliente'], width: 18 },
      { header: 'Estado', cell: (row) => row.Estado, width: 12 },
      { header: 'Autoriza campañas', cell: (row) => row['Autoriza campañas'], width: 18 },
      { header: 'Origen autorización', cell: (row) => row['Origen autorización'], width: 24 },
      { header: 'Última cita', cell: (row) => row['Última cita'], width: 14 },
    ]
    await writeXlsxFile(rows, { columns, sheet: 'Clientes' }).toFile(`clientes-casona-malu-${new Date().toISOString().slice(0, 10)}.xlsx`)
    await recordExport('xlsx', rows.length)
    onChanged(`Se exportaron ${rows.length} clientes a Excel.`)
  }

  async function mergeClients() {
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) {
      setError('Selecciona dos clientes diferentes.')
      return
    }
    if (!window.confirm('Todas las citas pasarán al cliente principal y el duplicado será eliminado.')) return
    const { error: mergeError } = await supabase.rpc('merge_clients', {
      p_source_client_id: mergeSource,
      p_target_client_id: mergeTarget,
      p_reason: 'Fusión administrativa de cliente duplicado',
    })
    if (mergeError) setError(mergeError.message)
    else {
      setMergeSource('')
      setMergeTarget('')
      await loadClients()
      onChanged('Los clientes duplicados fueron fusionados.')
    }
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <div><h1>Clientes</h1><p>Consulta, segmenta y corrige los datos utilizados para las citas.</p></div>
        {profile.role === 'admin' && <div className="action-row"><button type="button" className="btn btn-secondary" onClick={() => void exportCsv()}>Exportar CSV</button><button type="button" className="btn btn-primary" onClick={() => void exportXlsx()}>Exportar Excel</button></div>}
      </div>
      <div className="filter-grid client-filters">
        <label>Buscar cliente<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, correo, teléfono o Instagram" /></label>
        <label>Tipo<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">Todos</option>{clientTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
        <label>Correo<select value={emailFilter} onChange={(event) => setEmailFilter(event.target.value as typeof emailFilter)}><option value="all">Todos</option><option value="with">Con correo</option><option value="without">Sin correo</option></select></label>
        <label>Estado<select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)}><option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label>
        <label>Campañas<select value={consentFilter} onChange={(event) => setConsentFilter(event.target.value as typeof consentFilter)}><option value="all">Todos</option><option value="yes">Autorizó</option><option value="no">No autorizó</option></select></label>
      </div>
      <p className="form-help">{filtered.length} cliente(s) cumplen los filtros. La exportación respeta exactamente esta selección.</p>
      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? <div className="loading-state">Cargando clientes…</div> : (
        <div className="table-card">
          <table>
            <thead><tr><th>Cliente</th><th>Tipo</th><th>Correo</th><th>Contacto</th><th>Instagram</th><th>Campañas</th><th>Última cita</th><th /></tr></thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id}>
                  <td><strong>{client.first_name} {client.last_name}</strong></td>
                  <td>{client.client_type?.name}</td>
                  <td>{client.email}</td>
                  <td>{client.phone}</td>
                  <td>{client.instagram ? `@${client.instagram}` : '—'}</td>
                  <td>{client.marketing_consent ? 'Sí' : 'No'}</td>
                  <td>{lastAppointments[client.id] ? formatDate(lastAppointments[client.id]) : '—'}</td>
                  <td><button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditing({ ...client })}>Corregir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {profile.role === 'admin' && (
        <article className="settings-card">
          <h2>Fusionar clientes duplicados</h2>
          <p>El cliente duplicado será eliminado y sus citas pasarán al cliente principal.</p>
          <div className="form-grid two-columns">
            <label>Cliente duplicado<select value={mergeSource} onChange={(event) => setMergeSource(event.target.value)}><option value="">Seleccionar</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.first_name} {client.last_name} · {client.email}</option>)}</select></label>
            <label>Cliente principal<select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}><option value="">Seleccionar</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.first_name} {client.last_name} · {client.email}</option>)}</select></label>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void mergeClients()}>Fusionar registros</button>
        </article>
      )}

      {editing && (
        <div className="modal-backdrop" onMouseDown={() => setEditing(null)}>
          <section className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
            <header className="modal-header"><h2>Corregir cliente</h2><button className="icon-button" type="button" onClick={() => setEditing(null)}>×</button></header>
            <form className="modal-body" onSubmit={saveClient}>
              <div className="form-grid two-columns">
                <label>Nombre<input value={editing.first_name} onChange={(event) => setEditing({ ...editing, first_name: event.target.value })} required /></label>
                <label>Apellido<input value={editing.last_name} onChange={(event) => setEditing({ ...editing, last_name: event.target.value })} required /></label>
                <label>Correo<input type="email" value={editing.email} onChange={(event) => setEditing({ ...editing, email: event.target.value })} required /></label>
                <label>Contacto<input value={editing.phone} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} required /></label>
                <label>Instagram<input value={editing.instagram ?? ''} onChange={(event) => setEditing({ ...editing, instagram: event.target.value })} placeholder="@usuario (opcional)" /></label>
                <label className="span-two">Tipo de cliente<select value={editing.client_type_id} onChange={(event) => setEditing({ ...editing, client_type_id: event.target.value })}>{clientTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
                <label className="check-row"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} />Cliente activo</label>
                <label className="check-row"><input type="checkbox" checked={editing.marketing_consent} onChange={(event) => setEditing({ ...editing, marketing_consent: event.target.checked })} />Autoriza campañas por correo</label>
                {editing.marketing_consent && <label className="span-two">Origen de autorización<input value={editing.marketing_consent_source ?? ''} onChange={(event) => setEditing({ ...editing, marketing_consent_source: event.target.value })} placeholder="Ej.: formulario, autorización verbal" required /></label>}
              </div>
              <footer className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cerrar</button><button className="btn btn-primary" type="submit">Guardar</button></footer>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
