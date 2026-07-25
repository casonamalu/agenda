import { FormEvent, useEffect, useState } from 'react'
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
  const [editing, setEditing] = useState<Client | null>(null)
  const [mergeSource, setMergeSource] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { void loadClients() }, [refreshToken])

  async function loadClients() {
    setLoading(true)
    const [{ data, error: clientsError }, { data: typesData }] = await Promise.all([
      supabase.from('clients').select('*, client_type:client_types(*)').order('last_name').order('first_name'),
      supabase.from('client_types').select('*').eq('active', true).order('display_order'),
    ])
    if (clientsError) setError(clientsError.message)
    setClients((data ?? []) as Client[])
    setClientTypes((typesData ?? []) as ClientType[])
    setLoading(false)
  }

  const filtered = clients.filter((client) => {
    const haystack = `${client.first_name} ${client.last_name} ${client.email} ${client.phone}`.toLowerCase()
    return haystack.includes(search.toLowerCase())
  })

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
        client_type_id: editing.client_type_id,
      })
      .eq('id', editing.id)
    if (updateError) setError(updateError.message)
    else {
      setEditing(null)
      await loadClients()
      onChanged('Los datos del cliente fueron corregidos.')
    }
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
        <div><h1>Clientes</h1><p>Consulta y corrige los datos utilizados para las citas.</p></div>
      </div>
      <div className="filter-grid one-filter"><label>Buscar cliente<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, correo o teléfono" /></label></div>
      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? <div className="loading-state">Cargando clientes…</div> : (
        <div className="table-card">
          <table>
            <thead><tr><th>Cliente</th><th>Tipo</th><th>Correo</th><th>Contacto</th><th /></tr></thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id}>
                  <td><strong>{client.first_name} {client.last_name}</strong></td>
                  <td>{client.client_type?.name}</td>
                  <td>{client.email}</td>
                  <td>{client.phone}</td>
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
                <label className="span-two">Tipo de cliente<select value={editing.client_type_id} onChange={(event) => setEditing({ ...editing, client_type_id: event.target.value })}>{clientTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
              </div>
              <footer className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cerrar</button><button className="btn btn-primary" type="submit">Guardar</button></footer>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
