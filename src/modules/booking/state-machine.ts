/**
 * ZAMO-BOOK-030 — Booking State Machine ❗
 *
 * This is the OPERATIONAL HEART of the platform (DEC-005).
 *
 * ❗ Every state change MUST go through this module.
 * ❌ Direct UPDATE of bookings.status is FORBIDDEN (DEC-005).
 *
 * Implements ARCHITECTURE.md §7:
 *   - 9 states (A-19 + B-07 REJECTED)
 *   - 17 transitions (T1..T17)
 *   - 6 strict rules (§7.2)
 *
 * Key decisions enforced:
 *   A-11: Booking requires reception confirmation
 *   A-12: No "confirmed" before reception confirms
 *   A-27: Receptionist cannot approve final value
 *   B-07: REJECTED is separate from CANCELLED, requires reason
 *   B-14: Unified cancellation policy, max 2 reschedules
 *   B-20: Reschedule rules (patient→PENDING, staff→CONFIRMED, <4h→PENDING)
 *   B-32: Max 3 pending bookings per patient
 */

import type { BookingStatus } from './booking-status.js';
import { BOOKING_STATUSES } from './booking-status.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Role types (from 0001_core_identity.up.sql)
// ---------------------------------------------------------------------------

export type RoleCode =
  | 'zamo_admin' | 'zamo_ops' | 'zamo_support'
  | 'facility_manager' | 'branch_manager'
  | 'receptionist' | 'doctor' | 'accountant'
  | 'patient'
  | 'system';  // for automated actions (SLA, cron)

// ---------------------------------------------------------------------------
// Transition definitions — ARCHITECTURE.md §7.1
// ---------------------------------------------------------------------------

export interface TransitionDef {
  /** Transition ID from architecture (T1..T17) */
  id: string;
  /** Source status (null = initial creation) */
  from: BookingStatus | null;
  /** Target status */
  to: BookingStatus;
  /** Action verb */
  action: TransitionAction;
  /** Roles allowed to trigger this transition */
  allowedRoles: readonly RoleCode[];
  /** Whether a reason text is required */
  requiresReason: boolean;
  /** Whether this triggers a notification (for Phase 7) */
  triggersNotification: boolean;
}

export type TransitionAction =
  | 'create'
  | 'submit'
  | 'confirm'
  | 'reject'
  | 'suggest_alternative'
  | 'cancel'
  | 'sla_escalate'
  | 'reschedule'
  | 'remind'
  | 'attend'
  | 'no_show'
  | 'record_service'
  | 'submit_value'
  | 'approve_value'
  | 'reject_value';

/**
 * The 17 approved transitions from ARCHITECTURE.md §7.1.
 * This is the single source of truth for all state changes.
 */
export const TRANSITIONS: readonly TransitionDef[] = [
  // T1: Create booking request
  {
    id: 'T1', from: null, to: 'NEW',
    action: 'create',
    allowedRoles: ['patient', 'system'], // system = agent
    requiresReason: false,
    triggersNotification: false,
  },
  // T2: Submit to clinic (after OTP and consents)
  {
    id: 'T2', from: 'NEW', to: 'PENDING_CONFIRMATION',
    action: 'submit',
    allowedRoles: ['system', 'patient'],
    requiresReason: false,
    triggersNotification: true, // patient + receptionist
  },
  // T3: Clinic confirms
  {
    id: 'T3', from: 'PENDING_CONFIRMATION', to: 'CONFIRMED',
    action: 'confirm',
    allowedRoles: ['receptionist', 'branch_manager', 'facility_manager'],
    requiresReason: false,
    triggersNotification: true, // patient
  },
  // T4: Clinic rejects with recorded reason (B-07)
  {
    id: 'T4', from: 'PENDING_CONFIRMATION', to: 'REJECTED',
    action: 'reject',
    allowedRoles: ['receptionist', 'branch_manager'],
    requiresReason: true, // ❗ B-07: mandatory reason
    triggersNotification: true, // patient + alternatives
  },
  // T5: Suggest alternative time (stays PENDING)
  {
    id: 'T5', from: 'PENDING_CONFIRMATION', to: 'PENDING_CONFIRMATION',
    action: 'suggest_alternative',
    allowedRoles: ['receptionist'],
    requiresReason: false,
    triggersNotification: true, // patient
  },
  // T6: Cancel while pending
  {
    id: 'T6', from: 'PENDING_CONFIRMATION', to: 'CANCELLED',
    action: 'cancel',
    allowedRoles: ['patient', 'receptionist'],
    requiresReason: true,
    triggersNotification: true, // other party
  },
  // T7: SLA escalation (stays PENDING, adds late flag)
  {
    id: 'T7', from: 'PENDING_CONFIRMATION', to: 'PENDING_CONFIRMATION',
    action: 'sla_escalate',
    allowedRoles: ['system'],
    requiresReason: false,
    triggersNotification: true, // escalation + alternatives
  },
  // T8: Reschedule confirmed booking (B-20)
  {
    id: 'T8', from: 'CONFIRMED', to: 'PENDING_CONFIRMATION', // or CONFIRMED per B-20
    action: 'reschedule',
    allowedRoles: ['patient', 'receptionist'],
    requiresReason: false,
    triggersNotification: true, // both parties
  },
  // T9: Cancel confirmed booking
  {
    id: 'T9', from: 'CONFIRMED', to: 'CANCELLED',
    action: 'cancel',
    allowedRoles: ['patient', 'receptionist', 'zamo_admin'],
    requiresReason: true,
    triggersNotification: true, // both parties
  },
  // T10: Send reminder (no state change)
  {
    id: 'T10', from: 'CONFIRMED', to: 'CONFIRMED',
    action: 'remind',
    allowedRoles: ['system'],
    requiresReason: false,
    triggersNotification: true, // patient
  },
  // T11: Record attendance
  {
    id: 'T11', from: 'CONFIRMED', to: 'ATTENDED',
    action: 'attend',
    allowedRoles: ['receptionist'],
    requiresReason: false,
    triggersNotification: false, // optional
  },
  // T12: Record no-show
  {
    id: 'T12', from: 'CONFIRMED', to: 'NO_SHOW',
    action: 'no_show',
    allowedRoles: ['receptionist'],
    requiresReason: false,
    triggersNotification: true,
  },
  // T13: Record actual service performed
  {
    id: 'T13', from: 'ATTENDED', to: 'SERVICE_DONE',
    action: 'record_service',
    allowedRoles: ['receptionist', 'doctor'],
    requiresReason: false,
    triggersNotification: false,
  },
  // T14: Submit value for approval
  {
    id: 'T14', from: 'SERVICE_DONE', to: 'SERVICE_DONE',
    action: 'submit_value',
    allowedRoles: ['receptionist', 'doctor'],
    requiresReason: false,
    triggersNotification: true, // facility_manager
  },
  // T15: ❗ Approve value (facility_manager ONLY — A-27)
  {
    id: 'T15', from: 'SERVICE_DONE', to: 'COLLECTED',
    action: 'approve_value',
    allowedRoles: ['facility_manager'], // ❗ ONLY facility_manager
    requiresReason: false,
    triggersNotification: true, // + patient objection window
  },
  // T16: Reject value, send back to staff
  {
    id: 'T16', from: 'SERVICE_DONE', to: 'SERVICE_DONE',
    action: 'reject_value',
    allowedRoles: ['facility_manager'],
    requiresReason: true,
    triggersNotification: true, // staff
  },
  // T17: Commission calculation (billing event, no UI state change)
  // This is handled by the billing module in Phase 8, not here.
  // We record the transition for audit purposes only.
] as const;

// ---------------------------------------------------------------------------
// Terminal states — no transitions OUT of these states (§7.2)
// ---------------------------------------------------------------------------

export const TERMINAL_STATES: readonly BookingStatus[] = [
  'COLLECTED',
  'NO_SHOW',
  'CANCELLED',
  'REJECTED',
] as const;

// ---------------------------------------------------------------------------
// Transition parameters
// ---------------------------------------------------------------------------

export interface TransitionParams {
  /** Current booking state */
  currentStatus: BookingStatus | null;
  /** Action to perform */
  action: TransitionAction;
  /** Who is performing the action */
  actorRole: RoleCode;
  /** Actor's user ID */
  actorId: string;
  /** Reason (required for reject, cancel, reject_value) */
  reason?: string;
  /** For reschedule: new slot times */
  newSlot?: { start: Date; end: Date };
  /** For reschedule: current reschedule count */
  rescheduleCount?: number;
  /** For reschedule: hours until appointment */
  hoursUntilAppointment?: number;
  /** For SLA escalation: auto-cancel after 24h (B-29) */
  isAutoCancel?: boolean;
}

export interface TransitionResult {
  /** The transition definition that was applied */
  transition: TransitionDef;
  /** The new status after the transition */
  newStatus: BookingStatus;
  /** Whether the transition was modified by business rules */
  modified: boolean;
  /** Modification reason (e.g. "reschedule by patient returns to PENDING") */
  modificationReason?: string | undefined;
}

export type TransitionError =
  | 'INVALID_TRANSITION'       // No matching transition exists
  | 'TERMINAL_STATE'           // Cannot transition from a terminal state
  | 'UNAUTHORIZED'             // Actor role not allowed
  | 'REASON_REQUIRED'          // Reason missing for reject/cancel
  | 'MAX_RESCHEDULES'          // B-14: exceeded 2 reschedules
  | 'INVALID_STATUS'           // Unknown status value
  | 'PATIENT_CANNOT_CONFIRM'   // A-11: patient cannot confirm their own booking
  | 'DOCTOR_CANNOT_CONFIRM'    // Doctor cannot confirm bookings
  | 'RECEPTIONIST_CANNOT_APPROVE_VALUE'; // A-27

// ---------------------------------------------------------------------------
// Core: find and validate a transition
// ---------------------------------------------------------------------------

/**
 * Find a matching transition definition for the given action and source state.
 */
export function findTransition(
  currentStatus: BookingStatus | null,
  action: TransitionAction,
): TransitionDef | undefined {
  return TRANSITIONS.find(t => t.from === currentStatus && t.action === action);
}

/**
 * Apply a transition with full validation.
 *
 * This is the ONLY way to change a booking's status (DEC-005).
 *
 * Returns Result<TransitionResult, TransitionError> — expected failures
 * are returned as values, not thrown (project convention from result.ts).
 */
export function applyTransition(
  params: TransitionParams,
): Result<TransitionResult, TransitionError> {
  const { currentStatus, action, actorRole, reason } = params;

  // 1. Validate current status
  if (currentStatus !== null && !BOOKING_STATUSES.includes(currentStatus)) {
    return err('INVALID_STATUS');
  }

  // 2. Check terminal state (§7.2 rules 3, 4)
  if (currentStatus !== null && TERMINAL_STATES.includes(currentStatus)) {
    return err('TERMINAL_STATE');
  }

  // 3. Find matching transition
  const transition = findTransition(currentStatus, action);
  if (!transition) {
    return err('INVALID_TRANSITION');
  }

  // 4. Check role authorization
  if (!transition.allowedRoles.includes(actorRole)) {
    // Specific error messages for critical safety checks
    if (action === 'confirm' && actorRole === 'patient') {
      return err('PATIENT_CANNOT_CONFIRM'); // A-11
    }
    if (action === 'confirm' && actorRole === 'doctor') {
      return err('DOCTOR_CANNOT_CONFIRM');
    }
    if (action === 'approve_value' && actorRole === 'receptionist') {
      return err('RECEPTIONIST_CANNOT_APPROVE_VALUE'); // A-27
    }
    return err('UNAUTHORIZED');
  }

  // 5. Check required reason
  if (transition.requiresReason && !reason?.trim()) {
    return err('REASON_REQUIRED');
  }

  // 6. Special rules for reschedule (B-20, B-14)
  if (action === 'reschedule') {
    return applyRescheduleRules(params, transition);
  }

  // 7. Standard transition
  return ok({
    transition,
    newStatus: transition.to,
    modified: false,
  });
}

// ---------------------------------------------------------------------------
// Reschedule business rules (B-20, B-14)
// ---------------------------------------------------------------------------

/**
 * Apply reschedule-specific rules:
 *   B-14: Max 2 reschedules per booking
 *   B-20: Patient → PENDING_CONFIRMATION
 *         Receptionist → stays CONFIRMED
 *         Within 4 hours → always PENDING_CONFIRMATION
 */
function applyRescheduleRules(
  params: TransitionParams,
  transition: TransitionDef,
): Result<TransitionResult, TransitionError> {
  const { actorRole, rescheduleCount = 0, hoursUntilAppointment } = params;

  // B-14: Max 2 reschedules
  if (rescheduleCount >= 2) {
    return err('MAX_RESCHEDULES');
  }

  let newStatus: BookingStatus;
  let modified = false;
  let modificationReason: string | undefined;

  // B-20 rule 3: Within 4 hours → always needs new confirmation
  if (hoursUntilAppointment !== undefined && hoursUntilAppointment < 4) {
    newStatus = 'PENDING_CONFIRMATION';
    modified = true;
    modificationReason = 'B-20: within 4 hours of appointment, new confirmation required';
  }
  // B-20 rule 1: Patient → needs new confirmation
  else if (actorRole === 'patient') {
    newStatus = 'PENDING_CONFIRMATION';
    modified = false; // This is the default for T8
  }
  // B-20 rule 2: Receptionist → stays CONFIRMED
  else if (actorRole === 'receptionist' || actorRole === 'branch_manager') {
    newStatus = 'CONFIRMED';
    modified = true;
    modificationReason = 'B-20: receptionist reschedule keeps CONFIRMED status';
  }
  else {
    newStatus = transition.to; // Default: PENDING_CONFIRMATION
  }

  return ok({
    transition,
    newStatus,
    modified,
    modificationReason,
  });
}

// ---------------------------------------------------------------------------
// Validation helpers for use in booking-service.ts
// ---------------------------------------------------------------------------

/**
 * Check if a transition would be valid without actually applying it.
 */
export function canTransition(
  currentStatus: BookingStatus | null,
  action: TransitionAction,
  actorRole: RoleCode,
): boolean {
  const result = applyTransition({
    currentStatus,
    action,
    actorRole,
    actorId: '',
    reason: 'validation-check',
  });
  return result.ok;
}

/**
 * Get all valid actions for a given status and role.
 */
export function getValidActions(
  currentStatus: BookingStatus,
  actorRole: RoleCode,
): TransitionAction[] {
  return TRANSITIONS
    .filter(t => t.from === currentStatus && t.allowedRoles.includes(actorRole))
    .map(t => t.action);
}

/**
 * Strict validation: ensures a status value is a valid BookingStatus.
 */
export function assertValidStatus(status: string): asserts status is BookingStatus {
  if (!BOOKING_STATUSES.includes(status as BookingStatus)) {
    throw new Error(`Invalid booking status: ${status}`);
  }
}
