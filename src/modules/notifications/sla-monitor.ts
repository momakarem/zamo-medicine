/**
 * ZAMO-NOTIF-059 — SLA monitor ❗
 *
 * Monitors bookings in PENDING_CONFIRMATION state and:
 *   1. Marks as late (is_late=true) when SLA deadline is exceeded
 *   2. Sends SLA_WARNING to receptionist + branch manager
 *   3. Highlights in reception dashboard
 *
 * Rules:
 *   B-28: SLA clock runs only during branch working hours
 *   A-14: Target response time is 15–30 minutes
 *   DEC-006: "late" is a flag, not a state
 *   T7: sla_escalate transition (stays PENDING_CONFIRMATION, adds late flag)
 *
 * Uses:
 *   - calculateSlaDeadline (shared/sla.ts)
 *   - isWithinWorkingHours (shared/sla.ts)
 *   - applyTransition(sla_escalate) (booking/state-machine.ts)
 */

import type { WorkingHoursEntry } from '../../shared/sla.js';
import {
  calculateSlaDeadline,
  isWithinWorkingHours,
} from '../../shared/sla.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingBooking {
  id: string;
  bookingNumber: string;
  branchId: string;
  facilityId: string;
  patientId: string;
  submittedAt: Date;
  slaDeadline: Date | null;
  isLate: boolean;
}

export interface BranchSchedule {
  branchId: string;
  workingHours: WorkingHoursEntry[];
  holidays: string[];
}

export interface SlaCheckResult {
  bookingId: string;
  bookingNumber: string;
  branchId: string;
  isOverdue: boolean;
  isAlreadyLate: boolean;
  slaDeadline: Date;
  minutesOverdue: number;
}

export type SlaMonitorError =
  | 'NO_SCHEDULE'
  | 'ALREADY_LATE';

// ---------------------------------------------------------------------------
// SLA Monitor — pure functions
// ---------------------------------------------------------------------------

/**
 * Check a single booking against its SLA deadline.
 *
 * ❗ The SLA clock respects branch working hours (B-28).
 */
export function checkBookingSla(
  booking: PendingBooking,
  schedule: BranchSchedule,
  targetMinutes: number,
  now: Date = new Date(),
): SlaCheckResult {
  // Calculate SLA deadline if not already set
  const slaDeadline = booking.slaDeadline ?? calculateSlaDeadline({
    submittedAt: booking.submittedAt,
    targetMinutes,
    workingHours: schedule.workingHours,
    holidays: schedule.holidays,
  });

  const isOverdue = now.getTime() > slaDeadline.getTime();
  const minutesOverdue = isOverdue
    ? Math.floor((now.getTime() - slaDeadline.getTime()) / (60 * 1000))
    : 0;

  return {
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    branchId: booking.branchId,
    isOverdue,
    isAlreadyLate: booking.isLate,
    slaDeadline,
    minutesOverdue,
  };
}

/**
 * Check multiple bookings and return only those that are newly overdue
 * (not already marked as late).
 */
export function findNewlyOverdueBookings(
  bookings: PendingBooking[],
  schedules: Map<string, BranchSchedule>,
  targetMinutes: number,
  now: Date = new Date(),
): SlaCheckResult[] {
  const results: SlaCheckResult[] = [];

  for (const booking of bookings) {
    const schedule = schedules.get(booking.branchId);
    if (!schedule) continue;

    const check = checkBookingSla(booking, schedule, targetMinutes, now);

    // Only include newly overdue bookings (not already marked late)
    if (check.isOverdue && !check.isAlreadyLate) {
      results.push(check);
    }
  }

  return results;
}

/**
 * Calculate an SLA deadline for a new booking and return it.
 *
 * Called when creating a booking to pre-compute the deadline.
 */
export function computeSlaDeadlineForBooking(
  submittedAt: Date,
  schedule: BranchSchedule,
  targetMinutes: number,
): Date {
  return calculateSlaDeadline({
    submittedAt,
    targetMinutes,
    workingHours: schedule.workingHours,
    holidays: schedule.holidays,
  });
}

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

/**
 * Build SQL to find PENDING_CONFIRMATION bookings that may be overdue.
 *
 * Returns bookings where:
 *   - status = 'PENDING_CONFIRMATION'
 *   - sla_deadline IS NOT NULL
 *   - sla_deadline < now (potentially overdue)
 *   - is_late = false (not already marked)
 */
export function buildFindOverdueBookingsSQL(now: Date = new Date()): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      SELECT
        id, booking_number, branch_id, facility_id, patient_id,
        created_at as submitted_at, sla_deadline, is_late
      FROM bookings
      WHERE status = 'PENDING_CONFIRMATION'
        AND sla_deadline IS NOT NULL
        AND sla_deadline < $1
        AND is_late = false
      ORDER BY sla_deadline ASC
    `,
    values: [now],
  };
}

/**
 * Build SQL to mark a booking as late (T7: sla_escalate).
 */
export function buildMarkLateSQL(bookingId: string): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      UPDATE bookings
      SET is_late = true, updated_at = now()
      WHERE id = $1 AND is_late = false
      RETURNING *
    `,
    values: [bookingId],
  };
}

/**
 * Build SQL to find overdue bookings for the reception dashboard.
 *
 * ❗ NOTIF-059: "الوسم يظهر في لوحة الاستقبال"
 */
export function buildLateBookingsForDashboardSQL(branchId: string): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      SELECT
        b.id, b.booking_number, b.patient_id, b.doctor_id,
        b.slot_start, b.sla_deadline, b.is_late,
        b.created_at as submitted_at
      FROM bookings b
      WHERE b.branch_id = $1
        AND b.status = 'PENDING_CONFIRMATION'
        AND b.is_late = true
      ORDER BY b.sla_deadline ASC
    `,
    values: [branchId],
  };
}
