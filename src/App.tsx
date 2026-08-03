import { FormEvent, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Agenda } from './components/Agenda'
import { AppointmentModal } from './components/AppointmentModal'
import { Audit } from './components/Audit'
import { Clients } from './components/Clients'
import { Cash } from './components/Cash'
import { Dashboard } from './components/Dashboard'
import { EmailQueue } from './components/EmailQueue'
import { Layout, type PageKey } from './components/Layout'
import { Login } from './components/Login'
import { Orders } from './components/Orders'
import { Profitability } from './components/Profitability'
import { Reports } from './components/Reports'
import { Settings } from './components/Settings'
import { Toast } from './components/Toast'
import { Users } from './components/Users'
import { Workshop } from './components/Workshop'
import { toIsoDate } from './lib/date'
import { supabase } from './lib/supabase'
import type { Appointment, Profile } from './types'

const PAGE_STORAGE_KEY = 'casona-malu-active-page'
const VALID_PAGES: PageKey[] = ['agenda', 'dashboard', 'clients', 'orders', 'cash', 'workshop', 'profitability', 'reports', 'settings', 'users', 'emails', 'audit']
const ADMIN_PAGES: PageKey[] = ['reports', 'settings', 'users', 'emails', 'audit']
const COMMERCIAL_PAGES: PageKey[] = ['cash', 'profitability']

function initialPage(): PageKey {
  const stored = window.localStorage.getItem(PAGE_STORAGE_KEY) as PageKey | null
  return stored && VALID_PAGES.includes(stored) ? stored : 'agenda'
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState<PageKey>(initialPage)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [newAppointmentDate, setNewAppointmentDate] = useState(toIsoDate(new Date()))
  const [refreshToken, setRefreshToken] = useState(0)
  const [orderLaunchAppointmentId, setOrderLaunchAppointmentId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' | 'info' }>({ message: '', kind: 'info' })

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) void loadProfile(data.session.user.id)
      else setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setProfile(null)
      if (nextSession) void loadProfile(nextSession.user.id)
      else setLoading(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    window.localStorage.setItem(PAGE_STORAGE_KEY, page)
  }, [page])

  useEffect(() => {
    if (profile && profile.role !== 'admin' && ADMIN_PAGES.includes(page)) setPage('agenda')
    if (profile && !['admin', 'seller'].includes(profile.role) && COMMERCIAL_PAGES.includes(page)) setPage('agenda')
  }, [page, profile])

  async function loadProfile(userId: string) {
    setLoading(true)
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error || !data) {
      setToast({ message: 'La cuenta no tiene un perfil válido. Contacta al administrador.', kind: 'error' })
      await supabase.auth.signOut()
      setLoading(false)
      return
    }
    const userProfile = data as Profile
    if (!userProfile.active) {
      setToast({ message: 'Esta cuenta se encuentra dada de baja.', kind: 'error' })
      await supabase.auth.signOut()
      setLoading(false)
      return
    }
    setProfile(userProfile)
    setLoading(false)
  }

  function openNewAppointment(date = toIsoDate(new Date())) {
    setSelectedAppointment(null)
    setNewAppointmentDate(date)
    setModalOpen(true)
  }

  function openAppointment(appointment: Appointment) {
    setSelectedAppointment(appointment)
    setNewAppointmentDate(appointment.appointment_date)
    setModalOpen(true)
  }

  function handleSaved(message: string) {
    setModalOpen(false)
    setSelectedAppointment(null)
    setRefreshToken((value) => value + 1)
    setToast({ message, kind: 'success' })
  }

  function openOrderFromAppointment(appointment: Appointment) {
    setModalOpen(false)
    setSelectedAppointment(null)
    setOrderLaunchAppointmentId(appointment.id)
    setPage('orders')
  }

  function notify(message: string, kind: 'success' | 'error' | 'info' = 'success') {
    setRefreshToken((value) => value + 1)
    setToast({ message, kind })
  }

  if (loading) return <div className="loading-screen">Cargando sistema…</div>
  if (!session || !profile) return <Login />

  return (
    <>
      <Layout profile={profile} page={page} setPage={setPage} onNewAppointment={() => openNewAppointment()}>
        {page === 'agenda' && <Agenda refreshToken={refreshToken} onOpenAppointment={openAppointment} onDateForNewAppointment={openNewAppointment} />}
        {page === 'dashboard' && <Dashboard refreshToken={refreshToken} />}
        {page === 'clients' && <Clients profile={profile} refreshToken={refreshToken} onChanged={notify} />}
        {page === 'orders' && <Orders profile={profile} refreshToken={refreshToken} initialAppointmentId={orderLaunchAppointmentId} onLaunchHandled={() => setOrderLaunchAppointmentId(null)} onChanged={notify} />}
        {page === 'cash' && ['admin', 'seller'].includes(profile.role) && <Cash refreshToken={refreshToken} onChanged={notify} />}
        {page === 'workshop' && <Workshop profile={profile} refreshToken={refreshToken} onChanged={notify} />}
        {page === 'profitability' && ['admin', 'seller'].includes(profile.role) && <Profitability refreshToken={refreshToken} />}
        {page === 'reports' && profile.role === 'admin' && <Reports profile={profile} refreshToken={refreshToken} onChanged={notify} />}
        {page === 'settings' && profile.role === 'admin' && <Settings refreshToken={refreshToken} onChanged={notify} />}
        {page === 'users' && profile.role === 'admin' && <Users refreshToken={refreshToken} onChanged={notify} />}
        {page === 'emails' && profile.role === 'admin' && <EmailQueue refreshToken={refreshToken} />}
        {page === 'audit' && profile.role === 'admin' && <Audit refreshToken={refreshToken} />}
      </Layout>
      <AppointmentModal
        open={modalOpen}
        profile={profile}
        appointment={selectedAppointment}
        initialDate={newAppointmentDate}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        onCreateOrder={openOrderFromAppointment}
      />
      {profile.must_change_password && <ChangePassword profile={profile} onCompleted={(updated) => setProfile(updated)} />}
      <Toast message={toast.message} kind={toast.kind} onClose={() => setToast({ ...toast, message: '' })} />
    </>
  )
}

function ChangePassword({ profile, onCompleted }: { profile: Profile; onCompleted: (profile: Profile) => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      setError('La contraseña debe tener 12 caracteres, mayúscula, minúscula y número.')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setLoading(true)
    const { error: authError } = await supabase.auth.updateUser({ password })
    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }
    const { error: profileError } = await supabase.from('profiles').update({ must_change_password: false }).eq('id', profile.id)
    if (profileError) setError(profileError.message)
    else onCompleted({ ...profile, must_change_password: false })
    setLoading(false)
  }

  return (
    <div className="modal-backdrop forced-modal">
      <section className="modal-card">
        <header className="modal-header"><div><h2>Cambiar contraseña</h2><p>Debes reemplazar la clave temporal antes de continuar.</p></div></header>
        <form className="modal-body" onSubmit={submit}>
          <label>Nueva contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /></label>
          <label>Repetir contraseña<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={12} required /></label>
          {error && <div className="alert alert-danger">{error}</div>}
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>{loading ? 'Actualizando…' : 'Guardar contraseña'}</button>
        </form>
      </section>
    </div>
  )
}
