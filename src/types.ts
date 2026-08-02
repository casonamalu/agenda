export type AppRole = 'admin' | 'seller' | 'reception' | 'workshop'
export type AppointmentStatus = 'scheduled' | 'rescheduled' | 'cancelled' | 'no_show'
export type AppointmentCategory = 'sale' | 'trial' | 'delivery'
export type CalendarView = 'day' | 'week' | 'month'
export type CommercialOutcome = 'completed_sale' | 'rejected_sale' | 'potential_sale'
export type ProductionRoute = 'stock_adjustments' | 'existing_design' | 'new_design'
export type OrderStatus = 'quote' | 'confirmed' | 'pending_planning' | 'planned' | 'in_production' | 'pending_fitting_1' | 'corrections' | 'pending_fitting_2' | 'finishing' | 'ready' | 'delivered' | 'closed' | 'on_hold' | 'cancelled'
export type CostPhase = 'estimated' | 'actual'
export type CostCategory = 'fabric' | 'lining' | 'accessories' | 'external_service' | 'other'
export type PaymentMethod = 'cash' | 'transfer' | 'debit_card' | 'credit_card' | 'other'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: AppRole
  active: boolean
  must_change_password: boolean
}

export interface ClientType {
  id: string
  name: string
  active: boolean
  display_order: number
}

export interface Client {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  instagram: string | null
  client_type_id: string
  active: boolean
  marketing_consent: boolean
  marketing_consent_at: string | null
  marketing_consent_source: string | null
  client_type?: ClientType | null
  created_at: string
  updated_at: string
}

export interface AppointmentType {
  id: string
  name: string
  category: AppointmentCategory
  duration_minutes: number
  color: string
  capacity_per_slot: number
  active: boolean
  sort_order: number
}

export interface AppointmentSlot {
  id: string
  appointment_type_id: string
  weekday: number
  start_time: string
  active: boolean
  valid_from: string | null
  valid_to: string | null
}

export interface Closure {
  id: string
  name: string
  closure_type: 'legal_holiday' | 'special_closure' | 'vacation' | 'internal_activity'
  start_date: string
  end_date: string
  all_day: boolean
  start_time: string | null
  end_time: string | null
  active: boolean
  notes: string | null
}

export interface Appointment {
  id: string
  client_id: string
  appointment_type_id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  internal_notes: string | null
  is_overbook: boolean
  is_out_of_slot: boolean
  exception_reason: string | null
  cancellation_reason: string | null
  commercial_outcome: CommercialOutcome | null
  commercial_outcome_at: string | null
  commercial_outcome_by: string | null
  order_id: string | null
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
  client?: Client
  appointment_type?: AppointmentType
}

export interface OrderFinancials {
  id: string
  order_id: string
  gross_sale_amount: number
  discount_amount: number
  tax_rate_snapshot: number
  sales_commission_rate_snapshot: number
  card_fee_rate_snapshot: number
  workshop_hourly_cost_snapshot: number
}

export interface OrderCostItem {
  id: string
  order_id: string
  phase: CostPhase
  category: CostCategory
  description: string
  quantity: number
  unit: string
  unit_cost: number
  total_cost: number
  created_at: string
}

export interface OrderPayment {
  id: string
  order_id: string
  amount: number
  method: PaymentMethod
  paid_at: string
  reference: string | null
  document_number: string | null
  card_fee_rate_snapshot: number
  status: 'posted' | 'reversed'
  reversal_of: string | null
  notes: string | null
  created_at: string
}

export interface Order {
  id: string
  order_sequence: number
  client_id: string
  source_appointment_id: string | null
  seller_id: string | null
  production_route: ProductionRoute
  status: OrderStatus
  product_name: string
  design_description: string | null
  sale_date: string | null
  event_date: string | null
  promised_delivery_date: string | null
  production_start_date: string | null
  planned_week_start: string | null
  actual_delivery_date: string | null
  planned_hours: number | null
  actual_hours: number | null
  variance_reason: string | null
  needs_fitting_1: boolean
  needs_fitting_2: boolean
  internal_notes: string | null
  created_at: string
  updated_at: string
  client?: Client
  financials?: OrderFinancials | null
  cost_items?: OrderCostItem[]
  payments?: OrderPayment[]
}

export interface CashMovement {
  id: string
  order_id: string | null
  direction: 'income' | 'expense'
  category: string
  amount: number
  method: PaymentMethod
  occurred_at: string
  description: string
  reference: string | null
  status: 'posted' | 'reversed'
  reversal_of: string | null
  created_at: string
  order?: Pick<Order, 'order_sequence' | 'product_name'> | null
}

export interface WorkshopCapacityException {
  id: string
  week_start: string
  available_hours: number
  reason: string | null
}

export interface AuditLog {
  id: string
  table_name: string
  record_id: string | null
  action: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  reason: string | null
  changed_by: string | null
  changed_at: string
  actor?: Pick<Profile, 'full_name' | 'email'> | null
}

export interface EmailQueueItem {
  id: string
  idempotency_key: string
  appointment_id: string | null
  recipient: string
  kind: string
  scheduled_for: string
  status: 'pending' | 'processing' | 'sent' | 'retry' | 'failed' | 'cancelled'
  attempts: number
  last_error: string | null
  sent_at: string | null
  created_at: string
}

export interface ScheduledReport {
  id: string
  name: string
  active: boolean
  weekdays: number[]
  send_time: string
  recipients: string[]
  period_type: 'today' | 'tomorrow' | 'week'
  appointment_type_ids: string[] | null
  statuses: AppointmentStatus[] | null
  selected_fields: string[]
  send_empty: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface DashboardStats {
  total: number
  scheduled: number
  rescheduled: number
  cancelled: number
  noShow: number
  byType: Array<{ name: string; count: number; color: string }>
  byClientType: Array<{ name: string; count: number }>
  byWeekday: Array<{ name: string; count: number }>
  utilization: number
}
