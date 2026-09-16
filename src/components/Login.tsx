import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loadingMethod, setLoadingMethod] = useState<'password' | 'google' | null>(null)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setLoadingMethod('password')
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) setError('No fue posible ingresar. Revisa el correo y la contraseña.')
    setLoadingMethod(null)
  }

  async function handleGoogleSignIn() {
    setError('')
    setLoadingMethod('google')
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (authError) {
      setError('No fue posible iniciar sesión con Google. Intenta nuevamente.')
      setLoadingMethod(null)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-row">
          <div className="brand-mark">M</div>
          <div>
            <strong>Casona Malú</strong>
            <span>Agenda interna</span>
          </div>
        </div>
        <h1 id="login-title">Iniciar sesión</h1>
        <p>Acceso exclusivo para personal autorizado.</p>
        <button
          className="btn btn-google btn-block"
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loadingMethod !== null}
        >
          <GoogleIcon />
          {loadingMethod === 'google' ? 'Conectando con Google…' : 'Continuar con Google'}
        </button>
        <div className="login-divider"><span>o ingresa con tu contraseña</span></div>
        <form onSubmit={handleSubmit}>
          <label>
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              minLength={8}
              required
            />
          </label>
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={loadingMethod !== null}>
            {loadingMethod === 'password' ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg className="google-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.4a4.6 4.6 0 0 1-2 3v2.7h3.4c2-1.8 3.1-4.5 3.1-7.7Z" />
      <path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.7c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.8A10.4 10.4 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.2 13.5a6.2 6.2 0 0 1 0-4V6.7H2.7a10.1 10.1 0 0 0 0 9.6l3.5-2.8Z" />
      <path fill="#EA4335" d="M12 5.2c1.5 0 3 .5 4 1.6l3-3A10 10 0 0 0 2.7 6.7l3.5 2.8C7 7 9.3 5.2 12 5.2Z" />
    </svg>
  )
}
