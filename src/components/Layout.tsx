import { useEffect, useState, type ReactNode } from 'react'
import { roleLabel } from '../lib/date'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

export type PageKey = 'agenda' | 'dashboard' | 'clients' | 'orders' | 'cash' | 'workshop' | 'profitability' | 'reports' | 'settings' | 'users' | 'audit' | 'emails'

interface LayoutProps {
  children: ReactNode
  profile: Profile
  page: PageKey
  setPage: (page: PageKey) => void
  onNewAppointment: () => void
}

const navItems: Array<{ key: PageKey; label: string; icon: string; adminOnly?: boolean; commercialOnly?: boolean }> = [
  { key: 'agenda', label: 'Agenda', icon: '▦' },
  { key: 'dashboard', label: 'Indicadores', icon: '◫' },
  { key: 'clients', label: 'Clientes', icon: '♙' },
  { key: 'orders', label: 'Pedidos', icon: '◇' },
  { key: 'cash', label: 'Caja', icon: '$', commercialOnly: true },
  { key: 'workshop', label: 'Taller', icon: '⌁' },
  { key: 'profitability', label: 'Rentabilidad', icon: '%', commercialOnly: true },
  { key: 'reports', label: 'Reportes', icon: '▤', adminOnly: true },
]

const configurationItems: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'settings', label: 'Mantenedores', icon: '⚙' },
  { key: 'users', label: 'Usuarios', icon: '◎' },
  { key: 'emails', label: 'Correos', icon: '✉' },
  { key: 'audit', label: 'Auditoría', icon: '≡' },
]

export function Layout({ children, profile, page, setPage, onNewAppointment }: LayoutProps) {
  const configurationActive = configurationItems.some((item) => item.key === page)
  const [configurationOpen, setConfigurationOpen] = useState(configurationActive)

  useEffect(() => {
    if (configurationActive) setConfigurationOpen(true)
  }, [configurationActive])

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
            .filter((item) => (!item.adminOnly || profile.role === 'admin')
              && (!item.commercialOnly || profile.role === 'admin' || profile.role === 'seller'))
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
          {profile.role === 'admin' && (
            <div className={`nav-group ${configurationActive ? 'active' : ''}`}>
              <button
                type="button"
                className={`nav-group-toggle ${configurationActive ? 'active' : ''}`}
                aria-expanded={configurationOpen}
                onClick={() => setConfigurationOpen((open) => !open)}
              >
                <span aria-hidden="true">⚙</span>
                Configuración
                <span className="nav-chevron" aria-hidden="true">{configurationOpen ? '⌃' : '⌄'}</span>
              </button>
              {configurationOpen && (
                <div className="nav-submenu">
                  {configurationItems.map((item) => (
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
                </div>
              )}
            </div>
          )}
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
            <strong>Sistema Casona Malú</strong>
            <span>Agenda · Pedidos · Caja · Taller</span>
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
