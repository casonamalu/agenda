import { FormEvent, useEffect, useState } from 'react'
import { roleLabel } from '../lib/date'
import { supabase } from '../lib/supabase'
import type { AppRole, Profile } from '../types'

export function Users({ refreshToken, onChanged }: { refreshToken: number; onChanged: (message: string) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { void loadProfiles() }, [refreshToken])

  async function loadProfiles() {
    const { data, error: loadError } = await supabase.from('profiles').select('*').order('full_name')
    if (loadError) setError(loadError.message)
    setProfiles((data ?? []) as Profile[])
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    const form = new FormData(event.currentTarget)
    const body = {
      action: 'create',
      full_name: String(form.get('full_name')),
      email: String(form.get('email')).toLowerCase(),
      role: String(form.get('role')) as AppRole,
      password: String(form.get('password')),
    }
    const { error: functionError } = await supabase.functions.invoke('admin-user', { body })
    setLoading(false)
    if (functionError) setError(functionError.message)
    else { event.currentTarget.reset(); await loadProfiles(); onChanged('Usuario creado. Debe cambiar la contraseña en el primer ingreso.') }
  }

  async function changeState(profile: Profile) {
    const action = profile.active ? 'deactivate' : 'activate'
    const { error: functionError } = await supabase.functions.invoke('admin-user', { body: { action, user_id: profile.id } })
    if (functionError) setError(functionError.message)
    else { await loadProfiles(); onChanged(profile.active ? 'Usuario dado de baja.' : 'Usuario activado.') }
  }

  async function resetPassword(profile: Profile) {
    const password = window.prompt(`Nueva contraseña temporal para ${profile.full_name}:`)
    if (!password) return
    const { error: functionError } = await supabase.functions.invoke('admin-user', { body: { action: 'reset_password', user_id: profile.id, password } })
    if (functionError) setError(functionError.message)
    else onChanged('Contraseña temporal actualizada.')
  }

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Usuarios</h1><p>Alta, baja y restablecimiento administrativo.</p></div></div>
      {error && <div className="alert alert-danger">{error}</div>}
      <form className="settings-card" onSubmit={createUser}>
        <h2>Crear usuario</h2>
        <div className="form-grid four-columns">
          <label>Nombre completo<input name="full_name" required /></label>
          <label>Correo<input name="email" type="email" required /></label>
          <label>Rol<select name="role"><option value="seller">Vendedora</option><option value="reception">Recepción</option><option value="admin">Administrador</option></select></label>
          <label>Contraseña temporal<input name="password" type="password" minLength={8} required /></label>
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Creando…' : 'Crear usuario'}</button>
      </form>
      <div className="table-card"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{profiles.map((profile) => <tr key={profile.id}><td><strong>{profile.full_name}</strong><br /><small>{profile.email}</small></td><td>{roleLabel(profile.role)}</td><td><span className={`badge ${profile.active ? 'badge-success' : 'badge-muted'}`}>{profile.active ? 'Activo' : 'Baja'}</span></td><td><div className="action-row"><button className="btn btn-secondary btn-sm" type="button" onClick={() => void resetPassword(profile)}>Cambiar clave</button><button className={`btn btn-sm ${profile.active ? 'btn-danger' : 'btn-primary'}`} type="button" onClick={() => void changeState(profile)}>{profile.active ? 'Dar de baja' : 'Activar'}</button></div></td></tr>)}</tbody></table></div>
    </section>
  )
}
