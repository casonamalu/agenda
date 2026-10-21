import type { AuthChangeEvent } from '@supabase/supabase-js'

export type OAuthCallback =
  | { kind: 'none' }
  | { kind: 'code'; code: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string }

const AUTH_QUERY_KEYS = ['code', 'error', 'error_code', 'error_description']

export function readOAuthCallback(href: string): OAuthCallback {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  const error = url.searchParams.get('error_description') ?? hash.get('error_description') ?? url.searchParams.get('error') ?? hash.get('error')

  if (error) return { kind: 'error', message: error }

  const code = url.searchParams.get('code')
  if (code) return { kind: 'code', code }

  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken }

  return { kind: 'none' }
}

export function cleanOAuthCallbackUrl(href: string) {
  const url = new URL(href)
  AUTH_QUERY_KEYS.forEach((key) => url.searchParams.delete(key))
  url.hash = ''
  return `${url.pathname}${url.search}` || '/'
}

export function shouldReloadProfile(event: AuthChangeEvent, currentUserId: string | null, nextUserId: string | null) {
  if (!nextUserId) return false
  if (event === 'TOKEN_REFRESHED') return false
  if (event === 'SIGNED_IN' && currentUserId === nextUserId) return false
  return event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED'
}
