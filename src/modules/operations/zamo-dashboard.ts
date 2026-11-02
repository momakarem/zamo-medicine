/**
 * ZAMO-OPS-045 — Zamo Admin Dashboard.
 *
 * Platform-wide operations dashboard for zamo_admin and zamo_ops:
 *   - 12 indicators across ALL facilities
 *   - Stalled/stuck bookings management
 *   - Booking modification with mandatory reason + notification
 *
 * Key rules:
 *   - ❗ Changing a confirmed booking requires a recorded reason AND notifying both parties
 *   - ❗ «لا تغيير لحجز مؤكد دون سبب وإبلاغ الأطراف» [S1]
 *   - All changes recorded in Audit log
 */

import type { BookingStatus } from '../booking/booking-status.js';
import type { RoleCode } from '../booking/state-machine.js';
import { applyTransition } from '../booking/state-machine.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZamoDashboardStats {
  totalToday: number;
  pending: number;
  late: number;
  confirmed: number;
  attended: number;
  serviceDone: number;
  collected: number;
  noShow: number;
  cancelled: number;
  rejected: number;
  activeFacilities: number;
  activeBranches: number;
}

export interface StalledBooking {
  id: string;
  bookingNumber: string;
  slotStart: Date;
  status: BookingStatus;
  isLate: boolean;
  slaDeadline: Date | null;
  patientId: string;
  doctorId: string;
  branchId: string;
  facilityId: string;
  hoursPending: number;
  createdAt: Date;
}

export type ZamoActionError =
  | 'NOT_ZAMO_ADMIN'
  | 'REASON_REQUIRED'
  | 'BOOKING_NOT_CONFIRMED'
  | 'TRANSITION_FAILED';

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * Roles that can access the Zamo admin dashboard.
 */
export const ZAMO_DASHBOARD_ROLES: readonly RoleCode[] = [
  'zamo_admin',
  'zamo_ops',
] as const;

/**
 * Validate that the actor can view the Zamo dashboard.
 */
export function canAccessZamoDashboard(actorRole: RoleCode): boolean {
  return (ZAMO_DASHBOARD_ROLES as readonly string[]).includes(actorRole);
}

// ---------------------------------------------------------------------------
// Confirmed booking modification — ❗ requires reason + notification
// ---------------------------------------------------------------------------

export interface ModifyBookingParams {
  bookingId: string;
  bookingStatus: BookingStatus;
  action: 'cancel';  // currently only cancel is supported for admin override
  reason: string;
  actorId: string;
  actorRole: RoleCode;
}

/**
 * ❗ Validate modification of a confirmed booking by zamo_admin.
 *
 * [S1]: «لا تغيير لحجز مؤكد دون سبب وإبلاغ الأطراف»
 *
 * Rules:
 *   - Only zamo_admin can modify confirmed bookings
 *   - Reason is MANDATORY
 *   - Both parties (patient + clinic) must be notified (Phase 7 placeholder)
 *   - The action is recorded in Audit
 */
export function validateAdminModifyBooking(
  params: ModifyBookingParams,
): Result<{ newStatus: BookingStatus; notifyParties: boolean }, ZamoActionError> {
  // 1. Only zamo_admin
  if (params.actorRole !== 'zamo_admin') {
    return err('NOT_ZAMO_ADMIN');
  }

  // 2. ❗ Reason is mandatory
  if (!params.reason?.trim()) {
    return err('REASON_REQUIRED');
  }

  // 3. Booking must be in a modifiable state
  if (params.bookingStatus !== 'CONFIRMED' && params.bookingStatus !== 'PENDING_CONFIRMATION') {
    return err('BOOKING_NOT_CONFIRMED');
  }

  // 4. Validate through State Machine
  const result = applyTransition({
    currentStatus: params.bookingStatus,
    action: params.action,
    actorRole: params.actorRole,
    actorId: params.actorId,
    reason: params.reason,
  });

  if (!result.ok) {
    return err('TRANSITION_FAILED');
  }

  return ok({
    newStatus: result.value.newStatus,
    notifyParties: true,  // ❗ Always notify both parties
  });
}

// ---------------------------------------------------------------------------
// Stats parsing
// ---------------------------------------------------------------------------

/**
 * Parse raw SQL stats row into ZamoDashboardStats.
 */
export function parseZamoStats(row: Record<string, string | undefined>): ZamoDashboardStats {
  return {
    totalToday: parseInt(row.total_today ?? '0', 10) || 0,
    pending: parseInt(row.pending ?? '0', 10) || 0,
    late: parseInt(row.late ?? '0', 10) || 0,
    confirmed: parseInt(row.confirmed ?? '0', 10) || 0,
    attended: parseInt(row.attended ?? '0', 10) || 0,
    serviceDone: parseInt(row.service_done ?? '0', 10) || 0,
    collected: parseInt(row.collected ?? '0', 10) || 0,
    noShow: parseInt(row.no_show ?? '0', 10) || 0,
    cancelled: parseInt(row.cancelled ?? '0', 10) || 0,
    rejected: parseInt(row.rejected ?? '0', 10) || 0,
    activeFacilities: parseInt(row.active_facilities ?? '0', 10) || 0,
    activeBranches: parseInt(row.active_branches ?? '0', 10) || 0,
  };
}
