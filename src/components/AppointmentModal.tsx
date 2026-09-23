import { FormEvent, useEffect, useMemo, useState } from 'react'
import { chileIsoDate, commercialDecisionLabel } from '../lib/business'
import { formatDate, formatTime } from '../lib/date'
import { GROUP_SALE_DURATION_MINUTES, appointmentClientNames, groupSaleDuration } from '../lib/appointments'
import { supabase } from '../lib/supabase'
import { clientTokenFilter, matchesClientSearch, searchTokens } from '../lib/search'
import {
  clearAppointmentDraft,
  hasMeaningfulAppointmentDraft,
  readAppointmentDraft,
  writeAppointmentDraft,
  type AppointmentDraftState,
} from '../lib/appointmentDraft'
import type { Appointment, AppointmentType, Client, ClientType, CommercialOutcome, Profile } from '../types'

interface SlotOption {
  start_time: string
  end_time: string
  available: boolean
  reason: string | null
  regular_slot: boolean
}

interface CommercialDecision {
  id: string
  previous_outcome: CommercialOutcome | null
  new_outcome: CommercialOutcome | null
  effective_date: string | null
  notes: string | null
  changed_at: string
}

interface ClientDraft {
  first_name: string
  last_name: string
  email: string
  phone: string
  instagram: string
  client_type_id: string
  marketing_consent: boolean
  marketing_consent_source: string
}

interface Props {
  open: boolean
  profile: Profile
  appointment: Appointment | null
  initialDate: string
  onClose: () => void
  onSaved: (message: string) => void
  onCreateOrder: (appointment: Appointment) => void
}

const DEFAULT_EXCEPTION_REASON = 'Excepción autorizada sin comentario adicional'

const emptyClient = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '+56',
  instagram: '',
  client_type_id: '',
  marketing_consent: false,
  marketing_consent_source: '',
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function AppointmentModal({ open, profile, appointment, initialDate, onClose, onSaved, onCreateOrder }: Props) {
  const [types, setTypes] = useState<AppointmentType[]>([])
  const [clientTypes, setClientTypes] = useState<ClientType[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [clientQuery, setClientQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [newClient, setNewClient] = useState(emptyClient)
  const [hasCompanion, setHasCompanion] = useState(false)
  const [companionClients, setCompanionClients] = useState<Client[]>([])
  const [companionQuery, setCompanionQuery] = useState('')
  const [selectedCompanion, setSelectedCompanion] = useState<Client | null>(null)
  const [newCompanion, setNewCompanion] = useState(emptyClient)
  const [appointmentTypeId, setAppointmentTypeId] = useState('')
  const [date, setDate] = useState(initialDate)
  const [startTime, setStartTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(45)
  const [durationStep, setDurationStep] = useState(15)
  const [maxDuration, setMaxDuration] = useState(240)
  const [notes, setNotes] = useState('')
  const [slots, setSlots] = useState<SlotOption[]>([])
  const [allowOutOfSlot, setAllowOutOfSlot] = useState(false)
  const [allowOverbook, setAllowOverbook] = useState(false)
  const [exceptionReason, setExceptionReason] = useState('')
  const [cancellationReason, setCancellationReason] = useState('Solicitud del cliente')
  const [commercialOutcome, setCommercialOutcome] = useState<CommercialOutcome | ''>('')
  const [commercialDecisionDate, setCommercialDecisionDate] = useState(chileIsoDate)
  const [commercialNotes, setCommercialNotes] = useState('')
  const [commercialHistory, setCommercialHistory] = useState<CommercialDecision[]>([])
  const [companionOutcome, setCompanionOutcome] = useState<CommercialOutcome | ''>('')
  const [companionDecisionDate, setCompanionDecisionDate] = useState(chileIsoDate)
  const [companionNotes, setCompanionNotes] = useState('')
  const [companionHistory, setCompanionHistory] = useState<CommercialDecision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [draftReady, setDraftReady] = useState(false)

  const isEdit = Boolean(appointment)
  const selectedType = useMemo(
    () => types.find((type) => type.id === appointmentTypeId) ?? null,
    [appointmentTypeId, types],
  )
  const companion = appointment?.participants?.[0] ?? null

  useEffect(() => {
    if (!open) return
    void loadCatalogs()
  }, [open])

  useEffect(() => {
    if (!open) return
    setDraftReady(false)
    setError('')
    setClientQuery('')
    setClients([])
    setAllowOutOfSlot(appointment?.is_out_of_slot ?? false)
    setAllowOverbook(appointment?.is_overbook ?? false)
    setExceptionReason(appointment?.exception_reason ?? '')
    setNotes(appointment?.internal_notes ?? '')
    setDate(appointment?.appointment_date ?? initialDate)
    setAppointmentTypeId(appointment?.appointment_type_id ?? '')
    setStartTime(appointment?.start_time?.slice(0, 5) ?? '')
    if (appointment) {
      setDurationMinutes(timeToMinutes(appointment.end_time) - timeToMinutes(appointment.start_time))
    }
    setCommercialOutcome(appointment?.commercial_outcome ?? '')
    setCommercialDecisionDate(appointment?.commercial_outcome_at ? chileIsoDate(appointment.commercial_outcome_at) : chileIsoDate())
    setCommercialNotes('')
    setCommercialHistory([])
    setSelectedClient(appointment?.client ?? null)
    setNewClient(emptyClient)
    setHasCompanion(Boolean(appointment?.participants?.length))
    setCompanionClients([])
    setCompanionQuery('')
    setSelectedCompanion(null)
    setNewCompanion(emptyClient)
    setCompanionOutcome(companion?.commercial_outcome ?? '')
    setCompanionDecisionDate(companion?.commercial_outcome_at ? chileIsoDate(companion.commercial_outcome_at) : chileIsoDate())
    setCompanionNotes('')
    setCompanionHistory([])
    if (!appointment) {
      const draft = readAppointmentDraft()
      if (draft) {
        setClientQuery(draft.clientQuery)
        setSelectedClient(draft.selectedClient)
        setNewClient(draft.newClient)
        setHasCompanion(draft.hasCompanion)
        setCompanionQuery(draft.companionQuery)
        setSelectedCompanion(draft.selectedCompanion)
        setNewCompanion(draft.newCompanion)
        setAppointmentTypeId(draft.appointmentTypeId)
        setDate(draft.date)
        setStartTime(draft.startTime)
        setDurationMinutes(draft.durationMinutes)
        setNotes(draft.notes)
        setAllowOutOfSlot(draft.allowOutOfSlot)
        setAllowOverbook(draft.allowOverbook)
        setExceptionReason(draft.exceptionReason)
      }
    }
    setDraftReady(true)
  }, [appointment, initialDate, open])

  useEffect(() => {
    if (!open || isEdit || !draftReady) return
    writeAppointmentDraft(currentDraft())
  }, [
    open, isEdit, draftReady, clientQuery, selectedClient, newClient, hasCompanion,
    companionQuery, selectedCompanion, newCompanion, appointmentTypeId, date,
    startTime, durationMinutes, notes, allowOutOfSlot, allowOverbook, exceptionReason,
  ])

  useEffect(() => {
    if (!open || !appointment) return
    void loadCommercialHistory(appointment.id)
    if (appointment.participants?.[0]) void loadCompanionHistory(appointment.participants[0].id)
  }, [appointment?.id, open])

  useEffect(() => {
    if (!open || !appointmentTypeId || !date) return
    void loadSlots()
  }, [appointmentTypeId, date, durationMinutes, open, allowOverbook])

  useEffect(() => {
    if (!clientQuery.trim() || selectedClient || isEdit) {
      setClients([])
      return
    }
    const timer = window.setTimeout(() => void searchClients(), 250)
    return () => window.clearTimeout(timer)
  }, [clientQuery, selectedClient, isEdit])

  useEffect(() => {
    if (!companionQuery.trim() || selectedCompanion || isEdit || !hasCompanion) {
      setCompanionClients([])
      return
    }
    const timer = window.setTimeout(() => void searchCompanionClients(), 250)
    return () => window.clearTimeout(timer)
  }, [companionQuery, selectedCompanion, hasCompanion, isEdit])

  async function loadCatalogs() {
    const [{ data: typeData }, { data: clientTypeData }, { data: settingData }] = await Promise.all([
      supabase.from('appointment_types').select('*').eq('active', true).order('sort_order'),
      supabase.from('client_types').select('*').eq('active', true).order('display_order'),
      supabase.from('app_settings').select('setting_key,setting_value').in('setting_key', ['appointment_duration_step_minutes', 'appointment_max_duration_minutes']),
    ])
    const appointmentTypes = (typeData ?? []) as AppointmentType[]
    const customerTypes = (clientTypeData ?? []) as ClientType[]
    setTypes(appointmentTypes)
    setClientTypes(customerTypes)
    setAppointmentTypeId((current) => current || appointmentTypes[0]?.id || '')
    const settingMap = Object.fromEntries((settingData ?? []).map((item) => [item.setting_key, Number(item.setting_value)]))
    setDurationStep(settingMap.appointment_duration_step_minutes || 15)
    setMaxDuration(settingMap.appointment_max_duration_minutes || 240)
    if (!appointment) setDurationMinutes(appointmentTypes[0]?.duration_minutes || 45)
  }

  async function loadCommercialHistory(appointmentId: string) {
    const { data } = await supabase
      .from('commercial_decision_history')
      .select('id,previous_outcome,new_outcome,effective_date,notes,changed_at')
      .eq('appointment_id', appointmentId)
      .order('changed_at', { ascending: false })
    setCommercialHistory((data ?? []) as CommercialDecision[])
  }

  async function loadCompanionHistory(participantId: string) {
    const { data } = await supabase
      .from('appointment_participant_decision_history')
      .select('id,previous_outcome,new_outcome,effective_date,notes,changed_at')
      .eq('participant_id', participantId)
      .order('changed_at', { ascending: false })
    setCompanionHistory((data ?? []) as CommercialDecision[])
  }

  async function searchClients() {
    const data = await findMatchingClients(clientQuery)
    if (data) setClients(data)
  }

  async function searchCompanionClients() {
    const data = await findMatchingClients(companionQuery)
    if (data) setCompanionClients(data)
  }

  async function findMatchingClients(rawQuery: string) {
    const tokens = searchTokens(rawQuery)
    if (!tokens.length) return []
    const searches = await Promise.all(tokens.map((token) => supabase
      .from('clients')
      .select('*, client_type:client_types(*)')
      .or(clientTokenFilter(token))
      .limit(100)))
    if (searches.some((result) => result.error)) return null
    const first = (searches[0].data ?? []) as Client[]
    const matchingIds = searches.slice(1).map((result) => new Set((result.data ?? []).map((client) => client.id)))
    return first
      .filter((client) => matchingIds.every((ids) => ids.has(client.id)) && matchesClientSearch(client, rawQuery))
      .slice(0, 8)
  }

  async function loadSlots() {
    const { data, error: slotError } = await supabase.rpc('get_available_slots_v2', {
      p_appointment_type_id: appointmentTypeId,
      p_date: date,
      p_duration_minutes: durationMinutes,
      p_exclude_appointment_id: appointment?.id ?? null,
    })
    if (slotError) {
      setSlots([])
      setError(slotError.message)
      return
    }
    setSlots((data ?? []) as SlotOption[])
  }

  function chooseClient(client: Client) {
    setSelectedClient(client)
    setClientQuery(`${client.first_name} ${client.last_name}`)
    setClients([])
  }

  function clearClient() {
    setSelectedClient(null)
    setClientQuery('')
  }

  function chooseCompanion(client: Client) {
    setSelectedCompanion(client)
    setCompanionQuery(`${client.first_name} ${client.last_name}`)
    setCompanionClients([])
  }

  function clearCompanion() {
    setSelectedCompanion(null)
    setCompanionQuery('')
  }

  function toggleCompanion(enabled: boolean) {
    setHasCompanion(enabled)
    const base = selectedType?.duration_minutes ?? 45
    setDurationMinutes(groupSaleDuration(enabled, base))
    setStartTime('')
    if (!enabled) {
      setSelectedCompanion(null)
      setCompanionQuery('')
      setNewCompanion(emptyClient)
    }
  }

  function validateClient() {
    if (selectedClient) return true
    if (!newClient.first_name.trim() || !newClient.last_name.trim()) return false
    if (!newClient.email.includes('@') || newClient.phone.replace(/\D/g, '').length < 8) return false
    return Boolean(newClient.client_type_id)
  }

  function validateDraft(selected: Client | null, draft: ClientDraft) {
    if (selected) return true
    return Boolean(
      draft.first_name.trim()
      && draft.last_name.trim()
      && draft.email.includes('@')
      && draft.phone.replace(/\D/g, '').length >= 8
      && draft.client_type_id,
    )
  }

  function clientPayload(selected: Client | null, draft: ClientDraft) {
    if (selected) return { existing_client_id: selected.id }
    return {
      first_name: draft.first_name.trim(),
      last_name: draft.last_name.trim(),
      email: draft.email.trim().toLowerCase(),
      phone: draft.phone.trim(),
      instagram: draft.instagram.trim().replace(/^@+/, '') || null,
      client_type_id: draft.client_type_id,
      marketing_consent: draft.marketing_consent,
      marketing_consent_source: draft.marketing_consent_source.trim() || null,
    }
  }

  function currentDraft(): AppointmentDraftState {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      clientQuery,
      selectedClient,
      newClient,
      hasCompanion,
      companionQuery,
      selectedCompanion,
      newCompanion,
      appointmentTypeId,
      date,
      startTime,
      durationMinutes,
      notes,
      allowOutOfSlot,
      allowOverbook,
      exceptionReason,
    }
  }

  function requestClose() {
    if (!isEdit && hasMeaningfulAppointmentDraft(currentDraft())
      && !window.confirm('Hay información sin guardar. ¿Deseas cerrar y descartar el borrador?')) return
    if (!isEdit) clearAppointmentDraft()
    onClose()
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!appointmentTypeId || !date || !startTime) {
      setError('Selecciona tipo de cita, fecha y horario.')
      return
    }
    if (!isEdit && !validateClient()) {
      setError('Selecciona un cliente existente o completa correctamente los datos del nuevo cliente.')
      return
    }
    if (!isEdit && hasCompanion && !validateDraft(selectedCompanion, newCompanion)) {
      setError('Selecciona la segunda persona o completa correctamente todos sus datos.')
      return
    }
    if (!isEdit && hasCompanion) {
      const primaryIdentity = selectedClient?.id ?? newClient.email.trim().toLowerCase()
      const companionIdentity = selectedCompanion?.id ?? newCompanion.email.trim().toLowerCase()
      if (primaryIdentity === companionIdentity) {
        setError('La persona principal y la segunda persona deben ser distintas.')
        return
      }
    }
    const storedExceptionReason = exceptionReason.trim()
      || ((allowOutOfSlot || allowOverbook) ? DEFAULT_EXCEPTION_REASON : null)

    setLoading(true)
    if (isEdit && appointment) {
      const { error: updateError } = await supabase.rpc('reschedule_appointment_v2', {
        p_appointment_id: appointment.id,
        p_appointment_type_id: appointmentTypeId,
        p_date: date,
        p_start_time: startTime,
        p_duration_minutes: durationMinutes,
        p_internal_notes: notes || null,
        p_allow_out_of_slot: allowOutOfSlot,
        p_allow_overbook: allowOverbook,
        p_exception_reason: storedExceptionReason,
      })
      if (updateError) setError(updateError.message)
      else onSaved('La cita fue actualizada y se programó el correo correspondiente.')
    } else if (hasCompanion) {
      const { error: createError } = await supabase.rpc('create_group_sale_appointment_v1', {
        p_primary_client: clientPayload(selectedClient, newClient),
        p_companion_client: clientPayload(selectedCompanion, newCompanion),
        p_appointment_type_id: appointmentTypeId,
        p_date: date,
        p_start_time: startTime,
        p_internal_notes: notes || null,
        p_allow_out_of_slot: allowOutOfSlot,
        p_allow_overbook: allowOverbook,
        p_exception_reason: storedExceptionReason,
      })
      if (createError) setError(createError.message)
      else {
        clearAppointmentDraft()
        onSaved('Cita para dos personas creada por 90 minutos. Ambas confirmaciones quedaron en cola.')
      }
    } else {
      const { error: createError } = await supabase.rpc('create_appointment_v2', {
        p_existing_client_id: selectedClient?.id ?? null,
        p_first_name: selectedClient ? null : newClient.first_name.trim(),
        p_last_name: selectedClient ? null : newClient.last_name.trim(),
        p_email: selectedClient ? null : newClient.email.trim().toLowerCase(),
        p_phone: selectedClient ? null : newClient.phone.trim(),
        p_instagram: selectedClient ? null : newClient.instagram.trim().replace(/^@+/, '') || null,
        p_client_type_id: selectedClient ? null : newClient.client_type_id,
        p_marketing_consent: selectedClient ? false : newClient.marketing_consent,
        p_marketing_consent_source: selectedClient ? null : newClient.marketing_consent_source.trim() || null,
        p_appointment_type_id: appointmentTypeId,
        p_date: date,
        p_start_time: startTime,
        p_duration_minutes: durationMinutes,
        p_internal_notes: notes || null,
        p_allow_out_of_slot: allowOutOfSlot,
        p_allow_overbook: allowOverbook,
        p_exception_reason: storedExceptionReason,
      })
      if (createError) setError(createError.message)
      else {
        clearAppointmentDraft()
        onSaved('La cita fue creada y el correo informativo quedó en cola.')
      }
    }
    setLoading(false)
  }

  async function saveCommercialOutcome() {
    if (!appointment) return
    if (commercialOutcome && !commercialDecisionDate) {
      setError('Selecciona la fecha efectiva de la decisión.')
      return
    }
    setLoading(true)
    setError('')
    const { error: outcomeError } = await supabase.rpc('set_appointment_commercial_outcome_v2', {
      p_appointment_id: appointment.id,
      p_outcome: commercialOutcome || null,
      p_effective_date: commercialOutcome ? commercialDecisionDate : null,
      p_notes: commercialNotes.trim() || null,
    })
    setLoading(false)
    if (outcomeError) setError(outcomeError.message)
    else {
      onSaved(commercialOutcome ? 'La decisión comercial y su fecha quedaron registradas en el historial.' : 'Se eliminó el resultado comercial actual.')
      if (commercialOutcome === 'completed_sale') {
        onCreateOrder({
          ...appointment,
          commercial_outcome: commercialOutcome,
          commercial_outcome_at: `${commercialDecisionDate}T15:00:00.000Z`,
        })
      }
    }
  }

  async function saveCompanionOutcome() {
    if (!appointment || !companion) return
    if (companionOutcome && !companionDecisionDate) {
      setError('Selecciona la fecha efectiva de la decisión de la segunda persona.')
      return
    }
    setLoading(true)
    setError('')
    const { error: outcomeError } = await supabase.rpc('set_participant_commercial_outcome_v1', {
      p_participant_id: companion.id,
      p_outcome: companionOutcome || null,
      p_effective_date: companionOutcome ? companionDecisionDate : null,
      p_notes: companionNotes.trim() || null,
    })
    setLoading(false)
    if (outcomeError) setError(outcomeError.message)
    else onSaved(companionOutcome ? 'La decisión de la segunda persona quedó registrada con su fecha.' : 'Se eliminó su resultado comercial actual.')
  }

  async function changeStatus(status: 'cancelled' | 'no_show') {
    if (!appointment) return
    const reason = status === 'cancelled' ? cancellationReason : null
    if (status === 'cancelled' && !reason?.trim()) {
      setError('Debes indicar el motivo de cancelación.')
      return
    }
    setLoading(true)
    const { error: statusError } = await supabase.rpc('change_appointment_status', {
      p_appointment_id: appointment.id,
      p_status: status,
      p_reason: reason,
    })
    setLoading(false)
    if (statusError) setError(statusError.message)
    else onSaved(status === 'cancelled' ? 'La cita fue cancelada.' : 'La cita quedó registrada como no asistida.')
  }

  async function deleteAppointment() {
    if (!appointment || profile.role !== 'admin') return
    const reason = window.prompt('Motivo de eliminación de la cita:')?.trim()
    if (!reason) return
    if (!window.confirm('La eliminación es definitiva. ¿Deseas continuar?')) return
    setLoading(true)
    const { error: deleteError } = await supabase.rpc('delete_appointment', {
      p_appointment_id: appointment.id,
      p_reason: reason,
    })
    setLoading(false)
    if (deleteError) setError(deleteError.message)
    else onSaved('La cita ingresada por error fue eliminada.')
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={requestClose}>
      <section className="modal-card modal-large" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>{isEdit ? 'Detalle y modificación de cita' : 'Nueva cita'}</h2>
            {appointment && (
              <p>
                {appointmentClientNames(appointment)} · {formatDate(appointment.appointment_date)} ·{' '}
                {formatTime(appointment.start_time)}
              </p>
            )}
          </div>
          <button className="icon-button" type="button" onClick={requestClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        <form onSubmit={handleSubmit} className="modal-body">
          {!isEdit && (
            <fieldset className="form-section">
              <legend>Cliente</legend>
              {!selectedClient ? (
                <>
                  <label>
                    Buscar por nombre, apellido, correo o teléfono
                    <input value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Buscar cliente…" />
                  </label>
                  {clients.length > 0 && (
                    <div className="search-results">
                      {clients.map((client) => (
                        <button type="button" key={client.id} onClick={() => chooseClient(client)}>
                          <strong>
                            {client.first_name} {client.last_name}
                          </strong>
                          <span>{client.email} · {client.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="section-divider"><span>o registrar un cliente nuevo</span></div>
                  <div className="form-grid two-columns">
                    <label>
                      Nombre
                      <input required={!selectedClient} value={newClient.first_name} onChange={(event) => setNewClient({ ...newClient, first_name: event.target.value })} />
                    </label>
                    <label>
                      Apellido
                      <input required={!selectedClient} value={newClient.last_name} onChange={(event) => setNewClient({ ...newClient, last_name: event.target.value })} />
                    </label>
                    <label>
                      Correo
                      <input type="email" required={!selectedClient} value={newClient.email} onChange={(event) => setNewClient({ ...newClient, email: event.target.value })} />
                    </label>
                    <label>
                      Número de contacto
                      <input required={!selectedClient} value={newClient.phone} onChange={(event) => setNewClient({ ...newClient, phone: event.target.value })} />
                    </label>
                    <label>
                      Instagram (opcional)
                      <input value={newClient.instagram} onChange={(event) => setNewClient({ ...newClient, instagram: event.target.value })} placeholder="@usuario" />
                    </label>
                    <label className="span-two">
                      Tipo de cliente
                      <select required={!selectedClient} value={newClient.client_type_id} onChange={(event) => setNewClient({ ...newClient, client_type_id: event.target.value })}>
                        <option value="">Seleccionar tipo de cliente…</option>
                        {clientTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </select>
                    </label>
                    <label className="check-row span-two">
                      <input type="checkbox" checked={newClient.marketing_consent} onChange={(event) => setNewClient({ ...newClient, marketing_consent: event.target.checked })} />
                      La cliente autoriza recibir campañas y novedades por correo
                    </label>
                    {newClient.marketing_consent && <label className="span-two">Origen de autorización<input value={newClient.marketing_consent_source} onChange={(event) => setNewClient({ ...newClient, marketing_consent_source: event.target.value })} placeholder="Ej.: autorización verbal en tienda" required /></label>}
                  </div>
                </>
              ) : (
                <div className="selected-client">
                  <div>
                    <strong>{selectedClient.first_name} {selectedClient.last_name}</strong>
                    <span>{selectedClient.email} · {selectedClient.phone}</span>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={clearClient}>Cambiar</button>
                </div>
              )}
              {selectedType?.category === 'sale' && (
                <div className="companion-section">
                  <label className="check-row companion-toggle">
                    <input type="checkbox" checked={hasCompanion} onChange={(event) => toggleCompanion(event.target.checked)} />
                    <span><strong>Agendar a dos personas</strong><small>Por ejemplo, mamá e hija. La atención ocupará automáticamente 90 minutos.</small></span>
                  </label>
                  {hasCompanion && (
                    <div className="companion-card">
                      <div className="participant-heading"><span>2</span><div><strong>Segunda persona</strong><small>Su ficha y decisión comercial serán independientes.</small></div></div>
                      {!selectedCompanion ? (
                        <>
                          <label>
                            Buscar cliente existente
                            <input value={companionQuery} onChange={(event) => setCompanionQuery(event.target.value)} placeholder="Nombre, correo o teléfono…" />
                          </label>
                          {companionClients.length > 0 && (
                            <div className="search-results">
                              {companionClients.map((client) => (
                                <button type="button" key={client.id} onClick={() => chooseCompanion(client)}>
                                  <strong>{client.first_name} {client.last_name}</strong>
                                  <span>{client.email} · {client.phone}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="section-divider"><span>o registrar la segunda persona</span></div>
                          <div className="form-grid two-columns">
                            <label>Nombre<input required value={newCompanion.first_name} onChange={(event) => setNewCompanion({ ...newCompanion, first_name: event.target.value })} /></label>
                            <label>Apellido<input required value={newCompanion.last_name} onChange={(event) => setNewCompanion({ ...newCompanion, last_name: event.target.value })} /></label>
                            <label>Correo<input type="email" required value={newCompanion.email} onChange={(event) => setNewCompanion({ ...newCompanion, email: event.target.value })} /></label>
                            <label>Número de contacto<input required value={newCompanion.phone} onChange={(event) => setNewCompanion({ ...newCompanion, phone: event.target.value })} /></label>
                            <label>Instagram (opcional)<input value={newCompanion.instagram} onChange={(event) => setNewCompanion({ ...newCompanion, instagram: event.target.value })} placeholder="@usuario" /></label>
                            <label>
                              Tipo de cliente
                              <select required value={newCompanion.client_type_id} onChange={(event) => setNewCompanion({ ...newCompanion, client_type_id: event.target.value })}>
                                <option value="">Seleccionar tipo de cliente…</option>
                                {clientTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                              </select>
                            </label>
                            <label className="check-row span-two">
                              <input type="checkbox" checked={newCompanion.marketing_consent} onChange={(event) => setNewCompanion({ ...newCompanion, marketing_consent: event.target.checked })} />
                              Autoriza recibir campañas y novedades por correo
                            </label>
                            {newCompanion.marketing_consent && <label className="span-two">Origen de autorización<input value={newCompanion.marketing_consent_source} onChange={(event) => setNewCompanion({ ...newCompanion, marketing_consent_source: event.target.value })} placeholder="Ej.: autorización verbal en tienda" required /></label>}
                          </div>
                        </>
                      ) : (
                        <div className="selected-client">
                          <div><strong>{selectedCompanion.first_name} {selectedCompanion.last_name}</strong><span>{selectedCompanion.email} · {selectedCompanion.phone}</span></div>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={clearCompanion}>Cambiar</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </fieldset>
          )}

          {appointment && appointment.participants?.length ? (
            <fieldset className="form-section">
              <legend>Personas de esta cita</legend>
              <div className="participant-summary-grid">
                <div className="participant-summary"><span>1</span><div><strong>{appointment.client?.first_name} {appointment.client?.last_name}</strong><small>{appointment.client?.email} · {appointment.client?.phone}</small></div></div>
                {appointment.participants.map((participant) => (
                  <div className="participant-summary" key={participant.id}><span>{participant.position}</span><div><strong>{participant.client?.first_name} {participant.client?.last_name}</strong><small>{participant.client?.email} · {participant.client?.phone}</small></div></div>
                ))}
              </div>
              <p className="form-help">Ambas comparten el mismo horario. Reprogramar o cancelar aplica a la cita completa.</p>
            </fieldset>
          ) : null}

          <fieldset className="form-section">
            <legend>Cita</legend>
            <div className="form-grid two-columns">
              <label>
                Tipo de cita
                <select value={appointmentTypeId} onChange={(event) => {
                  const typeId = event.target.value
                  const nextType = types.find((type) => type.id === typeId)
                  setAppointmentTypeId(typeId)
                  if (nextType?.category !== 'sale') {
                    setHasCompanion(false)
                    setSelectedCompanion(null)
                    setCompanionQuery('')
                    setNewCompanion(emptyClient)
                  }
                  setDurationMinutes(groupSaleDuration(hasCompanion && nextType?.category === 'sale', nextType?.duration_minutes ?? 45))
                  setStartTime('')
                }} required>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>{type.name} ({type.duration_minutes} min)</option>
                  ))}
                </select>
              </label>
              <label>
                Duración
                <select value={durationMinutes} onChange={(event) => { setDurationMinutes(Number(event.target.value)); setStartTime('') }} disabled={hasCompanion}>
                  {selectedType && Array.from(
                    { length: Math.floor((Math.max(maxDuration, selectedType.duration_minutes) - selectedType.duration_minutes) / durationStep) + 1 },
                    (_, index) => selectedType.duration_minutes + index * durationStep,
                  ).map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos{minutes > selectedType.duration_minutes ? ' · extendida' : ''}</option>)}
                </select>
                {hasCompanion && <small>Fijada en 90 minutos para atender a ambas personas.</small>}
              </label>
              <label>
                Fecha
                <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setStartTime('') }} required />
              </label>
              <label>
                Horario
                <select value={startTime} onChange={(event) => setStartTime(event.target.value)} required={!allowOutOfSlot}>
                  <option value="">Seleccionar horario</option>
                  {slots.map((slot) => (
                    <option key={slot.start_time} value={slot.start_time.slice(0, 5)} disabled={!slot.available && !allowOverbook}>
                      {formatTime(slot.start_time)}–{formatTime(slot.end_time)} {slot.available ? '' : `(${slot.reason ?? 'No disponible'})`}
                    </option>
                  ))}
                </select>
              </label>
              {allowOutOfSlot && (
                <label>
                  Hora excepcional
                  <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
                </label>
              )}
              <label className="span-two">
                Observación interna
                <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Esta información no se envía al cliente." />
              </label>
            </div>
            {profile.role === 'admin' && (
              <div className="exception-box">
                <label className="check-row">
                  <input type="checkbox" checked={allowOutOfSlot} onChange={(event) => setAllowOutOfSlot(event.target.checked)} />
                  Permitir reserva fuera de bloque
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={allowOverbook} onChange={(event) => setAllowOverbook(event.target.checked)} />
                  Autorizar sobrecupo
                </label>
                {(allowOutOfSlot || allowOverbook) && (
                  <label>
                    Comentario de la excepción (opcional)
                    <input value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} placeholder="Agrega un contexto si es necesario" />
                  </label>
                )}
              </div>
            )}
          </fieldset>

          {appointment && selectedType?.category === 'sale' && appointment.status !== 'cancelled' && appointment.status !== 'no_show' && (
            <fieldset className="form-section">
              <legend>Decisión de la venta</legend>
              {appointment.participants?.length ? <h3>{appointment.client?.first_name} {appointment.client?.last_name} · persona principal</h3> : null}
              <p className="form-help">Puede registrarse al terminar la cita o actualizarse días después. Cada cambio conserva su fecha efectiva y trazabilidad.</p>
              <div className="form-grid two-columns">
                <label>
                  Estado comercial
                  <select value={commercialOutcome} onChange={(event) => {
                    const next = event.target.value as CommercialOutcome | ''
                    setCommercialOutcome(next)
                    if (next !== appointment.commercial_outcome) setCommercialDecisionDate(chileIsoDate())
                  }}>
                    <option value="">Sin resultado</option>
                    <option value="potential_sale">Pendiente de decisión</option>
                    <option value="completed_sale">Venta aceptada</option>
                    <option value="rejected_sale">Venta rechazada</option>
                  </select>
                </label>
                {commercialOutcome && (
                  <label>
                    Fecha efectiva de la decisión
                    <input
                      type="date"
                      min={appointment.appointment_date}
                      max={chileIsoDate()}
                      value={commercialDecisionDate}
                      onChange={(event) => setCommercialDecisionDate(event.target.value)}
                      required
                    />
                  </label>
                )}
                {commercialOutcome && (
                  <label className="span-two">
                    Nota comercial (opcional)
                    <input value={commercialNotes} onChange={(event) => setCommercialNotes(event.target.value)} placeholder="Ej.: confirmó por WhatsApp" />
                  </label>
                )}
                <div className="action-row align-end"><button type="button" className="btn btn-primary" disabled={loading} onClick={() => void saveCommercialOutcome()}>Guardar decisión</button></div>
              </div>
              {appointment.commercial_outcome && appointment.commercial_outcome_at && (
                <div className="alert alert-info">
                  Estado actual: <strong>{commercialDecisionLabel(appointment.commercial_outcome, chileIsoDate(appointment.commercial_outcome_at), appointment.appointment_date)}</strong>.
                </div>
              )}
              {commercialHistory.length > 0 && (
                <div>
                  <h3>Historial de decisiones</h3>
                  <ul className="simple-list">
                    {commercialHistory.map((item) => (
                      <li key={item.id}>
                        <strong>{item.new_outcome && item.effective_date ? commercialDecisionLabel(item.new_outcome, item.effective_date, appointment.appointment_date) : 'Resultado eliminado'}</strong>
                        <span>{new Date(item.changed_at).toLocaleString('es-CL')}{item.notes ? ` · ${item.notes}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {appointment.commercial_outcome === 'completed_sale' && (
                <div className="alert alert-success order-cta">
                  <span>{appointment.order_id ? 'Esta venta ya está registrada.' : 'Venta aceptada lista para registrar.'}</span>
                  <button type="button" className="btn btn-primary" onClick={() => onCreateOrder(appointment)}>{appointment.order_id ? 'Ver venta' : 'Registrar venta'}</button>
                </div>
              )}
            </fieldset>
          )}

          {appointment && companion?.client && selectedType?.category === 'sale' && appointment.status !== 'cancelled' && appointment.status !== 'no_show' && (
            <fieldset className="form-section participant-decision">
              <legend>Decisión de la segunda persona</legend>
              <h3>{companion.client.first_name} {companion.client.last_name}</h3>
              <p className="form-help">Su decisión se registra de manera independiente, aunque haya asistido en el mismo horario.</p>
              <div className="form-grid two-columns">
                <label>
                  Estado comercial
                  <select value={companionOutcome} onChange={(event) => {
                    const next = event.target.value as CommercialOutcome | ''
                    setCompanionOutcome(next)
                    if (next !== companion.commercial_outcome) setCompanionDecisionDate(chileIsoDate())
                  }}>
                    <option value="">Sin resultado</option>
                    <option value="potential_sale">Pendiente de decisión</option>
                    <option value="completed_sale">Venta aceptada</option>
                    <option value="rejected_sale">Venta rechazada</option>
                  </select>
                </label>
                {companionOutcome && (
                  <label>
                    Fecha efectiva de la decisión
                    <input type="date" min={appointment.appointment_date} max={chileIsoDate()} value={companionDecisionDate} onChange={(event) => setCompanionDecisionDate(event.target.value)} required />
                  </label>
                )}
                {companionOutcome && <label className="span-two">Nota comercial (opcional)<input value={companionNotes} onChange={(event) => setCompanionNotes(event.target.value)} placeholder="Ej.: confirmó por WhatsApp" /></label>}
                <div className="action-row align-end"><button type="button" className="btn btn-primary" disabled={loading} onClick={() => void saveCompanionOutcome()}>Guardar decisión</button></div>
              </div>
              {companion.commercial_outcome && companion.commercial_outcome_at && (
                <div className="alert alert-info">Estado actual: <strong>{commercialDecisionLabel(companion.commercial_outcome, chileIsoDate(companion.commercial_outcome_at), appointment.appointment_date)}</strong>.</div>
              )}
              {companionHistory.length > 0 && (
                <div><h3>Historial de decisiones</h3><ul className="simple-list">{companionHistory.map((item) => (
                  <li key={item.id}><strong>{item.new_outcome && item.effective_date ? commercialDecisionLabel(item.new_outcome, item.effective_date, appointment.appointment_date) : 'Resultado eliminado'}</strong><span>{new Date(item.changed_at).toLocaleString('es-CL')}{item.notes ? ` · ${item.notes}` : ''}</span></li>
                ))}</ul></div>
              )}
              {companion.commercial_outcome === 'completed_sale' && !companion.order_id && (
                <div className="alert alert-success">Venta aceptada. Puedes registrarla desde el módulo Ventas seleccionando a {companion.client.first_name}.</div>
              )}
            </fieldset>
          )}

          {appointment && appointment.status !== 'cancelled' && (
            <fieldset className="form-section danger-zone">
              <legend>Otras acciones</legend>
              <div className="form-grid two-columns">
                <label>
                  Motivo de cancelación
                  <select value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)}>
                    <option>Solicitud del cliente</option>
                    <option>Problema de traslado</option>
                    <option>Cierre de Casona Malú</option>
                    <option>Error de agendamiento</option>
                    <option>Duplicidad</option>
                    <option>Fuerza mayor</option>
                    <option>Otro</option>
                  </select>
                </label>
                <div className="action-row align-end">
                  <button type="button" className="btn btn-warning" disabled={loading} onClick={() => void changeStatus('no_show')}>Marcar no asistió</button>
                  <button type="button" className="btn btn-danger" disabled={loading} onClick={() => void changeStatus('cancelled')}>Cancelar cita</button>
                </div>
              </div>
              {profile.role === 'admin' && (
                <button type="button" className="link-danger" onClick={() => void deleteAppointment()} disabled={loading}>
                  Eliminar cita creada por error
                </button>
              )}
            </fieldset>
          )}

          {selectedType && <p className="form-help">Duración base: {selectedType.duration_minutes} minutos. Esta reserva ocupará {durationMinutes} minutos continuos. Las citas extendidas siguen contando como una cita para el límite diario.</p>}
          {error && <div className="alert alert-danger">{error}</div>}
          <footer className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={requestClose}>Cerrar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear cita'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
