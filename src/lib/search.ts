import type { Client } from '../types'

export function normalizeSearch(value: unknown) {
  return String(value ?? '')
    .toLocaleLowerCase('es-CL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^@/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function searchTokens(query: string) {
  return normalizeSearch(query)
    .split(' ')
    .map((token) => token.replace(/[,%()]/g, ''))
    .filter(Boolean)
}

export function matchesSearchValues(query: string, values: unknown[]) {
  const tokens = searchTokens(query)
  if (!tokens.length) return true
  const haystack = normalizeSearch(values.filter(Boolean).join(' '))
  return tokens.every((token) => haystack.includes(token))
}

export function matchesClientSearch(client: Pick<Client, 'first_name' | 'last_name' | 'email' | 'phone' | 'instagram'>, query: string) {
  return matchesSearchValues(query, [client.first_name, client.last_name, client.email, client.phone, client.instagram])
}

export function clientTokenFilter(token: string) {
  const safe = token.replace(/[,%()]/g, '')
  return `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%,instagram.ilike.%${safe.replace(/^@/, '')}%`
}
