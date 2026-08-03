import { useEffect, useMemo, useState } from 'react'
import { formatDate, formatTime, toIsoDate } from '../lib/date'
import { formatClp, productionRouteLabels } from '../lib/operations'
import { supabase } from '../lib/supabase'
import type { Appointment, AppointmentType, Client, CommercialProductType, ProductionRoute, Profile, SellerProductCommission } from '../types'

interface SlotOption {
  start_time: string
  end_time: string
  available: boolean
  reason: string | null
}

interface ScheduledAppointment {
  appointment_type_id: string
  date: string
  start_time: string
  duration_minutes: number
  internal_notes: string | null
}

interface Props {
  profile: Profile
  clients: Client[]
  appointments: Appointment[]
  appointmentTypes: AppointmentType[]
  sellers: Profile[]
  productTypes: CommercialProductType[]
  commissions: SellerProductCommission[]
  initialAppointmentId: string | null
  onCancel: () => void
  onCreated: (orderId: string, message: string) => void
  onError: (message: string) => void
}

const today = () => toIsoDate(new Date())

export function OrderWizard({
  profile,
  clients,
  appointments,
  appointmentTypes,
  sellers,
  productTypes,
  commissions,
  initialAppointmentId,
  onCancel,
  onCreated,
  onError,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)
  const [clientId, setClientId] = useState('')
  const [sourceAppointmentId, setSourceAppointmentId] = useState('')
  const [sellerId, setSellerId] = useState(profile.id)
  const [productTypeId, setProductTypeId] = useState('')
  const [productionRoute, setProductionRoute] = useState<ProductionRoute>('stock_adjustments')
  const [productName, setProductName] = useState('')
  const [designDescription, setDesignDescription] = useState('')
  const [saleDate, setSaleDate] = useState(today)
  const [eventDate, setEventDate] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [grossAmount, setGrossAmount] = useState('0')
  const [discountAmount, setDiscountAmount] = useState('0')
  const [plannedHours, setPlannedHours] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [scheduleTypeId, setScheduleTypeId] = useState('')
  const [scheduleDate, setScheduleDate] = useState(today)
  const [scheduleDuration, setScheduleDuration] = useState(30)
  const [scheduleNotes, setScheduleNotes] = useState('')
  const [slots, setSlots] = useState<SlotOption[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [scheduled, setScheduled] = useState<ScheduledAppointment[]>([])

  const saleAppointments = useMemo(
    () => appointments.filter((item) => item.appointment_type?.category === 'sale' && item.commercial_outcome === 'completed_sale' && !item.order_id),
    [appointments],
  )
  const schedulableTypes = useMemo(
    () => appointmentTypes.filter((item) => item.active && (item.category === 'trial' || item.category === 'delivery')),
    [appointmentTypes],
  )
  const selectedClient = clients.find((item) => item.id === clientId)
  const selectedProductType = productTypes.find((item) => item.id === productTypeId)
  const selectedSeller = sellers.find((item) => item.id === sellerId)
  const selectedScheduleType = schedulableTypes.find((item) => item.id === scheduleTypeId)
  const commissionRate = Number(commissions.find((item) => item.seller_id === sellerId && item.product_type_id === productTypeId)?.commission_rate ?? 0)
  const finalAmount = Math.max(0, Number(grossAmount || 0) - Number(discountAmount || 0))

  useEffect(() => {
    const source = saleAppointments.find((item) => item.id === initialAppointmentId)
    if (!source) return
    setSourceAppointmentId(source.id)
    setClientId(source.client_id)
    setSaleDate(source.appointment_date)
  }, [initialAppointmentId, saleAppointments])

  useEffect(() => {
    if (productTypeId || !productTypes.length) return
    setProductTypeId(productTypes[0].id)
  }, [productTypeId, productTypes])

  useEffect(() => {
    if (scheduleTypeId || !schedulableTypes.length) return
    setScheduleTypeId(schedulableTypes[0].id)
    setScheduleDuration(schedulableTypes[0].duration_minutes)
  }, [scheduleTypeId, schedulableTypes])

  useEffect(() => {
    if (!scheduleTypeId || !scheduleDate || !scheduleDuration) return
    let cancelled = false
    async function loadSlots() {
      setSlotsLoading(true)
      const { data, error } = await supabase.rpc('get_available_slots_v2', {
        p_appointment_type_id: scheduleTypeId,
        p_date: scheduleDate,
        p_duration_minutes: scheduleDuration,
        p_exclude_appointment_id: null,
      })
      if (!cancelled) {
        setSlotsLoading(false)
        if (error) onError(error.message)
        else setSlots((data ?? []) as SlotOption[])
      }
    }
    void loadSlots()
    return () => { cancelled = true }
  }, [scheduleDate, scheduleDuration, scheduleTypeId])

  function chooseSource(value: string) {
    setSourceAppointmentId(value)
    const source = saleAppointments.find((item) => item.id === value)
    if (source) {
      setClientId(source.client_id)
      setSaleDate(source.appointment_date)
    }
  }

  function validateOrder() {
    if (!clientId || !sellerId || !productTypeId || !productName.trim()) {
      onError('Completa cliente, vendedora, tipo de producto y producto.')
      return false
    }
    if (Number(grossAmount) < 0 || Number(discountAmount) < 0 || Number(discountAmount) > Number(grossAmount)) {
      onError('El descuento no puede superar el valor de venta.')
      return false
    }
    return true
  }

  function addSchedule(startTime: string) {
    if (!scheduleTypeId || !scheduleDate) return
    const duplicate = scheduled.some((item) => item.appointment_type_id === scheduleTypeId && item.date === scheduleDate && item.start_time === startTime)
    if (duplicate) {
      onError('Ese horario ya está agregado al pedido.')
      return
    }
    setScheduled((items) => [...items, {
      appointment_type_id: scheduleTypeId,
      date: scheduleDate,
      start_time: startTime.slice(0, 5),
      duration_minutes: scheduleDuration,
      internal_notes: scheduleNotes.trim() || null,
    }].sort((a, b) => `${a.date}${a.start_time}`.localeCompare(`${b.date}${b.start_time}`)))
    setScheduleNotes('')
  }

  async function save(includeSchedule: boolean) {
    if (!validateOrder()) {
      setStep(1)
      return
    }
    setSaving(true)
    const { data, error } = await supabase.rpc('create_order_v2', {
      p_client_id: clientId,
      p_source_appointment_id: sourceAppointmentId || null,
      p_seller_id: sellerId,
      p_production_route: productionRoute,
      p_product_type_id: productTypeId,
      p_product_name: productName.trim(),
      p_design_description: designDescription.trim() || null,
      p_sale_date: saleDate || null,
      p_event_date: eventDate || null,
      p_promised_delivery_date: deliveryDate || null,
      p_gross_sale_amount: Number(grossAmount || 0),
      p_discount_amount: Number(discountAmount || 0),
      p_planned_hours: plannedHours === '' ? null : Number(plannedHours),
      p_internal_notes: internalNotes.trim() || null,
      p_scheduled_appointments: includeSchedule ? scheduled : [],
    })
    setSaving(false)
    if (error) {
      onError(error.message)
      return
    }
    onCreated(data as string, includeSchedule && scheduled.length
      ? `Pedido creado con ${scheduled.length} cita${scheduled.length === 1 ? '' : 's'} agendada${scheduled.length === 1 ? '' : 's'}.`
      : 'Pedido guardado y enviado a planificación.')
  }

  return (
    <section className="panel order-wizard">
      <header className="detail-heading">
        <div><h2>Crear pedido</h2><p>La venta, las tasas y las citas quedarán vinculadas en una sola operación.</p></div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="Cerrar creación de pedido">×</button>
      </header>
      <ol className="wizard-steps" aria-label="Progreso">
        <li className={step >= 1 ? 'active' : ''}><span>1</span>Pedido</li>
        <li className={step >= 2 ? 'active' : ''}><span>2</span>Agenda</li>
        <li className={step >= 3 ? 'active' : ''}><span>3</span>Resumen</li>
      </ol>

      {step === 1 && (
        <div className="form-stack">
          <div className="form-grid three-columns">
            <label>Venta concretada<select value={sourceAppointmentId} onChange={(event) => chooseSource(event.target.value)}><option value="">Pedido sin cita de origen</option>{saleAppointments.map((item) => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)} · {item.client?.first_name} {item.client?.last_name}</option>)}</select></label>
            <label>Cliente<select value={clientId} onChange={(event) => setClientId(event.target.value)} required disabled={Boolean(sourceAppointmentId)}><option value="">Seleccionar…</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.first_name} {client.last_name}</option>)}</select></label>
            <label>Vendedora<select value={sellerId} onChange={(event) => setSellerId(event.target.value)} required><option value="">Seleccionar…</option>{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.full_name}</option>)}</select></label>
            <label>Tipo de producto<select value={productTypeId} onChange={(event) => setProductTypeId(event.target.value)} required>{productTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <label>Ruta de producción<select value={productionRoute} onChange={(event) => setProductionRoute(event.target.value as ProductionRoute)}>{Object.entries(productionRouteLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Producto / modelo<input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Ej.: Vestido modelo Aurora" required /></label>
            <label>Fecha de venta<input type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} /></label>
            <label>Fecha del evento<input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
            <label>Entrega comprometida<input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label>
            <label>Valor venta (IVA incluido)<input type="number" min="0" step="1" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} /></label>
            <label>Descuento<input type="number" min="0" step="1" value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} /></label>
            <label>Horas planificadas de elaboración<input type="number" min="0" step="0.25" value={plannedHours} onChange={(event) => setPlannedHours(event.target.value)} /></label>
          </div>
          <label>Descripción del diseño<textarea rows={2} value={designDescription} onChange={(event) => setDesignDescription(event.target.value)} /></label>
          <label>Observaciones internas<textarea rows={2} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} /></label>
          <div className={`alert ${commissionRate === 0 ? 'alert-warning' : 'alert-info'}`}>
            Comisión congelada para {selectedSeller?.full_name ?? 'la vendedora'} / {selectedProductType?.name ?? 'producto'}: <strong>{commissionRate}%</strong>.
            {commissionRate === 0 ? ' Revisa la matriz si esperabas una tasa distinta.' : ''}
          </div>
          <footer className="wizard-actions"><button className="btn btn-secondary" type="button" disabled={saving} onClick={() => void save(false)}>Guardar pendiente</button><button className="btn btn-primary" type="button" onClick={() => { if (validateOrder()) setStep(2) }}>Continuar a agenda</button></footer>
        </div>
      )}

      {step === 2 && (
        <div className="form-stack">
          <div className="schedule-controls">
            <label>Tipo de cita<select value={scheduleTypeId} onChange={(event) => { const id = event.target.value; const type = schedulableTypes.find((item) => item.id === id); setScheduleTypeId(id); setScheduleDuration(type?.duration_minutes ?? 30) }}>{schedulableTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <label>Fecha<input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></label>
            <label>Duración<select value={scheduleDuration} onChange={(event) => setScheduleDuration(Number(event.target.value))}>{selectedScheduleType && Array.from({ length: 5 }, (_, index) => selectedScheduleType.duration_minutes + index * 15).map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}</select></label>
          </div>
          <div className="mobile-date-strip">{weekDates(scheduleDate).map((date) => <button key={date} className={date === scheduleDate ? 'active' : ''} type="button" onClick={() => setScheduleDate(date)}><span>{new Intl.DateTimeFormat('es-CL', { weekday: 'short' }).format(new Date(`${date}T12:00:00`))}</span><strong>{date.slice(8)}</strong></button>)}</div>
          <label>Observación para esta cita<input value={scheduleNotes} onChange={(event) => setScheduleNotes(event.target.value)} placeholder="Ej.: revisar largo y escote" /></label>
          <div className="slot-picker" aria-live="polite">
            {slotsLoading && <p>Consultando disponibilidad real…</p>}
            {!slotsLoading && slots.map((slot) => <button type="button" key={slot.start_time} disabled={!slot.available} className={slot.available ? 'slot-available' : 'slot-unavailable'} onClick={() => addSchedule(slot.start_time)}><strong>{formatTime(slot.start_time)}</strong><span>{slot.available ? `Disponible hasta ${formatTime(slot.end_time)}` : slot.reason ?? 'No disponible'}</span></button>)}
            {!slotsLoading && !slots.length && <p>No hay bloques configurados para ese día.</p>}
          </div>
          <div className="scheduled-list"><h3>Citas seleccionadas</h3>{scheduled.map((item, index) => { const type = appointmentTypes.find((candidate) => candidate.id === item.appointment_type_id); return <article key={`${item.date}-${item.start_time}-${index}`}><div><strong>{type?.name}</strong><span>{formatDate(item.date)} · {formatTime(item.start_time)} · {item.duration_minutes} min</span></div><button type="button" className="btn btn-danger btn-sm" onClick={() => setScheduled((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button></article> })}{!scheduled.length && <p className="empty-state">Puedes continuar sin citas y agendarlas después.</p>}</div>
          <footer className="wizard-actions"><button className="btn btn-secondary" type="button" onClick={() => setStep(1)}>Atrás</button><button className="btn btn-primary" type="button" onClick={() => setStep(3)}>Revisar pedido</button></footer>
        </div>
      )}

      {step === 3 && (
        <div className="form-stack order-summary">
          <div className="metric-grid four-metrics"><Summary label="Cliente" value={selectedClient ? `${selectedClient.first_name} ${selectedClient.last_name}` : '—'} /><Summary label="Producto" value={selectedProductType?.name ?? '—'} /><Summary label="Vendedora" value={selectedSeller?.full_name ?? '—'} /><Summary label="Venta final" value={formatClp(finalAmount)} /></div>
          <article><h3>Producción</h3><p>{productName} · {productionRouteLabels[productionRoute]} · {plannedHours || '0'} horas planificadas.</p></article>
          <article><h3>Agenda</h3><ul className="simple-list">{scheduled.map((item, index) => <li key={`${item.date}-${item.start_time}-${index}`}><strong>{appointmentTypes.find((type) => type.id === item.appointment_type_id)?.name}</strong><span>{formatDate(item.date)} · {formatTime(item.start_time)} · {item.duration_minutes} min</span></li>)}{!scheduled.length && <li>Sin citas nuevas; podrán agregarse desde la ficha del pedido.</li>}</ul></article>
          <div className="alert alert-info">IVA, Transbank y comisión de vendedora se copiarán desde Configuración. Las tasas del pedido no cambiarán aunque el mantenedor se modifique después.</div>
          <footer className="wizard-actions"><button className="btn btn-secondary" type="button" onClick={() => setStep(2)}>Atrás</button><button className="btn btn-primary" type="button" disabled={saving} onClick={() => void save(true)}>{saving ? 'Creando…' : scheduled.length ? 'Crear pedido y agendar citas' : 'Crear pedido'}</button></footer>
        </div>
      )}
    </section>
  )
}

function weekDates(center: string) {
  const base = new Date(`${center}T12:00:00`)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base)
    date.setDate(base.getDate() + index - 3)
    return toIsoDate(date)
  })
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="metric-card compact"><span>{label}</span><strong>{value}</strong></div>
}
