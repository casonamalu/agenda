import type { ReactNode } from 'react'
import { roleLabel } from '../lib/date'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

export type PageKey = 'agenda' | 'dashboard' | 'clients' | 'settings' | 'users' | 'audit' | 'emails'

interface LayoutProps {
  children: ReactNode
  profile: Profile
  page: PageKey
  setPage: (page: PageKey) => void
  onNewAppointment: () => void
}

const navItems: Array<{ key: PageKey; label: string; icon: string; adminOnly?: boolean }> = [
  { key: 'agenda', label: 'Agenda', icon: '▦' },
  { key: 'dashboard', label: 'Indicadores', icon: '◫' },
  { key: 'clients', label: 'Clientes', icon: '♙' },
  { key: 'settings', label: 'Mantenedores', icon: '⚙', adminOnly: true },
  { key: 'users', label: 'Usuarios', icon: '◎', adminOnly: true },
  { key: 'emails', label: 'Correos', icon: '✉', adminOnly: true },
  { key: 'audit', label: 'Auditoría', icon: '≡', adminOnly: true },
]

export function Layout({ children, profile, page, setPage, onNewAppointment }: LayoutProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row sidebar-brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>Casona Malú</strong>
            <span>Agenda interna</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Navegación principal">
          {navItems
            .filter((item) => !item.adminOnly || profile.role === 'admin')
            .map((item) => (
              <button
                type="button"
                key={item.key}
                className={page === item.key ? 'active' : ''}
                onClick={() => setPage(item.key)}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </button>
            ))}
        </nav>
        <div className="sidebar-user">
          <strong>{profile.full_name}</strong>
          <span>{roleLabel(profile.role)}</span>
          <small>{profile.email}</small>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => supabase.auth.signOut()}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <div>
            <strong>Agenda Casona Malú</strong>
            <span>Zona horaria: Chile</span>
          </div>
          <button className="btn btn-primary" type="button" onClick={onNewAppointment}>
            + Nueva cita
          </button>
        </header>
        <main className="page-content">{children}</main>
      </section>
    </div>
  )
}
