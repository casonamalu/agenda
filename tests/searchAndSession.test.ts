import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldReloadProfile } from '../src/lib/authSession.ts'
import { hasMeaningfulAppointmentDraft, type AppointmentDraftState } from '../src/lib/appointmentDraft.ts'
import { matchesClientSearch, matchesSearchValues, searchTokens } from '../src/lib/search.ts'

const carolina = {
  first_name: 'Carolina',
  last_name: 'Parra',
  email: 'carolapa@yahoo.com',
  phone: '+56 9 73895056',
  instagram: null,
}

test('encuentra clientes usando nombre y apellido en cualquier orden', () => {
  assert.equal(matchesClientSearch(carolina, 'Carolina Parra'), true)
  assert.equal(matchesClientSearch(carolina, 'parra carolina'), true)
  assert.equal(matchesClientSearch(carolina, 'CAROLINA'), true)
  assert.equal(matchesClientSearch(carolina, 'Camila Parra'), false)
})

test('normaliza tildes y mantiene búsquedas por otros datos', () => {
  assert.deepEqual(searchTokens('  María   José  '), ['maria', 'jose'])
  assert.equal(matchesSearchValues('maria perez', ['María', 'Pérez']), true)
  assert.equal(matchesClientSearch(carolina, '73895056'), true)
  assert.equal(matchesClientSearch(carolina, 'carolapa@yahoo.com'), true)
})

test('una renovación de token no obliga a recargar el perfil', () => {
  assert.equal(shouldReloadProfile('TOKEN_REFRESHED', 'user-1', 'user-1'), false)
  assert.equal(shouldReloadProfile('SIGNED_IN', 'user-1', 'user-1'), false)
  assert.equal(shouldReloadProfile('SIGNED_IN', null, 'user-1'), true)
  assert.equal(shouldReloadProfile('USER_UPDATED', 'user-1', 'user-1'), true)
})

test('detecta cuándo un borrador contiene información que debe protegerse', () => {
  const emptyClient = { first_name: '', last_name: '', email: '', phone: '+56', instagram: '', client_type_id: '', marketing_consent: false, marketing_consent_source: '' }
  const draft: AppointmentDraftState = {
    version: 1,
    savedAt: '2026-09-23T00:00:00Z',
    clientQuery: '',
    selectedClient: null,
    newClient: emptyClient,
    hasCompanion: false,
    companionQuery: '',
    selectedCompanion: null,
    newCompanion: emptyClient,
    appointmentTypeId: 'sale',
    date: '2026-09-25',
    startTime: '',
    durationMinutes: 45,
    notes: '',
    allowOutOfSlot: false,
    allowOverbook: false,
    exceptionReason: '',
  }
  assert.equal(hasMeaningfulAppointmentDraft(draft), false)
  assert.equal(hasMeaningfulAppointmentDraft({ ...draft, newClient: { ...emptyClient, first_name: 'Carolina' } }), true)
  assert.equal(hasMeaningfulAppointmentDraft({ ...draft, startTime: '16:45' }), true)
})
