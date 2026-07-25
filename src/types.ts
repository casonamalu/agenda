export type AppRole = 'admin' | 'seller' | 'reception'
export type AppointmentStatus = 'scheduled' | 'rescheduled' | 'cancelled' | 'no_show'
export type AppointmentCategory = 'sale' | 'trial' | 'delivery'
export type CalendarView = 'day' | 'week' | 'month'

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
  client_type_id: string
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
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
  client?: Client
  appointment_type?: AppointmentType
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
