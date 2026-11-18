import { FormEvent, useEffect, useMemo, useState } from 'react'
import { acceptedDecisionSummary, chileIsoDate } from '../lib/business'
import { formatDate, toIsoDate } from '../lib/date'
import { formatClp, productionRouteLabels } from '../lib/operations'
import { supabase } from '../lib/supabase'
import type { Appointment, AppointmentType, Client, CommercialProductType, ProductionRoute, Profile } from '../types'

interface Props {
  profile: Profile
  clients: Client[]
  appointments: Appointment[]
  sellers: Profile[]
  productTypes: CommercialProductType[]
  initialAppointmentId: string | null
  onCancel: () => void
  onCreated: (orderId: string, message: string) => void
  onError: (message: string) => void
}

const today = () => toIsoDate(new Date())

function typeByName(types: AppointmentType[], name: string) {
  return types.find((type) => type.name.trim().toLocaleLowerCase('es-CL') === name.toLocaleLowerCase('es-CL')) ?? null
}

function appointmentMoment(date: string, time: string) {
  return date && time ? `${date}T${time}` : ''
}

export function OrderWizard({
  profile,
  clients,
  appointments,
  sellers,
  productTypes,
  initialAppointmentId,
  onCancel,
  onCreated,
  onError,
}: Props) {
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
  const [grossAmount, setGrossAmount] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([])
  const [scheduleTrial1, setScheduleTrial1] = useState(true)
  const [trial1Date, setTrial1Date] = useState('')
  const [trial1Time, setTrial1Time] = useState('')
  const [workshopGuide, setWorkshopGuide] = useState('')
  const [scheduleTrial2, setScheduleTrial2] = useState(true)
  const [trial2Date, setTrial2Date] = useState('')
  const [trial2Time, setTrial2Time] = useState('')
  const [scheduleDelivery, setScheduleDelivery] = useState(true)
  const [deliveryAppointmentDate, setDeliveryAppointmentDate] = useState('')
  const [deliveryTime, setDeliveryTime] = useState('')

  const saleAppointments = useMemo(
    () => appointments.filter((item) => item.appointment_type?.category === 'sale' && item.commercial_outcome === 'completed_sale' && !item.order_id),
    [appointments],
  )
  const sourceAppointment = saleAppointments.find((item) => item.id === sourceAppointmentId)
  const selectedClient = clients.find((item) => item.id === clientId)
  const trial1Type = useMemo(() => typeByName(appointmentTypes, 'Prueba 1'), [appointmentTypes])
  const trial2Type = useMemo(() => typeByName(appointmentTypes, 'Prueba 2'), [appointmentTypes])
  const deliveryType = useMemo(() => typeByName(appointmentTypes, 'Entrega'), [appointmentTypes])

  useEffect(() => {
    const source = saleAppointments.find((item) => item.id === initialAppointmentId)
    if (!source) return
    setSourceAppointmentId(source.id)
    setClientId(source.client_id)
    setSaleDate(source.commercial_outcome_at ? chileIsoDate(source.commercial_outcome_at) : source.appointment_date)
    setEventDate(source.event_date ?? '')
    setWorkshopGuide(source.sales_guide_number ?? '')
  }, [initialAppointmentId, saleAppointments])

  useEffect(() => {
    if (productTypeId || !productTypes.length) return
    setProductTypeId(productTypes[0].id)
  }, [productTypeId, productTypes])

  useEffect(() => {
    let active = true
    void supabase
      .from('appointment_types')
      .select('*')
      .eq('active', true)
      .in('category', ['trial', 'delivery'])
      .order('sort_order')
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          onError(error.message)
          return
        }
        setAppointmentTypes((data ?? []) as AppointmentType[])
      })
    return () => { active = false }
  }, [onError])

  function chooseSource(value: string) {
    setSourceAppointmentId(value)
    const source = saleAppointments.find((item) => item.id === value)
    if (source) {
      setClientId(source.client_id)
      setSaleDate(source.commercial_outcome_at ? chileIsoDate(source.commercial_outcome_at) : source.appointment_date)
      setEventDate(source.event_date ?? '')
      setWorkshopGuide(source.sales_guide_number ?? '')
    } else {
      setWorkshopGuide('')
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onError('')

    if (!clientId || !sellerId || !productTypeId || !productName.trim()) {
      onError('Completa cliente, vendedora, tipo de producto y producto.')
      return
    }
    if (Number(grossAmount) <= 0) {
      onError('Ingresa un valor de venta mayor que cero.')
      return
    }
    if (scheduleTrial1 && (!trial1Type || !trial1Date || !trial1Time)) {
      onError('Completa fecha y hora de Prueba 1.')
      return
    }
    if (scheduleTrial1 && !workshopGuide.trim()) {
      onError('Ingresa la guía de trabajo al agendar Prueba 1.')
      return
    }
    if (scheduleTrial2 && (!trial2Type || !trial2Date || !trial2Time)) {
      onError('Completa fecha y hora de Prueba 2.')
      return
    }
    if (scheduleDelivery && (!deliveryType || !deliveryAppointmentDate || !deliveryTime)) {
      onError('Completa fecha y hora de Entrega.')
      return
    }

    const moments = [
      scheduleTrial1 ? { label: 'Prueba 1', value: appointmentMoment(trial1Date, trial1Time) } : null,
      scheduleTrial2 ? { label: 'Prueba 2', value: appointmentMoment(trial2Date, trial2Time) } : null,
      scheduleDelivery ? { label: 'Entrega', value: appointmentMoment(deliveryAppointmentDate, deliveryTime) } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>

    for (let index = 1; index < moments.length; index += 1) {
      if (moments[index].value < moments[index - 1].value) {
        onError(`${moments[index].label} no puede quedar antes de ${moments[index - 1].label}.`)
        return
      }
    }

    const guide = workshopGuide.trim()
    if (guide) {
      let guideQuery = supabase.from('appointments').select('id').eq('sales_guide_number', guide)
      if (sourceAppointmentId) guideQuery = guideQuery.neq('id', sourceAppointmentId)
      const [{ data: appointmentGuide, error: appointmentGuideError }, { data: orderGuide, error: orderGuideError }] = await Promise.all([
        guideQuery.limit(1).maybeSingle(),
        supabase.from('orders').select('id').eq('workshop_order_number', guide).limit(1).maybeSingle(),
      ])
      if (appointmentGuideError || orderGuideError) {
        onError(appointmentGuideError?.message ?? orderGuideError?.message ?? 'No fue posible validar la guía.')
        return
      }
      if (appointmentGuide || orderGuide) {
        onError(`La guía ${guide} ya está registrada en otra venta.`)
        return
      }
    }

    const scheduledAppointments = [
      scheduleTrial1 && trial1Type ? {
        appointment_type_id: trial1Type.id,
        date: trial1Date,
        start_time: trial1Time,
        duration_minutes: trial1Type.duration_minutes,
        internal_notes: null,
      } : null,
      scheduleTrial2 && trial2Type ? {
        appointment_type_id: trial2Type.id,
        date: trial2Date,
        start_time: trial2Time,
        duration_minutes: trial2Type.duration_minutes,
        internal_notes: null,
      } : null,
      scheduleDelivery && deliveryType ? {
        appointment_type_id: deliveryType.id,
        date: deliveryAppointmentDate,
        start_time: deliveryTime,
        duration_minutes: deliveryType.duration_minutes,
        internal_notes: null,
      } : null,
    ].filter(Boolean)

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
      p_gross_sale_amount: Number(grossAmount),
      p_discount_amount: 0,
      p_planned_hours: null,
      p_internal_notes: internalNotes.trim() || null,
      p_scheduled_appointments: scheduledAppointments,
    })

    if (error) {
      setSaving(false)
      onError(error.message)
      return
    }

    const orderId = data as string
    let warning = ''
    if (guide && orderId) {
      const { error: orderGuideError } = await supabase
        .from('orders')
        .update({ workshop_order_number: guide, updated_by: profile.id })
        .eq('id', orderId)

      if (orderGuideError) {
        warning = ` La venta y sus citas se crearon, pero no se pudo guardar la guía en la ficha de venta: ${orderGuideError.message}`
      } else if (scheduleTrial1 && trial1Type) {
        const { error: appointmentGuideError } = await supabase
          .from('appointments')
          .update({ sales_guide_number: guide, updated_by: profile.id })
          .eq('order_id', orderId)
          .eq('appointment_type_id', trial1Type.id)
        if (appointmentGuideError) {
          warning = ` La venta y sus citas se crearon, pero la guía no pudo copiarse a Prueba 1: ${appointmentGuideError.message}`
        }
      }
    }

    setSaving(false)
    const createdLabels = [
      scheduleTrial1 ? 'Prueba 1' : null,
      scheduleTrial2 ? 'Prueba 2' : null,
      scheduleDelivery ? 'Entrega' : null,
    ].filter(Boolean).join(', ')

    onCreated(
      orderId,
      createdLabels
        ? `Venta registrada. ${createdLabels} quedaron agendadas en el mismo formulario.${warning}`
        : `Venta registrada sin citas posteriores.${warning}`,
    )
  }

  return (
    <section className="panel order-wizard">
      <header className="detail-heading">
        <div>
          <h2>Registrar venta y agenda posterior</h2>
          <p>Registra la venta y deja programadas Prueba 1, Prueba 2 y Entrega en una sola pantalla.</p>
        </div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="Cerrar registro de venta">×</button>
      </header>

      <form className="form-stack" onSubmit={save}>
        <div className="form-grid three-columns">
          <label>
            Cita de venta aceptada
            <select value={sourceAppointmentId} onChange={(event) => chooseSource(event.target.value)}>
              <option value="">Venta sin cita de origen</option>
              {saleAppointments.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatDate(item.appointment_date)} · {item.client?.first_name} {item.client?.last_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cliente
            <select value={clientId} onChange={(event) => setClientId(event.target.value)} required disabled={Boolean(sourceAppointmentId)}>
              <option value="">Seleccionar…</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.first_name} {client.last_name}</option>)}
            </select>
          </label>
          <label>
            Vendedora
            <select value={sellerId} onChange={(event) => setSellerId(event.target.value)} required>
              <option value="">Seleccionar…</option>
              {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.full_name}</option>)}
            </select>
          </label>
          <label>
            Tipo de producto
            <select value={productTypeId} onChange={(event) => setProductTypeId(event.target.value)} required>
              {productTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <label>
            Producto / modelo
            <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Ej.: Vestido modelo Aurora" required />
          </label>
          <label>
            Tipo de elaboración
            <select value={productionRoute} onChange={(event) => setProductionRoute(event.target.value as ProductionRoute)}>
              {Object.entries(productionRouteLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Fecha de aceptación
            <input type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} required />
          </label>
          <label>
            Fecha del evento (opcional)
            <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
          </label>
          <label>
            Valor final de la venta
            <input type="number" min="1" step="1" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} required />
          </label>
        </div>

        <fieldset className="form-section">
          <legend>Agenda posterior a la venta</legend>
          <p className="form-help">Puedes dejar las tres citas creadas de una vez. El sistema seguirá validando horarios, capacidad diaria y sobrecupos.</p>

          <div className="form-grid three-columns">
            <label className="checkbox-label">
              <input type="checkbox" checked={scheduleTrial1} onChange={(event) => {
                setScheduleTrial1(event.target.checked)
                if (!event.target.checked) {
                  setTrial1Date('')
                  setTrial1Time('')
                  setWorkshopGuide('')
                }
              }} />
              Agendar Prueba 1
            </label>
            {scheduleTrial1 ? (
              <>
                <label>Fecha Prueba 1<input type="date" value={trial1Date} onChange={(event) => setTrial1Date(event.target.value)} required /></label>
                <label>Hora Prueba 1<input type="time" step="900" value={trial1Time} onChange={(event) => setTrial1Time(event.target.value)} required /></label>
                <label className="span-two">
                  Guía de trabajo / taller
                  <input value={workshopGuide} onChange={(event) => setWorkshopGuide(event.target.value)} placeholder="Ingresa la guía al programar Prueba 1" required />
                  <small>La guía ya no se solicita al agendar la Venta. Se registra cuando la venta se concreta y se programa Prueba 1.</small>
                </label>
              </>
            ) : <div className="span-two form-help">Prueba 1 no se creará en este paso.</div>}

            <label className="checkbox-label">
              <input type="checkbox" checked={scheduleTrial2} onChange={(event) => {
                setScheduleTrial2(event.target.checked)
                if (!event.target.checked) {
                  setTrial2Date('')
                  setTrial2Time('')
                }
              }} />
              Agendar Prueba 2
            </label>
            {scheduleTrial2 ? (
              <>
                <label>Fecha Prueba 2<input type="date" value={trial2Date} onChange={(event) => setTrial2Date(event.target.value)} required /></label>
                <label>Hora Prueba 2<input type="time" step="900" value={trial2Time} onChange={(event) => setTrial2Time(event.target.value)} required /></label>
              </>
            ) : <div className="span-two form-help">Prueba 2 no se creará en este paso.</div>}

            <label className="checkbox-label">
              <input type="checkbox" checked={scheduleDelivery} onChange={(event) => {
                setScheduleDelivery(event.target.checked)
                if (!event.target.checked) {
                  setDeliveryAppointmentDate('')
                  setDeliveryTime('')
                  setDeliveryDate('')
                }
              }} />
              Agendar Entrega
            </label>
            {scheduleDelivery ? (
              <>
                <label>Fecha Entrega<input type="date" value={deliveryAppointmentDate} onChange={(event) => {
                  setDeliveryAppointmentDate(event.target.value)
                  setDeliveryDate(event.target.value)
                }} required /></label>
                <label>Hora Entrega<input type="time" step="900" value={deliveryTime} onChange={(event) => setDeliveryTime(event.target.value)} required /></label>
              </>
            ) : <div className="span-two form-help">Entrega no se creará en este paso.</div>}
          </div>
        </fieldset>

        <label>
          Descripción o ajustes (opcional)
          <textarea rows={2} value={designDescription} onChange={(event) => setDesignDescription(event.target.value)} />
        </label>
        <label>
          Observaciones internas (opcional)
          <textarea rows={2} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} />
        </label>

        {sourceAppointment && (
          <div className="alert alert-info">
            {decisionTiming(sourceAppointment)}. La fecha de aceptación se traspasó automáticamente a la venta.
          </div>
        )}
        <div className="alert alert-info">
          Cliente: <strong>{selectedClient ? `${selectedClient.first_name} ${selectedClient.last_name}` : 'por seleccionar'}</strong> ·
          Valor: <strong>{formatClp(Number(grossAmount || 0))}</strong>. Las tasas históricas se conservarán automáticamente.
        </div>

        <footer className="wizard-actions">
          <button className="btn btn-secondary" type="button" disabled={saving} onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" disabled={saving} type="submit">{saving ? 'Registrando…' : 'Registrar venta y citas'}</button>
        </footer>
      </form>
    </section>
  )
}

function decisionTiming(appointment: Appointment) {
  const acceptedDate = appointment.commercial_outcome_at
    ? chileIsoDate(appointment.commercial_outcome_at)
    : appointment.appointment_date
  return acceptedDecisionSummary(acceptedDate, appointment.appointment_date)
}
