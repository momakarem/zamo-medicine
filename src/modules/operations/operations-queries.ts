/**
 * ZAMO-OPS-037..045 — Operations SQL Builders.
 *
 * SQL query builders for all operations tables and dashboard queries.
 * Follows the same pattern as booking-service.ts buildXxxSQL() functions.
 *
 * All mutations also require booking_status_history + audit_log entries
 * (handled by the calling orchestrator using booking-service.ts helpers).
 */

import type { AttendanceStatus, PaymentMethod, ApprovalDecision } from './operations-service.js';

// ---------------------------------------------------------------------------
// Record Attendance (T11/T12)
// ---------------------------------------------------------------------------

export function buildRecordAttendanceSQL(params: {
  bookingId: string;
  attendanceStatus: AttendanceStatus;
  arrivalTime: Date | null;
  slotStart: Date;
  recordedBy: string;
  recordedByName: string;
  branchId: string;
  facilityId: string;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      INSERT INTO attendance (
        booking_id, attendance_status, arrival_time, slot_start,
        recorded_by, recorded_by_name, branch_id, facility_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    values: [
      params.bookingId,
      params.attendanceStatus,
      params.arrivalTime,
      params.slotStart,
      params.recordedBy,
      params.recordedByName,
      params.branchId,
      params.facilityId,
    ],
  };
}

// ---------------------------------------------------------------------------
// Record Service (T13)
// ---------------------------------------------------------------------------

export function buildRecordServiceSQL(params: {
  bookingId: string;
  attendanceId: string;
  bookedServiceId: string;
  actualServiceId: string;
  bookedDoctorId: string;
  actualDoctorId: string;
  performedAt: Date;
  durationMinutes: number | null;
  adminNotes: string | null;
  recordedBy: string;
  recordedByRole: string;
  branchId: string;
  facilityId: string;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      INSERT INTO performed_services (
        booking_id, attendance_id,
        booked_service_id, actual_service_id,
        booked_doctor_id, actual_doctor_id,
        performed_at, duration_minutes, admin_notes,
        recorded_by, recorded_by_role,
        branch_id, facility_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `,
    values: [
      params.bookingId,
      params.attendanceId,
      params.bookedServiceId,
      params.actualServiceId,
      params.bookedDoctorId,
      params.actualDoctorId,
      params.performedAt,
      params.durationMinutes,
      params.adminNotes,
      params.recordedBy,
      params.recordedByRole,
      params.branchId,
      params.facilityId,
    ],
  };
}

// ---------------------------------------------------------------------------
// Submit Value (T14)
// ---------------------------------------------------------------------------

export function buildSubmitValueSQL(params: {
  bookingId: string;
  performedServiceId: string;
  proposedAmount: number;
  paymentMethod: PaymentMethod;
  paymentNotes: string | null;
  submittedBy: string;
  submittedByRole: string;
  branchId: string;
  facilityId: string;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      INSERT INTO collection_entries (
        booking_id, performed_service_id,
        proposed_amount, payment_method, payment_notes,
        submitted_by, submitted_by_role,
        branch_id, facility_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    values: [
      params.bookingId,
      params.performedServiceId,
      params.proposedAmount,
      params.paymentMethod,
      params.paymentNotes,
      params.submittedBy,
      params.submittedByRole,
      params.branchId,
      params.facilityId,
    ],
  };
}

// ---------------------------------------------------------------------------
// Approve Value (T15)
// ---------------------------------------------------------------------------

export function buildApproveValueSQL(params: {
  bookingId: string;
  collectionEntryId: string;
  decision: ApprovalDecision;
  approvedAmount: number | null;
  rejectionReason: string | null;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  approvedBy: string;
  approvedByRole: string;
  branchId: string;
  facilityId: string;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      INSERT INTO value_approvals (
        booking_id, collection_entry_id,
        decision, approved_amount, rejection_reason,
        before_state, after_state,
        approved_by, approved_by_role,
        branch_id, facility_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `,
    values: [
      params.bookingId,
      params.collectionEntryId,
      params.decision,
      params.approvedAmount,
      params.rejectionReason,
      JSON.stringify(params.beforeState),
      JSON.stringify(params.afterState),
      params.approvedBy,
      params.approvedByRole,
      params.branchId,
      params.facilityId,
    ],
  };
}

/**
 * Update collection_entries.approval_status after a decision.
 */
export function buildUpdateCollectionStatusSQL(
  collectionEntryId: string,
  newStatus: 'APPROVED' | 'REJECTED',
): { sql: string; values: unknown[] } {
  return {
    sql: `
      UPDATE collection_entries
      SET approval_status = $2
      WHERE id = $1
      RETURNING *
    `,
    values: [collectionEntryId, newStatus],
  };
}

// ---------------------------------------------------------------------------
// Reception Dashboard Queries (OPS-037)
// ---------------------------------------------------------------------------

/**
 * Dashboard stats: 6 indicators for today's bookings in a branch.
 */
export function buildReceptionStatsSQL(params: {
  branchId: string;
  date: Date;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT
        COUNT(*) FILTER (WHERE true)                                     AS total_today,
        COUNT(*) FILTER (WHERE status = 'PENDING_CONFIRMATION')          AS pending,
        COUNT(*) FILTER (WHERE status = 'PENDING_CONFIRMATION'
                           AND is_late = true)                           AS late,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')                     AS confirmed,
        COUNT(*) FILTER (WHERE status = 'ATTENDED')                      AS attended,
        COUNT(*) FILTER (WHERE status = 'SERVICE_DONE')                  AS service_done,
        COUNT(*) FILTER (WHERE status = 'COLLECTED')                     AS collected
      FROM bookings
      WHERE branch_id = $1
        AND slot_start::date = $2::date
        AND status NOT IN ('CANCELLED', 'REJECTED')
    `,
    values: [params.branchId, params.date],
  };
}

/**
 * Bookings list for reception dashboard — ordered by slot_start.
 * 9 columns: booking_number, time, patient, phone (masked), doctor, service, status, late, actions.
 */
export function buildReceptionBookingsSQL(params: {
  branchId: string;
  date: Date;
  statusFilter?: string[];
}): { sql: string; values: unknown[] } {
  const conditions: string[] = [
    'b.branch_id = $1',
    'b.slot_start::date = $2::date',
  ];
  const values: unknown[] = [params.branchId, params.date];
  let paramIdx = 3;

  if (params.statusFilter && params.statusFilter.length > 0) {
    const placeholders = params.statusFilter.map((_, i) => `$${paramIdx + i}`);
    conditions.push(`b.status IN (${placeholders.join(', ')})`);
    values.push(...params.statusFilter);
    paramIdx += params.statusFilter.length;
  }

  return {
    sql: `
      SELECT
        b.id,
        b.booking_number,
        b.slot_start,
        b.slot_end,
        b.status,
        b.is_late,
        b.sla_deadline,
        b.patient_id,
        b.doctor_id,
        b.branch_service_id,
        b.reschedule_count,
        b.created_at
      FROM bookings b
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE WHEN b.is_late = true THEN 0 ELSE 1 END,  -- late first
        b.slot_start ASC
    `,
    values,
  };
}

// ---------------------------------------------------------------------------
// Clinic Calendar Queries (OPS-039)
// ---------------------------------------------------------------------------

/**
 * Daily calendar view for a branch.
 */
export function buildDailyCalendarSQL(params: {
  branchId: string;
  date: Date;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT
        b.id, b.booking_number, b.slot_start, b.slot_end,
        b.status, b.is_late,
        b.patient_id, b.doctor_id, b.branch_service_id
      FROM bookings b
      WHERE b.branch_id = $1
        AND b.slot_start::date = $2::date
        AND b.status NOT IN ('CANCELLED', 'REJECTED')
      ORDER BY b.slot_start ASC
    `,
    values: [params.branchId, params.date],
  };
}

/**
 * Weekly calendar view for a branch.
 */
export function buildWeeklyCalendarSQL(params: {
  branchId: string;
  weekStart: Date;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT
        b.id, b.booking_number, b.slot_start, b.slot_end,
        b.status, b.is_late,
        b.patient_id, b.doctor_id, b.branch_service_id
      FROM bookings b
      WHERE b.branch_id = $1
        AND b.slot_start >= $2::timestamptz
        AND b.slot_start < ($2::timestamptz + interval '7 days')
        AND b.status NOT IN ('CANCELLED', 'REJECTED')
      ORDER BY b.slot_start ASC
    `,
    values: [params.branchId, params.weekStart],
  };
}

/**
 * Doctor-filtered calendar view.
 */
export function buildDoctorCalendarSQL(params: {
  branchId: string;
  doctorId: string;
  fromDate: Date;
  toDate: Date;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT
        b.id, b.booking_number, b.slot_start, b.slot_end,
        b.status, b.is_late,
        b.patient_id, b.branch_service_id
      FROM bookings b
      WHERE b.branch_id = $1
        AND b.doctor_id = $2
        AND b.slot_start >= $3::timestamptz
        AND b.slot_start <= $4::timestamptz
        AND b.status NOT IN ('CANCELLED', 'REJECTED')
      ORDER BY b.slot_start ASC
    `,
    values: [params.branchId, params.doctorId, params.fromDate, params.toDate],
  };
}

// ---------------------------------------------------------------------------
// Doctor Dashboard Queries (OPS-043)
// ---------------------------------------------------------------------------

/**
 * Doctor's own schedule — ❗ ONLY their bookings within their facility.
 */
export function buildDoctorScheduleSQL(params: {
  doctorId: string;
  facilityId: string;
  date: Date;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT
        b.id, b.booking_number, b.slot_start, b.slot_end,
        b.status, b.is_late,
        b.patient_id, b.branch_id, b.branch_service_id
      FROM bookings b
      WHERE b.doctor_id = $1
        AND b.facility_id = $2
        AND b.slot_start::date = $3::date
        AND b.status NOT IN ('CANCELLED', 'REJECTED')
      ORDER BY b.slot_start ASC
    `,
    values: [params.doctorId, params.facilityId, params.date],
  };
}

// ---------------------------------------------------------------------------
// Facility Dashboard Queries (OPS-044)
// ---------------------------------------------------------------------------

/**
 * Facility dashboard stats — 10 indicators across ALL branches.
 */
export function buildFacilityStatsSQL(params: {
  facilityId: string;
  date: Date;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT
        COUNT(*) FILTER (WHERE true)                                     AS total_today,
        COUNT(*) FILTER (WHERE status = 'PENDING_CONFIRMATION')          AS pending,
        COUNT(*) FILTER (WHERE status = 'PENDING_CONFIRMATION'
                           AND is_late = true)                           AS late,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')                     AS confirmed,
        COUNT(*) FILTER (WHERE status = 'ATTENDED')                      AS attended,
        COUNT(*) FILTER (WHERE status = 'SERVICE_DONE')                  AS service_done,
        COUNT(*) FILTER (WHERE status = 'COLLECTED')                     AS collected,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW')                       AS no_show,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')                     AS cancelled,
        COUNT(DISTINCT branch_id)                                        AS active_branches
      FROM bookings
      WHERE facility_id = $1
        AND slot_start::date = $2::date
    `,
    values: [params.facilityId, params.date],
  };
}

/**
 * Pending approvals for facility_manager.
 */
export function buildPendingApprovalsSQL(params: {
  facilityId: string;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT
        ce.id AS collection_entry_id,
        ce.booking_id,
        ce.proposed_amount,
        ce.payment_method,
        ce.submitted_by,
        ce.submitted_by_role,
        ce.created_at,
        b.booking_number,
        b.branch_id
      FROM collection_entries ce
      JOIN bookings b ON ce.booking_id = b.id
      WHERE ce.facility_id = $1
        AND ce.approval_status = 'PENDING_APPROVAL'
      ORDER BY ce.created_at ASC
    `,
    values: [params.facilityId],
  };
}

// ---------------------------------------------------------------------------
// Zamo Dashboard Queries (OPS-045)
// ---------------------------------------------------------------------------

/**
 * Zamo platform dashboard — 12 indicators across ALL facilities.
 */
export function buildZamoStatsSQL(params: {
  date: Date;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT
        COUNT(*) FILTER (WHERE true)                                     AS total_today,
        COUNT(*) FILTER (WHERE status = 'PENDING_CONFIRMATION')          AS pending,
        COUNT(*) FILTER (WHERE status = 'PENDING_CONFIRMATION'
                           AND is_late = true)                           AS late,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')                     AS confirmed,
        COUNT(*) FILTER (WHERE status = 'ATTENDED')                      AS attended,
        COUNT(*) FILTER (WHERE status = 'SERVICE_DONE')                  AS service_done,
        COUNT(*) FILTER (WHERE status = 'COLLECTED')                     AS collected,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW')                       AS no_show,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')                     AS cancelled,
        COUNT(*) FILTER (WHERE status = 'REJECTED')                      AS rejected,
        COUNT(DISTINCT facility_id)                                      AS active_facilities,
        COUNT(DISTINCT branch_id)                                        AS active_branches
      FROM bookings
      WHERE slot_start::date = $1::date
    `,
    values: [params.date],
  };
}

/**
 * Stalled bookings — PENDING for too long, across all facilities.
 */
export function buildStalledBookingsSQL(params: {
  stalledAfterHours: number;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT
        b.id, b.booking_number, b.slot_start, b.status,
        b.is_late, b.sla_deadline,
        b.patient_id, b.doctor_id,
        b.branch_id, b.facility_id,
        b.created_at,
        EXTRACT(EPOCH FROM (now() - b.created_at)) / 3600 AS hours_pending
      FROM bookings b
      WHERE b.status = 'PENDING_CONFIRMATION'
        AND b.created_at < now() - ($1 || ' hours')::interval
      ORDER BY b.created_at ASC
    `,
    values: [params.stalledAfterHours],
  };
}
