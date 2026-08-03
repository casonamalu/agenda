import { FormEvent, useEffect, useMemo, useState } from 'react'
import { formatDate, formatTime } from '../lib/date'
import { supabase } from '../lib/supabase'
import type { Appointment, AppointmentType, Client, ClientType, CommercialOutcome, Profile } from '../types'

interface SlotOption {
  start_time: string
  end_time: string
  available: boolean
  reason: string | null
  regular_slot: boolean
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isEdit = Boolean(appointment)
  const selectedType = useMemo(
    () => types.find((type) => type.id === appointmentTypeId) ?? null,
    [appointmentTypeId, types],
  )

  useEffect(() => {
    if (!open) return
    void loadCatalogs()
  }, [open])

  useEffect(() => {
    if (!open) return
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
    setSelectedClient(appointment?.client ?? null)
    setNewClient(emptyClient)
  }, [appointment, initialDate, open])

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
    setNewClient((current) => ({
      ...current,
      client_type_id: current.client_type_id || customerTypes[0]?.id || '',
    }))
  }

  async function searchClients() {
    const query = clientQuery.trim().replace(/[,%()]/g, '')
    const { data, error: searchError } = await supabase
      .from('clients')
      .select('*, client_type:client_types(*)')
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%,instagram.ilike.%${query.replace(/^@/, '')}%`)
      .limit(8)
    if (!searchError) setClients((data ?? []) as Client[])
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

  function validateClient() {
    if (selectedClient) return true
    if (!newClient.first_name.trim() || !newClient.last_name.trim()) return false
    if (!newClient.email.includes('@') || newClient.phone.replace(/\D/g, '').length < 8) return false
    return Boolean(newClient.client_type_id)
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
    if ((allowOutOfSlot || allowOverbook) && !exceptionReason.trim()) {
      setError('Debes indicar el motivo de la excepción.')
      return
    }

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
        p_exception_reason: exceptionReason || null,
      })
      if (updateError) setError(updateError.message)
      else onSaved('La cita fue actualizada y se programó el correo correspondiente.')
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
        p_exception_reason: exceptionReason || null,
      })
      if (createError) setError(createError.message)
      else onSaved('La cita fue creada y el correo informativo quedó en cola.')
    }
    setLoading(false)
  }

  async function saveCommercialOutcome() {
    if (!appointment) return
    setLoading(true)
    setError('')
    const { error: outcomeError } = await supabase.rpc('set_appointment_commercial_outcome', {
      p_appointment_id: appointment.id,
      p_outcome: commercialOutcome || null,
    })
    setLoading(false)
    if (outcomeError) setError(outcomeError.message)
    else {
      onSaved(commercialOutcome ? 'El resultado comercial quedó registrado y auditado.' : 'Se eliminó el resultado comercial.')
      if (commercialOutcome === 'completed_sale') onCreateOrder({ ...appointment, commercial_outcome: commercialOutcome })
    }
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
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-card modal-large" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>{isEdit ? 'Detalle y modificación de cita' : 'Nueva cita'}</h2>
            {appointment && (
              <p>
                {appointment.client?.first_name} {appointment.client?.last_name} · {formatDate(appointment.appointment_date)} ·{' '}
                {formatTime(appointment.start_time)}
              </p>
            )}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">
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
            </fieldset>
          )}

          <fieldset className="form-section">
            <legend>Cita</legend>
            <div className="form-grid two-columns">
              <label>
                Tipo de cita
                <select value={appointmentTypeId} onChange={(event) => {
                  const typeId = event.target.value
                  const nextType = types.find((type) => type.id === typeId)
                  setAppointmentTypeId(typeId)
                  setDurationMinutes(nextType?.duration_minutes ?? 45)
                  setStartTime('')
                }} required>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>{type.name} ({type.duration_minutes} min)</option>
                  ))}
                </select>
              </label>
              <label>
                Duración
                <select value={durationMinutes} onChange={(event) => { setDurationMinutes(Number(event.target.value)); setStartTime('') }}>
                  {selectedType && Array.from(
                    { length: Math.floor((Math.max(maxDuration, selectedType.duration_minutes) - selectedType.duration_minutes) / durationStep) + 1 },
                    (_, index) => selectedType.duration_minutes + index * durationStep,
                  ).map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos{minutes > selectedType.duration_minutes ? ' · extendida' : ''}</option>)}
                </select>
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
                    Motivo obligatorio de la excepción
                    <input value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} required />
                  </label>
                )}
              </div>
            )}
          </fieldset>

          {appointment && selectedType?.category === 'sale' && appointment.status !== 'cancelled' && appointment.status !== 'no_show' && (
            <fieldset className="form-section">
              <legend>Resultado de la cita de Venta</legend>
              <p className="form-help">Regístralo una vez iniciada la cita. Este dato alimenta la efectividad comercial de Indicadores.</p>
              <div className="form-grid two-columns">
                <label>
                  Resultado comercial
                  <select value={commercialOutcome} onChange={(event) => setCommercialOutcome(event.target.value as CommercialOutcome | '')}>
                    <option value="">Sin resultado</option>
                    <option value="completed_sale">Venta concretada</option>
                    <option value="rejected_sale">Venta rechazada</option>
                    <option value="potential_sale">Posible venta</option>
                  </select>
                </label>
                <div className="action-row align-end"><button type="button" className="btn btn-primary" disabled={loading} onClick={() => void saveCommercialOutcome()}>Guardar resultado</button></div>
              </div>
              {appointment.commercial_outcome === 'completed_sale' && (
                <div className="alert alert-success order-cta">
                  <span>{appointment.order_id ? 'Esta venta ya tiene un pedido vinculado.' : 'Venta concretada lista para convertirse en pedido.'}</span>
                  <button type="button" className="btn btn-primary" onClick={() => onCreateOrder(appointment)}>{appointment.order_id ? 'Ver pedido' : 'Crear pedido'}</button>
                </div>
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
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear cita'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
