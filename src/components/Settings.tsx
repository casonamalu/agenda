import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AppointmentSlot, AppointmentType, ClientType, Closure, CommercialProductType, Profile, SellerProductCommission } from '../types'

interface EmailTemplate {
  id: string
  template_key: string
  name: string
  subject: string
  body_html: string
  active: boolean
}

interface NotificationSettings {
  business_name: string
  address: string
  contact_phone: string
  contact_email: string
  instagram: string
  timezone: string
  notification_reminder_hours: string
  notification_retry_minutes: string
  notification_batch_size: string
  notification_processing_timeout_minutes: string
  notification_admin_alerts: boolean
}

interface CapacitySettings {
  shared_space_capacity: string
  daily_trial_limit: string
  daily_delivery_limit: string
  appointment_duration_step_minutes: string
  appointment_max_duration_minutes: string
  business_day_start: string
  business_day_end: string
  business_break_start: string
  business_break_end: string
}

interface OperationsSettings {
  workshop_default_weekly_hours: string
  workshop_hourly_cost: string
  workshop_capacity_warning_percent: string
  default_tax_rate: string
  default_card_fee_rate: string
}

interface Props {
  refreshToken: number
  onChanged: (message: string) => void
}

type Tab = 'appointment-types' | 'capacity' | 'operations' | 'commissions' | 'client-types' | 'slots' | 'closures' | 'notifications' | 'templates'

const weekdayLabels: Record<number, string> = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' }
const initialNotificationSettings: NotificationSettings = {
  business_name: 'Casona Malú',
  address: 'Av. Rancagua 187',
  contact_phone: '',
  contact_email: '',
  instagram: '',
  timezone: 'America/Santiago',
  notification_reminder_hours: '24',
  notification_retry_minutes: '5, 30, 120',
  notification_batch_size: '20',
  notification_processing_timeout_minutes: '15',
  notification_admin_alerts: true,
}
const initialCapacitySettings: CapacitySettings = {
  shared_space_capacity: '1',
  daily_trial_limit: '2',
  daily_delivery_limit: '2',
  appointment_duration_step_minutes: '15',
  appointment_max_duration_minutes: '240',
  business_day_start: '10:00',
  business_day_end: '19:00',
  business_break_start: '14:00',
  business_break_end: '15:00',
}
const initialOperationsSettings: OperationsSettings = {
  workshop_default_weekly_hours: '40',
  workshop_hourly_cost: '0',
  workshop_capacity_warning_percent: '85',
  default_tax_rate: '19',
  default_card_fee_rate: '0',
}

export function Settings({ refreshToken, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = window.localStorage.getItem('casona-malu-settings-tab')
    const tabs: Tab[] = ['appointment-types', 'capacity', 'operations', 'commissions', 'client-types', 'slots', 'closures', 'notifications', 'templates']
    return tabs.includes(saved as Tab) ? saved as Tab : 'appointment-types'
  })
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([])
  const [clientTypes, setClientTypes] = useState<ClientType[]>([])
  const [slots, setSlots] = useState<AppointmentSlot[]>([])
  const [closures, setClosures] = useState<Closure[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [sellers, setSellers] = useState<Profile[]>([])
  const [productTypes, setProductTypes] = useState<CommercialProductType[]>([])
  const [commissions, setCommissions] = useState<SellerProductCommission[]>([])
  const [commissionSellerId, setCommissionSellerId] = useState('')
  const [commissionProductIds, setCommissionProductIds] = useState<string[]>([])
  const [commissionRate, setCommissionRate] = useState('0')
  const [capacitySettings, setCapacitySettings] = useState<CapacitySettings>(initialCapacitySettings)
  const [operationsSettings, setOperationsSettings] = useState<OperationsSettings>(initialOperationsSettings)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(initialNotificationSettings)
  const [savingCapacity, setSavingCapacity] = useState(false)
  const [savingOperations, setSavingOperations] = useState(false)
  const [savingNotifications, setSavingNotifications] = useState(false)
  const [savingClosure, setSavingClosure] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => { void loadAll() }, [refreshToken])
  useEffect(() => { window.localStorage.setItem('casona-malu-settings-tab', tab) }, [tab])

  async function loadAll() {
    const [typesResult, clientTypesResult, slotsResult, closuresResult, templatesResult, settingsResult, sellersResult, productTypesResult, commissionsResult] = await Promise.all([
      supabase.from('appointment_types').select('*').order('sort_order'),
      supabase.from('client_types').select('*').order('display_order'),
      supabase.from('appointment_slots').select('*').order('weekday').order('start_time'),
      supabase.from('closures').select('*').order('start_date', { ascending: false }),
      supabase.from('email_templates').select('*').order('name'),
      supabase.from('app_settings').select('setting_key,setting_value'),
      supabase.from('profiles').select('*').eq('active', true).in('role', ['admin', 'seller']).order('full_name'),
      supabase.from('commercial_product_types').select('*').eq('active', true).order('display_order'),
      supabase.from('seller_product_commissions').select('*'),
    ])
    setAppointmentTypes((typesResult.data ?? []) as AppointmentType[])
    setClientTypes((clientTypesResult.data ?? []) as ClientType[])
    setSlots((slotsResult.data ?? []) as AppointmentSlot[])
    setClosures((closuresResult.data ?? []) as Closure[])
    setTemplates((templatesResult.data ?? []) as EmailTemplate[])
    const sellerRows = (sellersResult.data ?? []) as Profile[]
    setSellers(sellerRows)
    setProductTypes((productTypesResult.data ?? []) as CommercialProductType[])
    setCommissions((commissionsResult.data ?? []) as SellerProductCommission[])
    setCommissionSellerId((current) => current || sellerRows[0]?.id || '')
    const settingsMap = Object.fromEntries((settingsResult.data ?? []).map((setting) => [setting.setting_key, setting.setting_value]))
    const retryValue = settingsMap.notification_retry_minutes
    setCapacitySettings({
      shared_space_capacity: String(settingsMap.shared_space_capacity ?? initialCapacitySettings.shared_space_capacity),
      daily_trial_limit: String(settingsMap.daily_trial_limit ?? initialCapacitySettings.daily_trial_limit),
      daily_delivery_limit: String(settingsMap.daily_delivery_limit ?? initialCapacitySettings.daily_delivery_limit),
      appointment_duration_step_minutes: String(settingsMap.appointment_duration_step_minutes ?? initialCapacitySettings.appointment_duration_step_minutes),
      appointment_max_duration_minutes: String(settingsMap.appointment_max_duration_minutes ?? initialCapacitySettings.appointment_max_duration_minutes),
      business_day_start: stringValue(settingsMap.business_day_start, initialCapacitySettings.business_day_start),
      business_day_end: stringValue(settingsMap.business_day_end, initialCapacitySettings.business_day_end),
      business_break_start: stringValue(settingsMap.business_break_start, initialCapacitySettings.business_break_start),
      business_break_end: stringValue(settingsMap.business_break_end, initialCapacitySettings.business_break_end),
    })
    setNotificationSettings({
      business_name: stringValue(settingsMap.business_name, initialNotificationSettings.business_name),
      address: stringValue(settingsMap.address, initialNotificationSettings.address),
      contact_phone: stringValue(settingsMap.contact_phone, ''),
      contact_email: stringValue(settingsMap.contact_email, ''),
      instagram: stringValue(settingsMap.instagram, ''),
      timezone: stringValue(settingsMap.timezone, initialNotificationSettings.timezone),
      notification_reminder_hours: String(settingsMap.notification_reminder_hours ?? 24),
      notification_retry_minutes: Array.isArray(retryValue) ? retryValue.join(', ') : initialNotificationSettings.notification_retry_minutes,
      notification_batch_size: String(settingsMap.notification_batch_size ?? 20),
      notification_processing_timeout_minutes: String(settingsMap.notification_processing_timeout_minutes ?? 15),
      notification_admin_alerts: typeof settingsMap.notification_admin_alerts === 'boolean' ? settingsMap.notification_admin_alerts : true,
    })
    setOperationsSettings({
      workshop_default_weekly_hours: String(settingsMap.workshop_default_weekly_hours ?? 40),
      workshop_hourly_cost: String(settingsMap.workshop_hourly_cost ?? 0),
      workshop_capacity_warning_percent: String(settingsMap.workshop_capacity_warning_percent ?? 85),
      default_tax_rate: String(settingsMap.default_tax_rate ?? 19),
      default_card_fee_rate: String(settingsMap.default_card_fee_rate ?? 0),
    })
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
    setError('')
    setNotice('')
    const form = new FormData(event.currentTarget)
    const allDay = form.get('all_day') === 'on'
    const payload = {
      name: String(form.get('name')).trim(),
      closure_type: String(form.get('closure_type')),
      start_date: String(form.get('start_date')),
      end_date: String(form.get('end_date')),
      all_day: allDay,
      start_time: allDay ? null : String(form.get('start_time') || '') || null,
      end_time: allDay ? null : String(form.get('end_time') || '') || null,
      notes: String(form.get('notes') || '') || null,
    }

    const duplicate = closures.some((closure) =>
      closure.active
      && closure.start_date === payload.start_date
      && closure.end_date === payload.end_date
      && closure.all_day === payload.all_day
      && (closure.start_time?.slice(0, 5) ?? null) === payload.start_time
      && (closure.end_time?.slice(0, 5) ?? null) === payload.end_time
    )
    if (duplicate) {
      setError('Este día o período ya se encuentra bloqueado con la misma configuración.')
      return
    }

    setSavingClosure(true)
    const { error: insertError } = await supabase.from('closures').insert(payload)
    setSavingClosure(false)
    if (insertError) {
      setError(insertError.code === '23505'
        ? 'Este día o período ya se encuentra bloqueado.'
        : insertError.message)
    } else {
      event.currentTarget.reset()
      await loadAll()
      setNotice('El día o período fue bloqueado correctamente.')
      onChanged('Día bloqueado correctamente.')
    }
  }

  async function deleteClosure(id: string) {
    if (!window.confirm('¿Eliminar este cierre?')) return
    setError('')
    setNotice('')
    const { error: deleteError } = await supabase.from('closures').delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
    else {
      await loadAll()
      setNotice('El bloqueo fue eliminado correctamente.')
      onChanged('Bloqueo eliminado.')
    }
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

  function updateNotificationSetting<Key extends keyof NotificationSettings>(key: Key, value: NotificationSettings[Key]) {
    setNotificationSettings((current) => ({ ...current, [key]: value }))
  }

  function updateCapacitySetting<Key extends keyof CapacitySettings>(key: Key, value: CapacitySettings[Key]) {
    setCapacitySettings((current) => ({ ...current, [key]: value }))
  }

  function updateOperationsSetting<Key extends keyof OperationsSettings>(key: Key, value: OperationsSettings[Key]) {
    setOperationsSettings((current) => ({ ...current, [key]: value }))
  }

  async function saveOperationsSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const weeklyHours = Number(operationsSettings.workshop_default_weekly_hours)
    const hourlyCost = Number(operationsSettings.workshop_hourly_cost)
    const warning = Number(operationsSettings.workshop_capacity_warning_percent)
    const tax = Number(operationsSettings.default_tax_rate)
    const cardFee = Number(operationsSettings.default_card_fee_rate)
    if ([weeklyHours, hourlyCost, warning, tax, cardFee].some((value) => !Number.isFinite(value) || value < 0)
      || warning > 100 || tax > 100 || cardFee > 100) {
      setError('Revisa las horas, costos y porcentajes configurados.')
      return
    }
    setSavingOperations(true)
    const { error: saveError } = await supabase.from('app_settings').upsert([
      { setting_key: 'workshop_default_weekly_hours', setting_value: weeklyHours, description: 'Horas productivas disponibles por semana en el taller' },
      { setting_key: 'workshop_hourly_cost', setting_value: hourlyCost, description: 'Costo interno por hora de taller en CLP' },
      { setting_key: 'workshop_capacity_warning_percent', setting_value: warning, description: 'Porcentaje semanal que activa advertencia de capacidad' },
      { setting_key: 'default_tax_rate', setting_value: tax, description: 'IVA predeterminado para nuevos pedidos' },
      { setting_key: 'default_card_fee_rate', setting_value: cardFee, description: 'Comisión Transbank predeterminada para nuevos pedidos' },
    ], { onConflict: 'setting_key' })
    setSavingOperations(false)
    if (saveError) setError(saveError.message)
    else { await loadAll(); onChanged('Configuración comercial y de taller actualizada.') }
  }

  async function saveCommissionRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const rate = Number(commissionRate)
    if (!commissionSellerId || !commissionProductIds.length || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError('Selecciona una vendedora, uno o más productos y una comisión entre 0 y 100%.')
      return
    }
    const { error: saveError } = await supabase.rpc('set_seller_product_commissions', {
      p_seller_id: commissionSellerId,
      p_product_type_ids: commissionProductIds,
      p_commission_rate: rate,
    })
    if (saveError) setError(saveError.message)
    else {
      setCommissionProductIds([])
      await loadAll()
      onChanged('Matriz de comisiones actualizada. Los pedidos anteriores conservan sus tasas.')
    }
  }

  async function saveCapacitySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const sharedCapacity = integerBetween(capacitySettings.shared_space_capacity, 1, 10)
    const dailyTrialLimit = integerBetween(capacitySettings.daily_trial_limit, 1, 20)
    const dailyDeliveryLimit = integerBetween(capacitySettings.daily_delivery_limit, 1, 20)
    const durationStep = integerBetween(capacitySettings.appointment_duration_step_minutes, 5, 60)
    const maximumDuration = integerBetween(capacitySettings.appointment_max_duration_minutes, 30, 480)

    if (!sharedCapacity || !dailyTrialLimit || !dailyDeliveryLimit || !durationStep || !maximumDuration) {
      setError('Revisa la capacidad, los máximos diarios y la configuración de duración.')
      return
    }
    const longestBaseDuration = Math.max(0, ...appointmentTypes.filter((type) => type.active).map((type) => type.duration_minutes))
    if (maximumDuration < longestBaseDuration) {
      setError(`La duración máxima no puede ser inferior a la duración base más larga (${longestBaseDuration} minutos).`)
      return
    }
    if (capacitySettings.business_day_start >= capacitySettings.business_day_end
      || capacitySettings.business_break_start >= capacitySettings.business_break_end) {
      setError('La hora de inicio debe ser anterior a la hora de término.')
      return
    }

    setSavingCapacity(true)
    const rows = [
      { setting_key: 'shared_space_capacity', setting_value: sharedCapacity, description: 'Capacidad simultánea del espacio de pruebas y entregas' },
      { setting_key: 'daily_trial_limit', setting_value: dailyTrialLimit, description: 'Máximo diario conjunto de Prueba 1 y Prueba 2' },
      { setting_key: 'daily_delivery_limit', setting_value: dailyDeliveryLimit, description: 'Máximo diario de entregas' },
      { setting_key: 'appointment_duration_step_minutes', setting_value: durationStep, description: 'Incremento permitido para extender una cita' },
      { setting_key: 'appointment_max_duration_minutes', setting_value: maximumDuration, description: 'Duración máxima de una cita extendida' },
      { setting_key: 'business_day_start', setting_value: capacitySettings.business_day_start, description: 'Inicio de la jornada' },
      { setting_key: 'business_day_end', setting_value: capacitySettings.business_day_end, description: 'Término de la jornada' },
      { setting_key: 'business_break_start', setting_value: capacitySettings.business_break_start, description: 'Inicio del horario de almuerzo' },
      { setting_key: 'business_break_end', setting_value: capacitySettings.business_break_end, description: 'Término del horario de almuerzo' },
    ]
    const { error: saveError } = await supabase.from('app_settings').upsert(rows, { onConflict: 'setting_key' })
    setSavingCapacity(false)
    if (saveError) {
      setError(saveError.message)
      return
    }

    await loadAll()
    onChanged('Configuración de capacidad diaria actualizada.')
  }

  async function saveNotificationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const reminderHours = integerBetween(notificationSettings.notification_reminder_hours, 1, 168)
    const batchSize = integerBetween(notificationSettings.notification_batch_size, 1, 100)
    const timeoutMinutes = integerBetween(notificationSettings.notification_processing_timeout_minutes, 1, 120)
    const retryMinutes = notificationSettings.notification_retry_minutes
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 1440)

    if (!reminderHours || !batchSize || !timeoutMinutes || !retryMinutes.length) {
      setError('Revisa las horas, los reintentos, el tamaño del lote y el tiempo de recuperación.')
      return
    }

    setSavingNotifications(true)
    const rows = [
      { setting_key: 'business_name', setting_value: notificationSettings.business_name, description: 'Nombre comercial' },
      { setting_key: 'address', setting_value: notificationSettings.address, description: 'Dirección fija' },
      { setting_key: 'contact_phone', setting_value: notificationSettings.contact_phone, description: 'Número de contacto' },
      { setting_key: 'contact_email', setting_value: notificationSettings.contact_email, description: 'Correo de contacto y respuesta' },
      { setting_key: 'instagram', setting_value: notificationSettings.instagram, description: 'Cuenta de Instagram' },
      { setting_key: 'timezone', setting_value: notificationSettings.timezone, description: 'Zona horaria' },
      { setting_key: 'notification_reminder_hours', setting_value: reminderHours, description: 'Horas de anticipación del recordatorio' },
      { setting_key: 'notification_retry_minutes', setting_value: retryMinutes, description: 'Minutos de espera entre reintentos' },
      { setting_key: 'notification_batch_size', setting_value: batchSize, description: 'Máximo de correos procesados por ejecución' },
      { setting_key: 'notification_processing_timeout_minutes', setting_value: timeoutMinutes, description: 'Minutos para recuperar un correo atascado' },
      { setting_key: 'notification_admin_alerts', setting_value: notificationSettings.notification_admin_alerts, description: 'Alertar al administrador después del último intento' },
    ]
    const { error: saveError } = await supabase.from('app_settings').upsert(rows, { onConflict: 'setting_key' })
    if (saveError) {
      setError(saveError.message)
      setSavingNotifications(false)
      return
    }

    const { error: reminderError } = await supabase.rpc('reschedule_pending_reminders')
    setSavingNotifications(false)
    if (reminderError) {
      setError(`La configuración se guardó, pero no fue posible recalcular los recordatorios: ${reminderError.message}`)
      return
    }
    await loadAll()
    onChanged('Configuración de notificaciones actualizada.')
  }

  const slotTypeName = (id: string) => appointmentTypes.find((type) => type.id === id)?.name ?? 'Sin tipo'

  return (
    <section className="page-section">
      <div className="page-heading"><div><h1>Mantenedores</h1><p>Configuración funcional de la agenda.</p></div></div>
      <div className="tabs">
        <button className={tab === 'appointment-types' ? 'active' : ''} onClick={() => setTab('appointment-types')}>Tipos de cita</button>
        <button className={tab === 'capacity' ? 'active' : ''} onClick={() => setTab('capacity')}>Capacidad diaria</button>
        <button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}>Comercial y taller</button>
        <button className={tab === 'commissions' ? 'active' : ''} onClick={() => setTab('commissions')}>Comisiones vendedoras</button>
        <button className={tab === 'client-types' ? 'active' : ''} onClick={() => setTab('client-types')}>Tipos de cliente</button>
        <button className={tab === 'slots' ? 'active' : ''} onClick={() => setTab('slots')}>Bloques</button>
        <button className={tab === 'closures' ? 'active' : ''} onClick={() => setTab('closures')}>Feriados y cierres</button>
        <button className={tab === 'notifications' ? 'active' : ''} onClick={() => setTab('notifications')}>Notificaciones</button>
        <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>Correos</button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

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

      {tab === 'capacity' && (
        <form className="settings-list" onSubmit={saveCapacitySettings}>
          <article className="settings-card">
            <h2>Límites diarios</h2>
            <p>Las citas canceladas no consumen capacidad. Los cambios se aplican inmediatamente al consultar horarios.</p>
            <div className="form-grid three-columns">
              <label>
                Máximo diario de pruebas
                <input
                  required
                  type="number"
                  min="1"
                  max="20"
                  value={capacitySettings.daily_trial_limit}
                  onChange={(event) => updateCapacitySetting('daily_trial_limit', event.target.value)}
                />
                <small>Prueba 1 y Prueba 2 se cuentan juntas.</small>
              </label>
              <label>
                Máximo diario de entregas
                <input
                  required
                  type="number"
                  min="1"
                  max="20"
                  value={capacitySettings.daily_delivery_limit}
                  onChange={(event) => updateCapacitySetting('daily_delivery_limit', event.target.value)}
                />
                <small>Se contabilizan solamente las citas de Entrega.</small>
              </label>
              <label>
                Capacidad simultánea pruebas/entregas
                <input
                  required
                  type="number"
                  min="1"
                  max="10"
                  value={capacitySettings.shared_space_capacity}
                  onChange={(event) => updateCapacitySetting('shared_space_capacity', event.target.value)}
                />
                <small>Pruebas y entregas comparten este espacio.</small>
              </label>
            </div>
          </article>
          <article className="settings-card">
            <h2>Citas extendidas y jornada</h2>
            <p>Estos parámetros permiten reservar más de una hora sin modificar el código. El sistema valida todo el intervalo y evita cruces con otras citas o con el almuerzo.</p>
            <div className="form-grid three-columns">
              <label>Incremento de duración (min)<input required type="number" min="5" max="60" value={capacitySettings.appointment_duration_step_minutes} onChange={(event) => updateCapacitySetting('appointment_duration_step_minutes', event.target.value)} /><small>Ejemplo: 15 permite 45, 60, 75, 90…</small></label>
              <label>Duración máxima (min)<input required type="number" min="30" max="480" value={capacitySettings.appointment_max_duration_minutes} onChange={(event) => updateCapacitySetting('appointment_max_duration_minutes', event.target.value)} /></label>
              <span />
              <label>Inicio jornada<input required type="time" value={capacitySettings.business_day_start} onChange={(event) => updateCapacitySetting('business_day_start', event.target.value)} /></label>
              <label>Término jornada<input required type="time" value={capacitySettings.business_day_end} onChange={(event) => updateCapacitySetting('business_day_end', event.target.value)} /></label>
              <span />
              <label>Inicio almuerzo<input required type="time" value={capacitySettings.business_break_start} onChange={(event) => updateCapacitySetting('business_break_start', event.target.value)} /></label>
              <label>Término almuerzo<input required type="time" value={capacitySettings.business_break_end} onChange={(event) => updateCapacitySetting('business_break_end', event.target.value)} /></label>
            </div>
          </article>
          <article className="settings-card">
            <h2>Disponibilidad de ventas</h2>
            <p>Venta no tiene un máximo diario adicional. Estarán disponibles todos los bloques activos mientras exista capacidad en cada horario.</p>
            <button className="btn btn-primary" disabled={savingCapacity} type="submit">
              {savingCapacity ? 'Guardando…' : 'Guardar capacidad'}
            </button>
          </article>
        </form>
      )}

      {tab === 'operations' && (
        <form className="settings-list" onSubmit={saveOperationsSettings}>
          <article className="settings-card">
            <h2>Capacidad y costo del taller</h2>
            <p>Define la disponibilidad normal. En Taller podrás reemplazarla para una semana específica por vacaciones, feriados o refuerzos.</p>
            <div className="form-grid three-columns">
              <label>Horas disponibles por semana<input required type="number" min="0" step="0.25" value={operationsSettings.workshop_default_weekly_hours} onChange={(event) => updateOperationsSetting('workshop_default_weekly_hours', event.target.value)} /></label>
              <label>Costo por hora de taller (CLP)<input required type="number" min="0" step="1" value={operationsSettings.workshop_hourly_cost} onChange={(event) => updateOperationsSetting('workshop_hourly_cost', event.target.value)} /></label>
              <label>Advertencia de ocupación (%)<input required type="number" min="0" max="100" step="1" value={operationsSettings.workshop_capacity_warning_percent} onChange={(event) => updateOperationsSetting('workshop_capacity_warning_percent', event.target.value)} /></label>
            </div>
          </article>
          <article className="settings-card">
            <h2>Valores comerciales predeterminados</h2>
            <p>Se copian al crear cada pedido. El pedido conserva su propia tasa histórica aunque posteriormente cambies estos valores.</p>
            <div className="form-grid two-columns">
              <label>IVA (%)<input required type="number" min="0" max="100" step="0.01" value={operationsSettings.default_tax_rate} onChange={(event) => updateOperationsSetting('default_tax_rate', event.target.value)} /></label>
              <label>Comisión Transbank (%)<input required type="number" min="0" max="100" step="0.01" value={operationsSettings.default_card_fee_rate} onChange={(event) => updateOperationsSetting('default_card_fee_rate', event.target.value)} /></label>
            </div>
            <p className="form-help">El IVA se aplica a todas las ventas. Transbank se descuenta únicamente de pagos con tarjeta.</p>
            <button className="btn btn-primary" disabled={savingOperations}>{savingOperations ? 'Guardando…' : 'Guardar configuración'}</button>
          </article>
        </form>
      )}

      {tab === 'commissions' && (
        <div className="settings-list">
          <form className="settings-card form-stack" onSubmit={saveCommissionRule}>
            <h2>Asignar comisión por vendedora y producto</h2>
            <p>Puedes seleccionar uno o varios tipos de producto. Todos parten en 0%; una tasa no configurada nunca bloquea la venta.</p>
            <div className="form-grid two-columns">
              <label>Vendedora<select value={commissionSellerId} onChange={(event) => setCommissionSellerId(event.target.value)} required>{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.full_name}</option>)}</select></label>
              <label>Comisión sobre base neta (%)<input type="number" min="0" max="100" step="0.01" value={commissionRate} onChange={(event) => setCommissionRate(event.target.value)} required /></label>
            </div>
            <fieldset className="product-check-grid">
              <legend>Tipos de producto</legend>
              {productTypes.map((product) => <label className="check-row" key={product.id}><input type="checkbox" checked={commissionProductIds.includes(product.id)} onChange={(event) => setCommissionProductIds((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} />{product.name}</label>)}
            </fieldset>
            <button className="btn btn-primary">Aplicar comisión a productos seleccionados</button>
          </form>
          <article className="settings-card">
            <h2>Matriz vigente</h2>
            <div className="table-card"><table><thead><tr><th>Vendedora</th>{productTypes.map((product) => <th key={product.id}>{product.name}</th>)}</tr></thead><tbody>{sellers.map((seller) => <tr key={seller.id}><td><strong>{seller.full_name}</strong></td>{productTypes.map((product) => { const rate = Number(commissions.find((item) => item.seller_id === seller.id && item.product_type_id === product.id)?.commission_rate ?? 0); return <td key={product.id}><span className={`badge ${rate === 0 ? 'badge-warning' : 'badge-success'}`}>{rate}%</span></td> })}</tr>)}</tbody></table></div>
            <p className="form-help">Al crear un pedido se congela la tasa de esta matriz. Cambios posteriores solo afectan pedidos nuevos.</p>
          </article>
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
            <button className="btn btn-primary" type="submit" disabled={savingClosure}>
              {savingClosure ? 'Registrando…' : 'Registrar cierre'}
            </button>
          </form>
          <div className="table-card"><table><thead><tr><th>Nombre</th><th>Período</th><th>Tipo</th><th /></tr></thead><tbody>{closures.map((closure) => <tr key={closure.id}><td>{closure.name}</td><td>{closure.start_date} — {closure.end_date}</td><td>{closure.closure_type}</td><td><button className="btn btn-danger btn-sm" type="button" onClick={() => void deleteClosure(closure.id)}>Eliminar</button></td></tr>)}</tbody></table></div>
        </div>
      )}

      {tab === 'notifications' && (
        <form className="settings-list" onSubmit={saveNotificationSettings}>
          <article className="settings-card">
            <h2>Datos visibles en los correos</h2>
            <p>Estos valores se insertan en las plantillas y se pueden modificar sin cambiar el código.</p>
            <div className="form-grid three-columns">
              <label>Nombre comercial<input required value={notificationSettings.business_name} onChange={(event) => updateNotificationSetting('business_name', event.target.value)} /></label>
              <label>Dirección<input required value={notificationSettings.address} onChange={(event) => updateNotificationSetting('address', event.target.value)} /></label>
              <label>Teléfono<input required value={notificationSettings.contact_phone} onChange={(event) => updateNotificationSetting('contact_phone', event.target.value)} /></label>
              <label>Correo de contacto<input required type="email" value={notificationSettings.contact_email} onChange={(event) => updateNotificationSetting('contact_email', event.target.value)} /></label>
              <label>Instagram<input required value={notificationSettings.instagram} onChange={(event) => updateNotificationSetting('instagram', event.target.value)} /></label>
              <label>Zona horaria<input required value={notificationSettings.timezone} onChange={(event) => updateNotificationSetting('timezone', event.target.value)} /></label>
            </div>
          </article>

          <article className="settings-card">
            <h2>Automatización y reintentos</h2>
            <p>Los recordatorios pendientes se recalculan al guardar. Los valores se aplican también a las citas nuevas.</p>
            <div className="form-grid three-columns">
              <label>Anticipación del recordatorio (horas)<input required type="number" min="1" max="168" value={notificationSettings.notification_reminder_hours} onChange={(event) => updateNotificationSetting('notification_reminder_hours', event.target.value)} /></label>
              <label>Reintentos en minutos<input required value={notificationSettings.notification_retry_minutes} onChange={(event) => updateNotificationSetting('notification_retry_minutes', event.target.value)} /><small>Separados por comas. Ejemplo: 5, 30, 120.</small></label>
              <label>Correos por ejecución<input required type="number" min="1" max="100" value={notificationSettings.notification_batch_size} onChange={(event) => updateNotificationSetting('notification_batch_size', event.target.value)} /></label>
              <label>Recuperar procesamiento después de (min)<input required type="number" min="1" max="120" value={notificationSettings.notification_processing_timeout_minutes} onChange={(event) => updateNotificationSetting('notification_processing_timeout_minutes', event.target.value)} /></label>
              <label className="check-row align-end"><input type="checkbox" checked={notificationSettings.notification_admin_alerts} onChange={(event) => updateNotificationSetting('notification_admin_alerts', event.target.checked)} />Alertar al administrador después del último intento</label>
            </div>
            <div className="alert alert-info">La clave de Resend, el remitente y el secreto del proceso automático se mantienen fuera de la aplicación por seguridad.</div>
            <button className="btn btn-primary" disabled={savingNotifications} type="submit">{savingNotifications ? 'Guardando…' : 'Guardar configuración'}</button>
          </article>
        </form>
      )}

      {tab === 'templates' && (
        <div className="settings-list">
          <div className="alert alert-info">Variables disponibles: {'{{nombre}}'}, {'{{apellido}}'}, {'{{tipo_cita}}'}, {'{{fecha}}'}, {'{{hora}}'}, {'{{hora_termino}}'}, {'{{duracion}}'}, {'{{horario}}'}, {'{{direccion}}'}, {'{{telefono}}'}, {'{{instagram}}'}, {'{{correo_contacto}}'}. Para citas extendidas se recomienda usar {'{{horario}}'}.</div>
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

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function integerBetween(value: string, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}
