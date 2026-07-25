import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AppointmentSlot, AppointmentType, ClientType, Closure } from '../types'

interface EmailTemplate {
  id: string
  template_key: string
  name: string
  subject: string
  body_html: string
  active: boolean
}

interface Props {
  refreshToken: number
  onChanged: (message: string) => void
}

type Tab = 'appointment-types' | 'client-types' | 'slots' | 'closures' | 'templates'

const weekdayLabels: Record<number, string> = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' }

export function Settings({ refreshToken, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('appointment-types')
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([])
  const [clientTypes, setClientTypes] = useState<ClientType[]>([])
  const [slots, setSlots] = useState<AppointmentSlot[]>([])
  const [closures, setClosures] = useState<Closure[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [error, setError] = useState('')

  useEffect(() => { void loadAll() }, [refreshToken])

  async function loadAll() {
    const [typesResult, clientTypesResult, slotsResult, closuresResult, templatesResult] = await Promise.all([
      supabase.from('appointment_types').select('*').order('sort_order'),
      supabase.from('client_types').select('*').order('display_order'),
      supabase.from('appointment_slots').select('*').order('weekday').order('start_time'),
      supabase.from('closures').select('*').order('start_date', { ascending: false }),
      supabase.from('email_templates').select('*').order('name'),
    ])
    setAppointmentTypes((typesResult.data ?? []) as AppointmentType[])
    setClientTypes((clientTypesResult.data ?? []) as ClientType[])
    setSlots((slotsResult.data ?? []) as AppointmentSlot[])
    setClosures((closuresResult.data ?? []) as Closure[])
    setTemplates((templatesResult.data ?? []) as EmailTemplate[])
  }

  async function saveAppointmentType(type: AppointmentType) {
    const { error: updateError } = await supabase.from('appointment_types').update({
      name: type.name,
      duration_minutes: type.duration_minutes,
      color: type.color,
      capacity_per_slot: type.capacity_per_slot,
      active: type.active,
    }).eq('id', type.id)
    if (updateError) setError(updateError.message)
    else { await loadAll(); onChanged('Tipo de cita actualizado.') }
  }

  async function saveClientType(type: ClientType) {
    const { error: updateError } = await supabase.from('client_types').update({ name: type.name, active: type.active }).eq('id', type.id)
    if (updateError) setError(updateError.message)
    else { await loadAll(); onChanged('Tipo de cliente actualizado.') }
  }

  async function addClientType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    if (!name) return
    const { error: insertError } = await supabase.from('client_types').insert({ name, display_order: clientTypes.length + 1 })
    if (insertError) setError(insertError.message)
    else { event.currentTarget.reset(); await loadAll(); onChanged('Tipo de cliente agregado.') }
  }

  async function addSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const typeId = String(form.get('appointment_type_id'))
    const weekday = Number(form.get('weekday'))
    const startTime = String(form.get('start_time'))
    const { error: insertError } = await supabase.from('appointment_slots').insert({ appointment_type_id: typeId, weekday, start_time: startTime })
    if (insertError) setError(insertError.message)
    else { event.currentTarget.reset(); await loadAll(); onChanged('Bloque horario agregado.') }
  }

  async function deleteSlot(id: string) {
    if (!window.confirm('¿Eliminar este bloque horario?')) return
    const { error: deleteError } = await supabase.from('appointment_slots').delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
    else { await loadAll(); onChanged('Bloque horario eliminado.') }
  }

  async function addClosure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      name: String(form.get('name')),
      closure_type: String(form.get('closure_type')),
      start_date: String(form.get('start_date')),
      end_date: String(form.get('end_date')),
      all_day: form.get('all_day') === 'on',
      start_time: form.get('all_day') === 'on' ? null : String(form.get('start_time') || null),
      end_time: form.get('all_day') === 'on' ? null : String(form.get('end_time') || null),
      notes: String(form.get('notes') || '') || null,
    }
    const { error: insertError } = await supabase.from('closures').insert(payload)
    if (insertError) setError(insertError.message)
    else { event.currentTarget.reset(); await loadAll(); onChanged('Cierre registrado.') }
  }

  async function deleteClosure(id: string) {
    if (!window.confirm('¿Eliminar este cierre?')) return
    const { error: deleteError } = await supabase.from('closures').delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
    else { await loadAll(); onChanged('Cierre eliminado.') }
  }

  async function saveTemplate(template: EmailTemplate) {
    const { error: updateError } = await supabase.from('email_templates').update({
      subject: template.subject,
      body_html: template.body_html,
      active: template.active,
    }).eq('id', template.id)
    if (updateError) setError(updateError.message)
    else { await loadAll(); onChanged('Plantilla de correo actualizada.') }
  }

  const slotTypeName = (id: string) => appointmentTypes.find((type) => type.id === id)?.name ?? 'Sin tipo'

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Mantenedores</h1><p>Configuración funcional de la agenda.</p></div></div>
      <div className="tabs">
        <button className={tab === 'appointment-types' ? 'active' : ''} onClick={() => setTab('appointment-types')}>Tipos de cita</button>
        <button className={tab === 'client-types' ? 'active' : ''} onClick={() => setTab('client-types')}>Tipos de cliente</button>
        <button className={tab === 'slots' ? 'active' : ''} onClick={() => setTab('slots')}>Bloques</button>
        <button className={tab === 'closures' ? 'active' : ''} onClick={() => setTab('closures')}>Feriados y cierres</button>
        <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>Correos</button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      {tab === 'appointment-types' && (
        <div className="settings-list">
          {appointmentTypes.map((type, index) => (
            <article className="settings-card" key={type.id}>
              <div className="form-grid four-columns">
                <label>Nombre<input value={type.name} onChange={(event) => setAppointmentTypes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label>
                <label>Duración (min)<input type="number" min="5" value={type.duration_minutes} onChange={(event) => setAppointmentTypes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, duration_minutes: Number(event.target.value) } : item))} /></label>
                <label>Capacidad simultánea<input type="number" min="1" value={type.capacity_per_slot} onChange={(event) => setAppointmentTypes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, capacity_per_slot: Number(event.target.value) } : item))} /></label>
                <label>Color<input type="color" value={type.color} onChange={(event) => setAppointmentTypes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value } : item))} /></label>
              </div>
              <label className="check-row"><input type="checkbox" checked={type.active} onChange={(event) => setAppointmentTypes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} />Activo</label>
              <button className="btn btn-primary btn-sm" type="button" onClick={() => void saveAppointmentType(type)}>Guardar</button>
            </article>
          ))}
        </div>
      )}

      {tab === 'client-types' && (
        <div className="settings-list">
          <form className="settings-card inline-form" onSubmit={addClientType}><label>Nuevo tipo de cliente<input name="name" required /></label><button className="btn btn-primary" type="submit">Agregar</button></form>
          {clientTypes.map((type, index) => (
            <article className="settings-card inline-form" key={type.id}>
              <label>Nombre<input value={type.name} onChange={(event) => setClientTypes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label>
              <label className="check-row"><input type="checkbox" checked={type.active} onChange={(event) => setClientTypes((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} />Activo</label>
              <button className="btn btn-primary btn-sm" type="button" onClick={() => void saveClientType(type)}>Guardar</button>
            </article>
          ))}
        </div>
      )}

      {tab === 'slots' && (
        <div className="settings-list">
          <form className="settings-card form-grid three-columns" onSubmit={addSlot}>
            <label>Tipo de cita<select name="appointment_type_id" required>{appointmentTypes.filter((type) => type.active).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <label>Día<select name="weekday" required>{Object.entries(weekdayLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Hora<input name="start_time" type="time" required /></label>
            <button className="btn btn-primary" type="submit">Agregar bloque</button>
          </form>
          <div className="table-card"><table><thead><tr><th>Tipo</th><th>Día</th><th>Hora</th><th /></tr></thead><tbody>{slots.map((slot) => <tr key={slot.id}><td>{slotTypeName(slot.appointment_type_id)}</td><td>{weekdayLabels[slot.weekday]}</td><td>{slot.start_time.slice(0, 5)}</td><td><button className="btn btn-danger btn-sm" type="button" onClick={() => void deleteSlot(slot.id)}>Eliminar</button></td></tr>)}</tbody></table></div>
        </div>
      )}

      {tab === 'closures' && (
        <div className="settings-list">
          <form className="settings-card" onSubmit={addClosure}>
            <div className="form-grid three-columns">
              <label>Nombre<input name="name" required /></label>
              <label>Tipo<select name="closure_type"><option value="legal_holiday">Feriado legal</option><option value="special_closure">Cierre especial</option><option value="vacation">Vacaciones</option><option value="internal_activity">Actividad interna</option></select></label>
              <label className="check-row align-end"><input name="all_day" type="checkbox" defaultChecked />Día completo</label>
              <label>Fecha inicio<input name="start_date" type="date" required /></label>
              <label>Fecha término<input name="end_date" type="date" required /></label>
              <label>Hora inicio<input name="start_time" type="time" /></label>
              <label>Hora término<input name="end_time" type="time" /></label>
              <label className="span-two">Observaciones<input name="notes" /></label>
            </div>
            <button className="btn btn-primary" type="submit">Registrar cierre</button>
          </form>
          <div className="table-card"><table><thead><tr><th>Nombre</th><th>Período</th><th>Tipo</th><th /></tr></thead><tbody>{closures.map((closure) => <tr key={closure.id}><td>{closure.name}</td><td>{closure.start_date} — {closure.end_date}</td><td>{closure.closure_type}</td><td><button className="btn btn-danger btn-sm" type="button" onClick={() => void deleteClosure(closure.id)}>Eliminar</button></td></tr>)}</tbody></table></div>
        </div>
      )}

      {tab === 'templates' && (
        <div className="settings-list">
          <div className="alert alert-info">Variables disponibles: {'{{nombre}}'}, {'{{apellido}}'}, {'{{tipo_cita}}'}, {'{{fecha}}'}, {'{{hora}}'}, {'{{direccion}}'}, {'{{telefono}}'}, {'{{instagram}}'}, {'{{correo_contacto}}'}.</div>
          {templates.map((template, index) => (
            <article className="settings-card" key={template.id}>
              <h2>{template.name}</h2>
              <label>Asunto<input value={template.subject} onChange={(event) => setTemplates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, subject: event.target.value } : item))} /></label>
              <label>Contenido HTML<textarea rows={8} value={template.body_html} onChange={(event) => setTemplates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, body_html: event.target.value } : item))} /></label>
              <label className="check-row"><input type="checkbox" checked={template.active} onChange={(event) => setTemplates((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.checked } : item))} />Activa</label>
              <button className="btn btn-primary btn-sm" type="button" onClick={() => void saveTemplate(template)}>Guardar plantilla</button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
