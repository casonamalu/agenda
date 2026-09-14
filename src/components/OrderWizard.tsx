import { FormEvent, useEffect, useMemo, useState } from 'react'
import { formatDate, toIsoDate } from '../lib/date'
import { formatClp, productionRouteLabels } from '../lib/operations'
import { supabase } from '../lib/supabase'
import type { Appointment, Client, CommercialProductType, ProductionRoute, Profile } from '../types'

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

  const saleAppointments = useMemo(
    () => appointments.filter((item) => item.appointment_type?.category === 'sale' && item.commercial_outcome === 'completed_sale' && !item.order_id),
    [appointments],
  )
  const sourceAppointment = saleAppointments.find((item) => item.id === sourceAppointmentId)
  const selectedClient = clients.find((item) => item.id === clientId)

  useEffect(() => {
    const source = saleAppointments.find((item) => item.id === initialAppointmentId)
    if (!source) return
    setSourceAppointmentId(source.id)
    setClientId(source.client_id)
    setSaleDate(source.commercial_outcome_at ? chileIsoDate(source.commercial_outcome_at) : source.appointment_date)
  }, [initialAppointmentId, saleAppointments])

  useEffect(() => {
    if (productTypeId || !productTypes.length) return
    setProductTypeId(productTypes[0].id)
  }, [productTypeId, productTypes])

  function chooseSource(value: string) {
    setSourceAppointmentId(value)
    const source = saleAppointments.find((item) => item.id === value)
    if (source) {
      setClientId(source.client_id)
      setSaleDate(source.commercial_outcome_at ? chileIsoDate(source.commercial_outcome_at) : source.appointment_date)
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
      p_scheduled_appointments: [],
    })
    setSaving(false)

    if (error) {
      onError(error.message)
      return
    }

    onCreated(
      data as string,
      'Venta registrada. Ahora puedes crear Prueba 1, Prueba 2 o Entrega desde Agenda y vincularlas en esta ficha.',
    )
  }

  return (
    <section className="panel order-wizard">
      <header className="detail-heading">
        <div>
          <h2>Registrar venta</h2>
          <p>Una sola pantalla con los datos necesarios. Las pruebas y la entrega se agendan después de confirmar la venta.</p>
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
            Entrega comprometida (opcional)
            <input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} />
          </label>
          <label>
            Valor final de la venta
            <input type="number" min="1" step="1" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} required />
          </label>
        </div>

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
          <button className="btn btn-primary" disabled={saving} type="submit">{saving ? 'Registrando…' : 'Registrar venta'}</button>
        </footer>
      </form>
    </section>
  )
}

function chileIsoDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function decisionTiming(appointment: Appointment) {
  const acceptedDate = appointment.commercial_outcome_at
    ? chileIsoDate(appointment.commercial_outcome_at)
    : appointment.appointment_date
  const days = Math.max(0, Math.round(
    (Date.parse(`${acceptedDate}T12:00:00Z`) - Date.parse(`${appointment.appointment_date}T12:00:00Z`)) / 86_400_000,
  ))
  return days === 0 ? 'Venta aceptada durante la cita' : `Venta aceptada ${days} día${days === 1 ? '' : 's'} después`
}
