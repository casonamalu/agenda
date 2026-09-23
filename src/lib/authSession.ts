import type { AuthChangeEvent } from '@supabase/supabase-js'

export function shouldReloadProfile(event: AuthChangeEvent, currentUserId: string | null, nextUserId: string | null) {
  if (!nextUserId) return false
  if (event === 'TOKEN_REFRESHED') return false
  if (event === 'SIGNED_IN' && currentUserId === nextUserId) return false
  return event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED'
}
