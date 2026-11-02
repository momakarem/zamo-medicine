/**
 * ZAMO-OPS-043 — Doctor Dashboard.
 *
 * Provides:
 *   - Today's and weekly schedule
 *   - Availability and leave management
 *   - Service/price suggestion (suggestion only — does NOT change approved price)
 *
 * Key rules:
 *   - ❗ Doctor sees ONLY their own bookings (not other doctors')
 *   - ❗ Doctor sees ONLY their facility's branches
 *   - ❗ Doctor has NO full financial visibility (no commission/billing data)
 *   - Doctor can suggest a price/service → goes to facility_manager for approval
 *   - Doctor can record service IF granted the permission
 */

import type { BookingStatus } from '../booking/booking-status.js';
import type { RoleCode } from '../booking/state-machine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorScheduleEntry {
  bookingId: string;
  bookingNumber: string;
  slotStart: Date;
  slotEnd: Date;
  status: BookingStatus;
  isLate: boolean;
  patientId: string;
  branchId: string;
  serviceId: string;
  serviceName?: string;
}

export interface DoctorDashboardStats {
  todayTotal: number;
  todayConfirmed: number;
  todayAttended: number;
  todayServiceDone: number;
  weekTotal: number;
}

export interface PriceSuggestion {
  bookingId: string;
  suggestedServiceId?: string;
  suggestedAmount?: number;
  reason: string;
  doctorId: string;
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * Roles that can access the doctor dashboard.
 */
export const DOCTOR_DASHBOARD_ROLES: readonly RoleCode[] = [
  'doctor',
] as const;

/**
 * ❗ Validate that the actor can view this dashboard.
 */
export function canAccessDoctorDashboard(actorRole: RoleCode): boolean {
  return DOCTOR_DASHBOARD_ROLES.includes(actorRole);
}

/**
 * ❗ Validate that the doctor can only see their own bookings.
 *
 * The doctor must not see bookings assigned to other doctors.
 * This is enforced here AND by RLS policies in the database.
 */
export function validateDoctorScope(
  actorDoctorId: string,
  requestedDoctorId: string,
): boolean {
  return actorDoctorId === requestedDoctorId;
}

// ---------------------------------------------------------------------------
// Financial access guard
// ---------------------------------------------------------------------------

/**
 * Fields that the doctor is NOT allowed to see.
 *
 * ❗ [S2]: «بلا صلاحيات مالية كاملة»
 *    Doctor can see their proposed price, but NOT:
 *    - Commission rates/amounts
 *    - Settlement data
 *    - Invoice data
 *    - Facility-level financial reports
 */
export const DOCTOR_BLOCKED_FINANCIAL_FIELDS = [
  'commission_rate',
  'commission_amount',
  'settlement_id',
  'invoice_id',
  'facility_revenue',
  'total_collections',
] as const;

/**
 * ❗ Strip financial fields that the doctor should not see.
 */
export function stripFinancialFields<T extends Record<string, unknown>>(
  data: T,
): Partial<T> {
  const result = { ...data };
  for (const field of DOCTOR_BLOCKED_FINANCIAL_FIELDS) {
    delete (result as Record<string, unknown>)[field];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Price suggestion validation
// ---------------------------------------------------------------------------

/**
 * Validate a price suggestion from a doctor.
 *
 * ❗ The suggestion does NOT change the approved price.
 *    It creates a request that goes to facility_manager.
 */
export function validatePriceSuggestion(
  suggestion: PriceSuggestion,
): { valid: boolean; error?: string } {
  if (!suggestion.reason?.trim()) {
    return { valid: false, error: 'REASON_REQUIRED' };
  }

  if (suggestion.suggestedAmount !== undefined && suggestion.suggestedAmount < 0) {
    return { valid: false, error: 'INVALID_AMOUNT' };
  }

  return { valid: true };
}
