import type { Client } from '../types'

export const APPOINTMENT_DRAFT_KEY = 'casona-malu-new-appointment-draft-v1'

export interface StoredClientDraft {
  first_name: string
  last_name: string
  email: string
  phone: string
  instagram: string
  client_type_id: string
  marketing_consent: boolean
  marketing_consent_source: string
}

export interface AppointmentDraftState {
  version: 1
  savedAt: string
  clientQuery: string
  selectedClient: Client | null
  newClient: StoredClientDraft
  hasCompanion: boolean
  companionQuery: string
  selectedCompanion: Client | null
  newCompanion: StoredClientDraft
  appointmentTypeId: string
  date: string
  startTime: string
  durationMinutes: number
  notes: string
  allowOutOfSlot: boolean
  allowOverbook: boolean
  exceptionReason: string
}

export function readAppointmentDraft(storage: Pick<Storage, 'getItem'> = window.sessionStorage) {
  try {
    const value = storage.getItem(APPOINTMENT_DRAFT_KEY)
    if (!value) return null
    const draft = JSON.parse(value) as AppointmentDraftState
    return draft.version === 1 ? draft : null
  } catch {
    return null
  }
}

export function writeAppointmentDraft(draft: AppointmentDraftState, storage: Pick<Storage, 'setItem'> = window.sessionStorage) {
  try {
    storage.setItem(APPOINTMENT_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // El formulario debe seguir funcionando aunque el navegador bloquee el almacenamiento.
  }
}

export function clearAppointmentDraft(storage: Pick<Storage, 'removeItem'> = window.sessionStorage) {
  try {
    storage.removeItem(APPOINTMENT_DRAFT_KEY)
  } catch {
    // No interrumpir el cierre de sesión o del formulario por una restricción del navegador.
  }
}

export function hasMeaningfulAppointmentDraft(draft: AppointmentDraftState) {
  const primary = draft.newClient
  const companion = draft.newCompanion
  return Boolean(
    draft.selectedClient
    || primary.first_name.trim()
    || primary.last_name.trim()
    || primary.email.trim()
    || primary.phone.replace(/\D/g, '').length > 2
    || primary.instagram.trim()
    || primary.client_type_id
    || draft.startTime
    || draft.notes.trim()
    || draft.hasCompanion
    || draft.selectedCompanion
    || companion.first_name.trim()
    || companion.last_name.trim()
    || companion.email.trim()
    || companion.phone.replace(/\D/g, '').length > 2
    || companion.instagram.trim()
    || companion.client_type_id
  )
}
