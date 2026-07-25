import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AuditLog } from '../types'

export function Audit({ refreshToken }: { refreshToken: number }) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [table, setTable] = useState('')

  useEffect(() => { void loadLogs() }, [refreshToken, table])

  async function loadLogs() {
    let query = supabase.from('audit_logs').select('*, actor:profiles!audit_logs_changed_by_fkey(full_name,email)').order('changed_at', { ascending: false }).limit(300)
    if (table) query = query.eq('table_name', table)
    const { data } = await query
    setLogs((data ?? []) as AuditLog[])
  }

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Auditoría</h1><p>Registro de cambios conservado durante 12 meses.</p></div></div>
      <div className="filter-grid one-filter"><label>Registro<select value={table} onChange={(event) => setTable(event.target.value)}><option value="">Todos</option><option value="appointments">Citas</option><option value="clients">Clientes</option><option value="profiles">Usuarios</option><option value="appointment_types">Tipos de cita</option><option value="closures">Cierres</option><option value="email_templates">Plantillas</option></select></label></div>
      <div className="table-card"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Registro</th><th>Acción</th><th>Motivo</th><th>Detalle</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{new Date(log.changed_at).toLocaleString('es-CL')}</td><td>{log.actor?.full_name ?? 'Sistema'}<br /><small>{log.actor?.email}</small></td><td>{log.table_name}</td><td>{log.action}</td><td>{log.reason}</td><td><details><summary>Ver</summary><pre>{JSON.stringify({ anterior: log.old_data, nuevo: log.new_data }, null, 2)}</pre></details></td></tr>)}</tbody></table></div>
    </section>
  )
}
