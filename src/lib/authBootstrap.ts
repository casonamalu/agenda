import type { Session } from '@supabase/supabase-js'
import { cleanOAuthCallbackUrl, readOAuthCallback } from './authSession'
import { supabase } from './supabase'

const AUTH_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(
      () => reject(new Error('Tiempo de espera agotado al iniciar sesión.')),
      AUTH_TIMEOUT_MS,
    )
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

function clearCallbackUrl() {
  window.history.replaceState({}, document.title, cleanOAuthCallbackUrl(window.location.href))
}

export async function resolveInitialSession(): Promise<Session | null> {
  const callback = readOAuthCallback(window.location.href)

  if (callback.kind === 'error') {
    clearCallbackUrl()
    throw new Error(callback.message)
  }

  const { error: initializationError } = await withTimeout(supabase.auth.initialize())
  if (initializationError) {
    if (callback.kind !== 'none') clearCallbackUrl()
    throw initializationError
  }

  const { data, error } = await withTimeout(supabase.auth.getSession())
  if (error) throw error
  return data.session
}
