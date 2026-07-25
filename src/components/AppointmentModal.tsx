import { FormEvent, useEffect, useMemo, useState } from 'react'
import { formatDate, formatTime } from '../lib/date'
import { supabase } from '../lib/supabase'
import type { Appointment, AppointmentType, Client, ClientType, Profile } from '../types'

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
}

const emptyClient = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '+56',
  client_type_id: '',
}

export function AppointmentModal({ open, profile, appointment, initialDate, onClose, onSaved }: Props) {
  const [types, setTypes] = useState<AppointmentType[]>([])
  const [clientTypes, setClientTypes] = useState<ClientType[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [clientQuery, setClientQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [newClient, setNewClient] = useState(emptyClient)
  const [appointmentTypeId, setAppointmentTypeId] = useState('')
  const [date, setDate] = useState(initialDate)
  const [startTime, setStartTime] = useState('')
  const [notes, setNotes] = useState('')
  const [slots, setSlots] = useState<SlotOption[]>([])
  const [allowOutOfSlot, setAllowOutOfSlot] = useState(false)
  const [allowOverbook, setAllowOverbook] = useState(false)
  const [exceptionReason, setExceptionReason] = useState('')
  const [cancellationReason, setCancellationReason] = useState('Solicitud del cliente')
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
    setSelectedClient(appointment?.client ?? null)
    setNewClient(emptyClient)
  }, [appointment, initialDate, open])

  useEffect(() => {
    if (!open || !appointmentTypeId || !date) return
    void loadSlots()
  }, [appointmentTypeId, date, open, allowOverbook])

  useEffect(() => {
    if (!clientQuery.trim() || selectedClient || isEdit) {
      setClients([])
      return
    }
    const timer = window.setTimeout(() => void searchClients(), 250)
    return () => window.clearTimeout(timer)
  }, [clientQuery, selectedClient, isEdit])

  async function loadCatalogs() {
    const [{ data: typeData }, { data: clientTypeData }] = await Promise.all([
      supabase.from('appointment_types').select('*').eq('active', true).order('sort_order'),
      supabase.from('client_types').select('*').eq('active', true).order('display_order'),
    ])
    const appointmentTypes = (typeData ?? []) as AppointmentType[]
    const customerTypes = (clientTypeData ?? []) as ClientType[]
    setTypes(appointmentTypes)
    setClientTypes(customerTypes)
    setAppointmentTypeId((current) => current || appointmentTypes[0]?.id || '')
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
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
      .limit(8)
    if (!searchError) setClients((data ?? []) as Client[])
  }

  async function loadSlots() {
    const { data, error: slotError } = await supabase.rpc('get_available_slots', {
      p_appointment_type_id: appointmentTypeId,
      p_date: date,
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
      const { error: updateError } = await supabase.rpc('reschedule_appointment', {
        p_appointment_id: appointment.id,
        p_appointment_type_id: appointmentTypeId,
        p_date: date,
        p_start_time: startTime,
        p_internal_notes: notes || null,
        p_allow_out_of_slot: allowOutOfSlot,
        p_allow_overbook: allowOverbook,
        p_exception_reason: exceptionReason || null,
      })
      if (updateError) setError(updateError.message)
      else onSaved('La cita fue actualizada y se programó el correo correspondiente.')
    } else {
      const { error: createError } = await supabase.rpc('create_appointment', {
        p_existing_client_id: selectedClient?.id ?? null,
        p_first_name: selectedClient ? null : newClient.first_name.trim(),
        p_last_name: selectedClient ? null : newClient.last_name.trim(),
        p_email: selectedClient ? null : newClient.email.trim().toLowerCase(),
        p_phone: selectedClient ? null : newClient.phone.trim(),
        p_client_type_id: selectedClient ? null : newClient.client_type_id,
        p_appointment_type_id: appointmentTypeId,
        p_date: date,
        p_start_time: startTime,
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
                    <label className="span-two">
                      Tipo de cliente
                      <select required={!selectedClient} value={newClient.client_type_id} onChange={(event) => setNewClient({ ...newClient, client_type_id: event.target.value })}>
                        {clientTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </select>
                    </label>
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
                <select value={appointmentTypeId} onChange={(event) => { setAppointmentTypeId(event.target.value); setStartTime('') }} required>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>{type.name} ({type.duration_minutes} min)</option>
                  ))}
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

          {selectedType && <p className="form-help">Duración configurada: {selectedType.duration_minutes} minutos. El sistema valida el espacio compartido y el límite diario.</p>}
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
