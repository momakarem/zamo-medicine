/**
 * ZAMO-OPS-037..042 — Operations Service (M7).
 *
 * Core service for the operations workflow:
 *   T11: Record attendance     (CONFIRMED → ATTENDED)
 *   T12: Record no-show        (CONFIRMED → NO_SHOW)
 *   T13: Record service         (ATTENDED → SERVICE_DONE)
 *   T14: Submit value           (SERVICE_DONE → SERVICE_DONE, pending approval)
 *   T15: Approve value          (SERVICE_DONE → COLLECTED) — facility_manager ONLY
 *   T16: Reject value           (SERVICE_DONE → SERVICE_DONE, returned)
 *
 * All state changes go through applyTransition() in state-machine.ts (DEC-005).
 *
 * Key decisions enforced:
 *   A-27: Receptionist CANNOT approve final value.
 *   DEC-005: No direct UPDATE on bookings.status.
 *   DEC-014: No diagnostic/medical fields.
 *   B-31: arrived_late and rescheduled_on_arrival as flags.
 */

import type { BookingStatus } from '../booking/booking-status.js';
import type {
  TransitionResult,
  TransitionError,
  RoleCode,
} from '../booking/state-machine.js';
import { applyTransition } from '../booking/state-machine.js';
import { checkMedicalContent } from './medical-guard.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttendanceStatus = 'ATTENDED' | 'NO_SHOW' | 'LATE' | 'RESCHEDULED_ON_ARRIVAL';
export type PaymentMethod = 'cash' | 'card' | 'insurance' | 'mixed';
export type ApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type ApprovalDecision = 'APPROVED' | 'REJECTED';

export type OperationsError =
  | TransitionError
  | 'BOOKING_NOT_FOUND'
  | 'BOOKING_NOT_CONFIRMED'
  | 'BOOKING_NOT_ATTENDED'
  | 'BOOKING_NOT_SERVICE_DONE'
  | 'UNAUTHORIZED_APPROVAL'
  | 'REJECTION_REASON_REQUIRED'
  | 'INVALID_AMOUNT'
  | 'DUPLICATE_ATTENDANCE'
  | 'CONTAINS_MEDICAL_CONTENT'
  | 'DB_ERROR';

// ---------------------------------------------------------------------------
// Input params
// ---------------------------------------------------------------------------

export interface RecordAttendanceParams {
  bookingId: string;
  bookingStatus: BookingStatus;
  attendanceStatus: AttendanceStatus;
  arrivalTime?: Date;
  actorId: string;
  actorRole: RoleCode;
  actorName: string;
  branchId: string;
  facilityId: string;
  slotStart: Date;
}

export interface RecordServiceParams {
  bookingId: string;
  bookingStatus: BookingStatus;
  attendanceId: string;
  bookedServiceId: string;
  actualServiceId: string;
  bookedDoctorId: string;
  actualDoctorId: string;
  performedAt?: Date;
  durationMinutes?: number;
  adminNotes?: string;
  actorId: string;
  actorRole: RoleCode;
  branchId: string;
  facilityId: string;
}

export interface SubmitValueParams {
  bookingId: string;
  bookingStatus: BookingStatus;
  performedServiceId: string;
  proposedAmount: number;
  paymentMethod: PaymentMethod;
  paymentNotes?: string;
  actorId: string;
  actorRole: RoleCode;
  branchId: string;
  facilityId: string;
}

export interface ApproveValueParams {
  bookingId: string;
  bookingStatus: BookingStatus;
  collectionEntryId: string;
  approvedAmount: number;
  actorId: string;
  actorRole: RoleCode;
  branchId: string;
  facilityId: string;
  /** Snapshot of state before approval (for Audit). */
  beforeState: Record<string, unknown>;
}

export interface RejectValueParams {
  bookingId: string;
  bookingStatus: BookingStatus;
  collectionEntryId: string;
  rejectionReason: string;
  actorId: string;
  actorRole: RoleCode;
  branchId: string;
  facilityId: string;
  /** Snapshot of state before rejection (for Audit). */
  beforeState: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AttendanceResult {
  transitionResult: TransitionResult;
  attendanceId: string;
}

export interface ServiceResult {
  transitionResult: TransitionResult;
  performedServiceId: string;
  serviceMismatch: boolean;
}

export interface ValueSubmissionResult {
  transitionResult: TransitionResult;
  collectionEntryId: string;
}

export interface ApprovalResult {
  transitionResult: TransitionResult;
  valueApprovalId: string;
  newBookingStatus: BookingStatus;
}

// ---------------------------------------------------------------------------
// Validation: Record Attendance (T11/T12)
// ---------------------------------------------------------------------------

/**
 * Validate and prepare attendance recording.
 *
 * Rules:
 *   - Booking MUST be in CONFIRMED status.
 *   - Only receptionist can record attendance (T11/T12).
 *   - One attendance record per booking (UNIQUE constraint).
 */
export function validateRecordAttendance(
  params: RecordAttendanceParams,
): Result<TransitionResult, OperationsError> {
  // 1. Booking must be CONFIRMED
  if (params.bookingStatus !== 'CONFIRMED') {
    return err('BOOKING_NOT_CONFIRMED');
  }

  // 2. Determine action: attend or no_show
  const action = params.attendanceStatus === 'NO_SHOW' ? 'no_show' : 'attend';

  // 3. Validate through State Machine (DEC-005)
  const transitionResult = applyTransition({
    currentStatus: params.bookingStatus,
    action,
    actorRole: params.actorRole,
    actorId: params.actorId,
  });

  if (!transitionResult.ok) {
    return err(transitionResult.error);
  }

  return ok(transitionResult.value);
}

// ---------------------------------------------------------------------------
// Validation: Record Service (T13)
// ---------------------------------------------------------------------------

/**
 * Validate and prepare service recording.
 *
 * Rules:
 *   - Booking MUST be in ATTENDED status.
 *   - ❗ admin_notes MUST NOT contain medical content (DEC-014).
 *   - Service before attendance → fails.
 */
export function validateRecordService(
  params: RecordServiceParams,
): Result<TransitionResult, OperationsError> {
  // 1. Booking must be ATTENDED
  if (params.bookingStatus !== 'ATTENDED') {
    return err('BOOKING_NOT_ATTENDED');
  }

  // 2. ❗ DEC-014: Check admin_notes for medical content
  if (params.adminNotes) {
    const medicalCheck = checkMedicalContent(params.adminNotes);
    if (medicalCheck.containsMedical) {
      return err('CONTAINS_MEDICAL_CONTENT');
    }
  }

  // 3. Validate through State Machine (DEC-005)
  const transitionResult = applyTransition({
    currentStatus: params.bookingStatus,
    action: 'record_service',
    actorRole: params.actorRole,
    actorId: params.actorId,
  });

  if (!transitionResult.ok) {
    return err(transitionResult.error);
  }

  return ok(transitionResult.value);
}

// ---------------------------------------------------------------------------
// Validation: Submit Value (T14)
// ---------------------------------------------------------------------------

/**
 * Validate and prepare value submission for approval.
 *
 * Rules:
 *   - Booking MUST be in SERVICE_DONE status.
 *   - Amount must be >= 0.
 */
export function validateSubmitValue(
  params: SubmitValueParams,
): Result<TransitionResult, OperationsError> {
  // 1. Booking must be SERVICE_DONE
  if (params.bookingStatus !== 'SERVICE_DONE') {
    return err('BOOKING_NOT_SERVICE_DONE');
  }

  // 2. Amount validation
  if (params.proposedAmount < 0 || !isFinite(params.proposedAmount)) {
    return err('INVALID_AMOUNT');
  }

  // 3. Validate through State Machine (DEC-005)
  const transitionResult = applyTransition({
    currentStatus: params.bookingStatus,
    action: 'submit_value',
    actorRole: params.actorRole,
    actorId: params.actorId,
  });

  if (!transitionResult.ok) {
    return err(transitionResult.error);
  }

  return ok(transitionResult.value);
}

// ---------------------------------------------------------------------------
// Validation: Approve Value (T15) — ❗ facility_manager ONLY (A-27)
// ---------------------------------------------------------------------------

/**
 * Validate and prepare value approval.
 *
 * ❗ A-27: ONLY facility_manager can approve the final value.
 *    Receptionist, doctor, and branch_manager are BLOCKED.
 */
export function validateApproveValue(
  params: ApproveValueParams,
): Result<TransitionResult, OperationsError> {
  // 1. Booking must be SERVICE_DONE
  if (params.bookingStatus !== 'SERVICE_DONE') {
    return err('BOOKING_NOT_SERVICE_DONE');
  }

  // 2. ❗ A-27: Only facility_manager
  if (params.actorRole !== 'facility_manager') {
    return err('UNAUTHORIZED_APPROVAL');
  }

  // 3. Amount validation
  if (params.approvedAmount < 0 || !isFinite(params.approvedAmount)) {
    return err('INVALID_AMOUNT');
  }

  // 4. Validate through State Machine (DEC-005)
  const transitionResult = applyTransition({
    currentStatus: params.bookingStatus,
    action: 'approve_value',
    actorRole: params.actorRole,
    actorId: params.actorId,
  });

  if (!transitionResult.ok) {
    return err(transitionResult.error);
  }

  return ok(transitionResult.value);
}

// ---------------------------------------------------------------------------
// Validation: Reject Value (T16)
// ---------------------------------------------------------------------------

/**
 * Validate and prepare value rejection (send back to staff).
 *
 * Rules:
 *   - Only facility_manager can reject.
 *   - Rejection reason is mandatory.
 */
export function validateRejectValue(
  params: RejectValueParams,
): Result<TransitionResult, OperationsError> {
  // 1. Booking must be SERVICE_DONE
  if (params.bookingStatus !== 'SERVICE_DONE') {
    return err('BOOKING_NOT_SERVICE_DONE');
  }

  // 2. Only facility_manager
  if (params.actorRole !== 'facility_manager') {
    return err('UNAUTHORIZED_APPROVAL');
  }

  // 3. Rejection reason is mandatory
  if (!params.rejectionReason?.trim()) {
    return err('REJECTION_REASON_REQUIRED');
  }

  // 4. Validate through State Machine (DEC-005)
  const transitionResult = applyTransition({
    currentStatus: params.bookingStatus,
    action: 'reject_value',
    actorRole: params.actorRole,
    actorId: params.actorId,
    reason: params.rejectionReason,
  });

  if (!transitionResult.ok) {
    return err(transitionResult.error);
  }

  return ok(transitionResult.value);
}

// ---------------------------------------------------------------------------
// Confirm / Reject / Suggest Alternative (T3/T4/T5) — for reception dashboard
// ---------------------------------------------------------------------------

export interface ConfirmBookingParams {
  bookingStatus: BookingStatus;
  actorId: string;
  actorRole: RoleCode;
}

export interface RejectBookingParams {
  bookingStatus: BookingStatus;
  actorId: string;
  actorRole: RoleCode;
  reason: string;
}

export interface SuggestAlternativeParams {
  bookingStatus: BookingStatus;
  actorId: string;
  actorRole: RoleCode;
}

/**
 * Validate booking confirmation (T3).
 */
export function validateConfirmBooking(
  params: ConfirmBookingParams,
): Result<TransitionResult, OperationsError> {
  const result = applyTransition({
    currentStatus: params.bookingStatus,
    action: 'confirm',
    actorRole: params.actorRole,
    actorId: params.actorId,
  });

  if (!result.ok) return err(result.error);
  return ok(result.value);
}

/**
 * Validate booking rejection (T4).
 * ❗ Reason is mandatory (B-07).
 */
export function validateRejectBooking(
  params: RejectBookingParams,
): Result<TransitionResult, OperationsError> {
  if (!params.reason?.trim()) {
    return err('REASON_REQUIRED');
  }

  const result = applyTransition({
    currentStatus: params.bookingStatus,
    action: 'reject',
    actorRole: params.actorRole,
    actorId: params.actorId,
    reason: params.reason,
  });

  if (!result.ok) return err(result.error);
  return ok(result.value);
}

/**
 * Validate suggest alternative (T5).
 */
export function validateSuggestAlternative(
  params: SuggestAlternativeParams,
): Result<TransitionResult, OperationsError> {
  const result = applyTransition({
    currentStatus: params.bookingStatus,
    action: 'suggest_alternative',
    actorRole: params.actorRole,
    actorId: params.actorId,
  });

  if (!result.ok) return err(result.error);
  return ok(result.value);
}
