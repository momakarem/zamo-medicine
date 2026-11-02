/**
 * ZAMO-BOOK-029 / ZAMO-BOOK-031 — Booking Service.
 *
 * High-level service layer for booking operations. Orchestrates:
 *   - State Machine (state-machine.ts)
 *   - Slot Hold (slot-hold.ts)
 *   - SLA Calculator (sla.ts)
 *   - Audit Log
 *   - Booking Status History
 *
 * All state changes go through applyTransition() — never direct SQL UPDATE
 * on status column (DEC-005).
 *
 * Key messages:
 *   A-12: ❗ Never show "confirmed" — always "pending clinic confirmation"
 *   A-13: "تم إرسال طلب حجزك إلى العيادة، وسنبلغك فور تأكيد الموعد"
 *   B-32: Max 3 pending bookings per patient
 */

import type { BookingStatus } from './booking-status.js';
import type {
  TransitionResult,
  TransitionError,
} from './state-machine.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Booking {
  id: string;
  bookingNumber: string;
  patientId: string;
  doctorId: string;
  branchId: string;
  facilityId: string;
  branchServiceId: string;
  slotStart: Date;
  slotEnd: Date;
  slotHoldId: string | null;
  status: BookingStatus;
  rescheduleCount: number;
  rejectionReason: string | null;
  cancellationReason: string | null;
  cancellationSource: string | null;
  consentPrivacy: boolean;
  consentOperational: boolean;
  consentMarketing: boolean;
  slaDeadline: Date | null;
  isLate: boolean;
  arrivedLate: boolean | null;
  rescheduledOnArrival: boolean | null;
  confirmedAt: Date | null;
  attendedAt: Date | null;
  serviceDoneAt: Date | null;
  collectedAt: Date | null;
  cancelledAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookingParams {
  patientId: string;
  doctorId: string;
  branchId: string;
  facilityId: string;
  branchServiceId: string;
  slotStart: Date;
  slotEnd: Date;
  slotHoldId?: string;
  consentPrivacy: boolean;
  consentOperational: boolean;
  consentMarketing?: boolean;
}

export interface BookingFilters {
  status?: BookingStatus | BookingStatus[];
  fromDate?: Date;
  toDate?: Date;
  serviceId?: string;
  branchId?: string;
  search?: string;
}

export type BookingError =
  | TransitionError
  | 'MAX_PENDING_BOOKINGS'     // B-32: exceeded 3 pending
  | 'DUPLICATE_BOOKING'        // B-32: same service+branch+day
  | 'PRIVACY_CONSENT_REQUIRED' // A-51: privacy consent mandatory
  | 'SLOT_CONFLICT'            // A-20: slot already taken
  | 'BOOKING_NOT_FOUND'
  | 'DB_ERROR';

// ---------------------------------------------------------------------------
// Booking number generator
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable booking number.
 * Format: ZAMO-YYYYMMDD-XXXX (where XXXX is random alphanumeric)
 */
export function generateBookingNumber(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ZAMO-${y}${m}${d}-${rand}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate create booking parameters.
 *
 * B-32: Check pending count and duplicate in application layer.
 * A-51: Privacy consent is mandatory.
 */
export function validateCreateBooking(
  params: CreateBookingParams,
  currentPendingCount: number,
): Result<void, BookingError> {
  // A-51: Privacy consent is mandatory
  if (!params.consentPrivacy) {
    return err('PRIVACY_CONSENT_REQUIRED');
  }

  // B-32: Max 3 pending bookings
  if (currentPendingCount >= 3) {
    return err('MAX_PENDING_BOOKINGS');
  }

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// SQL builders for booking operations
// ---------------------------------------------------------------------------

/**
 * Build SQL for inserting a new booking (T1: create).
 */
export function buildCreateBookingSQL(params: CreateBookingParams & {
  bookingNumber: string;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      INSERT INTO bookings (
        booking_number, patient_id, doctor_id, branch_id, facility_id,
        branch_service_id, slot_start, slot_end, slot_hold_id,
        status, consent_privacy, consent_operational, consent_marketing,
        consent_privacy_at, consent_operational_at, consent_marketing_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        'NEW', $10, $11, $12,
        CASE WHEN $10 THEN now() ELSE NULL END,
        CASE WHEN $11 THEN now() ELSE NULL END,
        CASE WHEN $12 THEN now() ELSE NULL END
      )
      RETURNING *
    `,
    values: [
      params.bookingNumber,
      params.patientId,
      params.doctorId,
      params.branchId,
      params.facilityId,
      params.branchServiceId,
      params.slotStart,
      params.slotEnd,
      params.slotHoldId ?? null,
      params.consentPrivacy,
      params.consentOperational,
      params.consentMarketing ?? false,
    ],
  };
}

/**
 * Build SQL for counting pending bookings for a patient (B-32).
 */
export function buildCountPendingSQL(patientId: string): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      SELECT COUNT(*) as count
      FROM bookings
      WHERE patient_id = $1
        AND status IN ('NEW', 'PENDING_CONFIRMATION')
    `,
    values: [patientId],
  };
}

/**
 * Build SQL for updating booking status after a transition.
 *
 * ❗ This is the ONLY place where bookings.status is updated (DEC-005).
 */
export function buildTransitionSQL(
  bookingId: string,
  result: TransitionResult,
  params: {
    reason?: string;
    cancellationSource?: string;
    slaDeadline?: Date;
    newSlotStart?: Date;
    newSlotEnd?: Date;
    arrivedLate?: boolean;
    rescheduledOnArrival?: boolean;
  },
): { sql: string; values: unknown[] } {
  const setClauses: string[] = ['status = $2'];
  const values: unknown[] = [bookingId, result.newStatus];
  let paramIdx = 3;

  // Set timestamps based on transition
  switch (result.newStatus) {
    case 'CONFIRMED':
      setClauses.push(`confirmed_at = now()`);
      break;
    case 'ATTENDED':
      setClauses.push(`attended_at = now()`);
      if (params.arrivedLate !== undefined) {
        setClauses.push(`arrived_late = $${paramIdx}`);
        values.push(params.arrivedLate);
        paramIdx++;
      }
      if (params.rescheduledOnArrival !== undefined) {
        setClauses.push(`rescheduled_on_arrival = $${paramIdx}`);
        values.push(params.rescheduledOnArrival);
        paramIdx++;
      }
      break;
    case 'SERVICE_DONE':
      setClauses.push(`service_done_at = now()`);
      break;
    case 'COLLECTED':
      setClauses.push(`collected_at = now()`);
      break;
    case 'CANCELLED':
      setClauses.push(`cancelled_at = now()`);
      if (params.reason) {
        setClauses.push(`cancellation_reason = $${paramIdx}`);
        values.push(params.reason);
        paramIdx++;
      }
      if (params.cancellationSource) {
        setClauses.push(`cancellation_source = $${paramIdx}`);
        values.push(params.cancellationSource);
        paramIdx++;
      }
      break;
    case 'REJECTED':
      setClauses.push(`rejected_at = now()`);
      if (params.reason) {
        setClauses.push(`rejection_reason = $${paramIdx}`);
        values.push(params.reason);
        paramIdx++;
      }
      break;
  }

  // SLA deadline
  if (params.slaDeadline) {
    setClauses.push(`sla_deadline = $${paramIdx}`);
    values.push(params.slaDeadline);
    paramIdx++;
  }

  // Reschedule: update slot and increment count
  if (result.transition.action === 'reschedule') {
    if (params.newSlotStart) {
      setClauses.push(`slot_start = $${paramIdx}`);
      values.push(params.newSlotStart);
      paramIdx++;
    }
    if (params.newSlotEnd) {
      setClauses.push(`slot_end = $${paramIdx}`);
      values.push(params.newSlotEnd);
      paramIdx++;
    }
    setClauses.push(`reschedule_count = reschedule_count + 1`);
  }

  // SLA escalation: set late flag
  if (result.transition.action === 'sla_escalate') {
    setClauses.push(`is_late = true`);
  }

  return {
    sql: `
      UPDATE bookings
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `,
    values,
  };
}

/**
 * Build SQL for recording a status transition in booking_status_history.
 * Every transition is recorded — no exceptions (A-53, DEC-005).
 */
export function buildHistorySQL(params: {
  bookingId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  transitionId: string;
  action: string;
  actorId: string;
  actorRole: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      INSERT INTO booking_status_history (
        booking_id, from_status, to_status, transition_id,
        action, actor_id, actor_role, reason, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
    values: [
      params.bookingId,
      params.fromStatus,
      params.toStatus,
      params.transitionId,
      params.action,
      params.actorId,
      params.actorRole,
      params.reason ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  };
}

/**
 * Build SQL for recording an audit log entry.
 * Every transition writes to audit_log (A-53).
 */
export function buildAuditSQL(params: {
  actorId: string;
  actorRole: string;
  action: string;
  bookingId: string;
  facilityId: string;
  branchId: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  reason?: string;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      INSERT INTO audit_log (
        actor_user_id, actor_role, action, entity_type, entity_id,
        facility_id, branch_id, before_state, after_state, reason
      ) VALUES ($1, $2, $3, 'booking', $4, $5, $6, $7, $8, $9)
    `,
    values: [
      params.actorId,
      params.actorRole,
      `booking.${params.action}`,
      params.bookingId,
      params.facilityId,
      params.branchId,
      JSON.stringify(params.beforeState),
      JSON.stringify(params.afterState),
      params.reason ?? null,
    ],
  };
}

/**
 * Build SQL to get patient bookings with filters.
 */
export function buildPatientBookingsSQL(
  patientId: string,
  filters: BookingFilters,
): { sql: string; values: unknown[] } {
  const conditions: string[] = ['patient_id = $1'];
  const values: unknown[] = [patientId];
  let paramIdx = 2;

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      const placeholders = filters.status.map((_, i) => `$${paramIdx + i}`);
      conditions.push(`status IN (${placeholders.join(', ')})`);
      values.push(...filters.status);
      paramIdx += filters.status.length;
    } else {
      conditions.push(`status = $${paramIdx}`);
      values.push(filters.status);
      paramIdx++;
    }
  }

  if (filters.fromDate) {
    conditions.push(`slot_start >= $${paramIdx}`);
    values.push(filters.fromDate);
    paramIdx++;
  }

  if (filters.toDate) {
    conditions.push(`slot_start <= $${paramIdx}`);
    values.push(filters.toDate);
    paramIdx++;
  }

  if (filters.branchId) {
    conditions.push(`branch_id = $${paramIdx}`);
    values.push(filters.branchId);
    paramIdx++;
  }

  if (filters.serviceId) {
    conditions.push(`branch_service_id = $${paramIdx}`);
    values.push(filters.serviceId);
    paramIdx++;
  }

  return {
    sql: `
      SELECT * FROM bookings
      WHERE ${conditions.join(' AND ')}
      ORDER BY slot_start DESC
    `,
    values,
  };
}

// ---------------------------------------------------------------------------
// Success page messages (A-12, A-13)
// ---------------------------------------------------------------------------

/**
 * ❗ A-12: NEVER show "confirmed". A-13: Show the approved message.
 */
export const BOOKING_SUCCESS_MESSAGES = {
  ar: 'تم إرسال طلب حجزك إلى العيادة، وسنبلغك فور تأكيد الموعد',
  en: 'Your booking request has been sent to the clinic. We will notify you once the appointment is confirmed.',
} as const;

/**
 * ❗ Safety check: ensure no "confirmed" language appears in success messages.
 * This is tested in the test suite.
 */
export const FORBIDDEN_SUCCESS_WORDS = {
  ar: ['تم تأكيد الحجز', 'حجزك مؤكد', 'تم التأكيد'],
  en: ['booking confirmed', 'appointment confirmed', 'your booking is confirmed'],
} as const;
