import { FormEvent, useEffect, useMemo, useState } from 'react'
import { chileIsoDate } from '../lib/business'
import { formatDate, toIsoDate } from '../lib/date'
import { formatClp } from '../lib/operations'
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
  return date && time ? date + 'T' + time : ''
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
  const [trial1Date, setTrial1Date] = useState('')
  const [trial1Time, setTrial1Time] = useState('')
  const [workshopGuide, setWorkshopGuide] = useState('')
  const [trial2Date, setTrial2Date] = useState('')
  const [trial2Time, setTrial2Time] = useState('')
  const [deliveryAppointmentDate, setDeliveryAppointmentDate] = useState('')
  const [deliveryTime, setDeliveryTime] = useState('')

  const saleAppointments = useMemo(
    () => appointments.filter((item) => item.appointment_type?.category === 'sale' && item.commercial_outcome === 'completed_sale' && !item.order_id),
    [appointments],
  )
  const sourceAppointment = saleAppointments.find((item) => item.id === sourceAppointmentId)
  const selectedClient = clients.find((item) => item.id === clientId)
  const linkedSaleFlow = Boolean(sourceAppointmentId)
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
    if (!source) return
    setClientId(source.client_id)
    setSaleDate(source.commercial_outcome_at ? chileIsoDate(source.commercial_outcome_at) : source.appointment_date)
    setEventDate(source.event_date ?? '')
    setWorkshopGuide(source.sales_guide_number ?? '')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onError('')

    if (!clientId || !sellerId || !productTypeId || !productName.trim()) {
      onError('Completa producto y datos básicos de la venta.')
      return
    }
    if (Number(grossAmount) <= 0) {
      onError('Ingresa un valor final mayor que cero.')
      return
    }
    if (!trial1Type || !trial1Date || !trial1Time || !workshopGuide.trim()) {
      onError('Completa fecha, hora y guía de Prueba 1.')
      return
    }
    if (!trial2Type || !trial2Date || !trial2Time) {
      onError('Completa fecha y hora de Prueba 2.')
      return
    }
    if (!deliveryType || !deliveryAppointmentDate || !deliveryTime) {
      onError('Completa fecha y hora de Entrega.')
      return
    }

    const moments = [
      { label: 'Prueba 1', value: appointmentMoment(trial1Date, trial1Time) },
      { label: 'Prueba 2', value: appointmentMoment(trial2Date, trial2Time) },
      { label: 'Entrega', value: appointmentMoment(deliveryAppointmentDate, deliveryTime) },
    ]
    for (let index = 1; index < moments.length; index += 1) {
      if (moments[index].value < moments[index - 1].value) {
        onError(moments[index].label + ' no puede quedar antes de ' + moments[index - 1].label + '.')
        return
      }
    }

    const guide = workshopGuide.trim()
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
      onError('La guía ' + guide + ' ya está registrada en otra venta.')
      return
    }

    const scheduledAppointments = [
      {
        appointment_type_id: trial1Type.id,
        date: trial1Date,
        start_time: trial1Time,
        duration_minutes: trial1Type.duration_minutes,
        internal_notes: null,
      },
      {
        appointment_type_id: trial2Type.id,
        date: trial2Date,
        start_time: trial2Time,
        duration_minutes: trial2Type.duration_minutes,
        internal_notes: null,
      },
      {
        appointment_type_id: deliveryType.id,
        date: deliveryAppointmentDate,
        start_time: deliveryTime,
        duration_minutes: deliveryType.duration_minutes,
        internal_notes: null,
      },
    ]

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
    const { error: orderGuideError } = await supabase
      .from('orders')
      .update({ workshop_order_number: guide, updated_by: profile.id })
      .eq('id', orderId)

    if (orderGuideError) {
      warning = ' La venta y sus citas se crearon, pero no se pudo guardar la guía en la ficha de venta: ' + orderGuideError.message
    } else {
      const { error: appointmentGuideError } = await supabase
        .from('appointments')
        .update({ sales_guide_number: guide, updated_by: profile.id })
        .eq('order_id', orderId)
        .eq('appointment_type_id', trial1Type.id)
      if (appointmentGuideError) {
        warning = ' La venta y sus citas se crearon, pero la guía no pudo copiarse a Prueba 1: ' + appointmentGuideError.message
      }
    }

    setSaving(false)
    onCreated(orderId, 'Venta confirmada. Prueba 1, Prueba 2 y Entrega quedaron agendadas.' + warning)
  }

  return (
    <section className="panel order-wizard">
      <header className="detail-heading">
        <div>
          <h2>Confirmar venta y agendar</h2>
          <p>Producto, valor y las tres citas en una sola pantalla.</p>
        </div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="Cerrar confirmación de venta">×</button>
      </header>

      <form className="form-stack" onSubmit={save}>
        {linkedSaleFlow && sourceAppointment && (
          <div className="alert alert-success">
            <strong>{sourceAppointment.client?.first_name} {sourceAppointment.client?.last_name}</strong>
            {' · '}Venta aceptada el {formatDate(saleDate)}.
          </div>
        )}

        {!linkedSaleFlow && (
          <div className="form-grid three-columns">
            <label>
              Venta aceptada
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
              <select value={clientId} onChange={(event) => setClientId(event.target.value)} required>
                <option value="">Seleccionar…</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.first_name} {client.last_name}</option>)}
              </select>
            </label>
          </div>
        )}

        <fieldset className="form-section">
          <legend>Venta</legend>
          <div className="form-grid three-columns">
            <label>
              Producto vendido
              <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Ej.: Vestido Aurora" required />
            </label>
            <label>
              Stock / elaboración
              <select value={productionRoute} onChange={(event) => setProductionRoute(event.target.value as ProductionRoute)}>
                <option value="stock_adjustments">Está en stock / ajustes</option>
                <option value="existing_design">A pedido · diseño existente</option>
                <option value="new_design">A pedido · diseño nuevo</option>
              </select>
            </label>
            <label>
              Valor final
              <input type="number" min="1" step="1" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} required />
            </label>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Citas</legend>
          <p className="form-help">Las tres citas se crean juntas al confirmar.</p>
          <div className="form-grid three-columns">
            <label>
              Prueba 1 · fecha
              <input type="date" value={trial1Date} onChange={(event) => setTrial1Date(event.target.value)} required />
            </label>
            <label>
              Prueba 1 · hora
              <input type="time" step="900" value={trial1Time} onChange={(event) => setTrial1Time(event.target.value)} required />
            </label>
            <label>
              Guía de trabajo
              <input value={workshopGuide} onChange={(event) => setWorkshopGuide(event.target.value)} placeholder="N° de guía" required />
            </label>

            <label>
              Prueba 2 · fecha
              <input type="date" value={trial2Date} onChange={(event) => setTrial2Date(event.target.value)} required />
            </label>
            <label>
              Prueba 2 · hora
              <input type="time" step="900" value={trial2Time} onChange={(event) => setTrial2Time(event.target.value)} required />
            </label>
            <span />

            <label>
              Entrega · fecha
              <input type="date" value={deliveryAppointmentDate} onChange={(event) => {
                setDeliveryAppointmentDate(event.target.value)
                setDeliveryDate(event.target.value)
              }} required />
            </label>
            <label>
              Entrega · hora
              <input type="time" step="900" value={deliveryTime} onChange={(event) => setDeliveryTime(event.target.value)} required />
            </label>
          </div>
        </fieldset>

        <details>
          <summary>Más datos de la venta (opcional)</summary>
          <div className="form-grid three-columns">
            <label>
              Tipo de producto
              <select value={productTypeId} onChange={(event) => setProductTypeId(event.target.value)} required>
                {productTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
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
              Fecha de aceptación
              <input type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} required />
            </label>
            <label>
              Fecha del evento
              <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
            </label>
          </div>
          <label>
            Descripción o ajustes
            <textarea rows={2} value={designDescription} onChange={(event) => setDesignDescription(event.target.value)} />
          </label>
          <label>
            Observaciones internas
            <textarea rows={2} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} />
          </label>
        </details>

        <div className="alert alert-info">
          <strong>{selectedClient ? selectedClient.first_name + ' ' + selectedClient.last_name : 'Cliente por seleccionar'}</strong>
          {' · '}Total {formatClp(Number(grossAmount || 0))}. Se crearán Prueba 1, Prueba 2 y Entrega.
        </div>

        <footer className="wizard-actions">
          <button className="btn btn-secondary" type="button" disabled={saving} onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" disabled={saving} type="submit">{saving ? 'Confirmando…' : 'Confirmar venta y agendar'}</button>
        </footer>
      </form>
    </section>
  )
}
