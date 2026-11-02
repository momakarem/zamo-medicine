/**
 * ZAMO-NOTIF-060 — escalation handler ❗
 *
 * Handles automatic escalation and cancellation of bookings
 * that exceed 24 working hours without confirmation.
 *
 * Rules (B-29):
 *   1. After 24 working hours → auto-cancel → status = CANCELLED
 *   2. Cancellation reason: "تجاوز SLA"
 *   3. Notify: patient (apology + alternatives) + facility + zamo_admin
 *   4. Counts in response-time report (monthly SLA breach rate)
 *   5. Idempotent — does NOT re-cancel already cancelled bookings
 *
 * Uses:
 *   - calculateAutoCancelDeadline (shared/sla.ts)
 *   - state-machine T7 for SLA escalation
 */

import type { WorkingHoursEntry } from '../../shared/sla.js';
import { calculateAutoCancelDeadline } from '../../shared/sla.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EscalationCandidate {
  id: string;
  bookingNumber: string;
  branchId: string;
  facilityId: string;
  patientId: string;
  submittedAt: Date;
  status: string;
  isLate: boolean;
  autoCancelDeadline: Date | null;
}

export interface BranchWorkingHours {
  branchId: string;
  workingHours: WorkingHoursEntry[];
  holidays: string[];
}

export interface EscalationResult {
  bookingId: string;
  bookingNumber: string;
  action: 'cancelled' | 'skipped_already_cancelled' | 'skipped_not_due';
  autoCancelDeadline: Date;
}

// ---------------------------------------------------------------------------
// Escalation logic — pure functions
// ---------------------------------------------------------------------------

/**
 * Check if a booking should be auto-cancelled (B-29: 24 working hours).
 *
 * ❗ Idempotent: skips bookings already cancelled or not yet due.
 */
export function checkEscalation(
  candidate: EscalationCandidate,
  schedule: BranchWorkingHours,
  now: Date = new Date(),
): EscalationResult {
  // Already cancelled or not PENDING — skip
  if (candidate.status !== 'PENDING_CONFIRMATION') {
    return {
      bookingId: candidate.id,
      bookingNumber: candidate.bookingNumber,
      action: 'skipped_already_cancelled',
      autoCancelDeadline: candidate.autoCancelDeadline ?? now,
    };
  }

  // Calculate auto-cancel deadline
  const deadline = candidate.autoCancelDeadline ?? calculateAutoCancelDeadline({
    submittedAt: candidate.submittedAt,
    workingHours: schedule.workingHours,
    holidays: schedule.holidays,
  });

  // Not yet due
  if (now.getTime() <= deadline.getTime()) {
    return {
      bookingId: candidate.id,
      bookingNumber: candidate.bookingNumber,
      action: 'skipped_not_due',
      autoCancelDeadline: deadline,
    };
  }

  // Due for auto-cancel
  return {
    bookingId: candidate.id,
    bookingNumber: candidate.bookingNumber,
    action: 'cancelled',
    autoCancelDeadline: deadline,
  };
}

/**
 * Process a batch of candidates and return only those that need cancellation.
 *
 * ❗ Idempotent — safe to run repeatedly.
 */
export function findBookingsToEscalate(
  candidates: EscalationCandidate[],
  schedules: Map<string, BranchWorkingHours>,
  now: Date = new Date(),
): EscalationResult[] {
  const results: EscalationResult[] = [];

  for (const candidate of candidates) {
    const schedule = schedules.get(candidate.branchId);
    if (!schedule) continue;

    const result = checkEscalation(candidate, schedule, now);
    if (result.action === 'cancelled') {
      results.push(result);
    }
  }

  return results;
}

/**
 * Compute the auto-cancel deadline for a booking (for pre-computation).
 */
export function computeAutoCancelDeadline(
  submittedAt: Date,
  schedule: BranchWorkingHours,
): Date {
  return calculateAutoCancelDeadline({
    submittedAt,
    workingHours: schedule.workingHours,
    holidays: schedule.holidays,
  });
}

// ---------------------------------------------------------------------------
// Cancellation reason — B-29
// ---------------------------------------------------------------------------

export const SLA_CANCEL_REASON_AR = 'إلغاء تلقائي — تجاوز وقت الاستجابة (24 ساعة عمل)';
export const SLA_CANCEL_REASON_EN = 'Auto-cancelled — response time exceeded (24 working hours)';
export const SLA_CANCEL_SOURCE = 'system_sla_escalation';

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

/**
 * Build SQL to find bookings approaching or past the 24-hour auto-cancel deadline.
 *
 * ❗ Only fetches PENDING_CONFIRMATION bookings.
 */
export function buildFindEscalationCandidatesSQL(now: Date = new Date()): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      SELECT
        id, booking_number, branch_id, facility_id, patient_id,
        created_at as submitted_at, status, is_late,
        auto_cancel_deadline
      FROM bookings
      WHERE status = 'PENDING_CONFIRMATION'
        AND (
          auto_cancel_deadline IS NOT NULL AND auto_cancel_deadline <= $1
        )
      ORDER BY auto_cancel_deadline ASC
    `,
    values: [now],
  };
}

/**
 * Build SQL to auto-cancel a booking (B-29).
 *
 * ❗ Only cancels if still PENDING_CONFIRMATION (idempotent).
 */
export function buildAutoCancelSQL(
  bookingId: string,
  reason: string,
): { sql: string; values: unknown[] } {
  return {
    sql: `
      UPDATE bookings
      SET
        status = 'CANCELLED',
        cancelled_at = now(),
        cancellation_reason = $2,
        cancellation_source = 'system_sla_escalation',
        updated_at = now()
      WHERE id = $1
        AND status = 'PENDING_CONFIRMATION'
      RETURNING *
    `,
    values: [bookingId, reason],
  };
}

/**
 * Build SQL to count SLA breaches for a facility in a given month.
 *
 * Used in the response-time report (B-29: "يُحتسب على العيادة").
 */
export function buildSlaBreachCountSQL(
  facilityId: string,
  yearMonth: string, // 'YYYY-MM'
): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT COUNT(*) as breach_count
      FROM bookings
      WHERE facility_id = $1
        AND cancellation_source = 'system_sla_escalation'
        AND cancelled_at >= ($2 || '-01')::date
        AND cancelled_at < (($2 || '-01')::date + interval '1 month')
    `,
    values: [facilityId, yearMonth],
  };
}
