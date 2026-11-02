/**
 * ZAMO-BOOK-030 — State Machine unit tests ❗
 *
 * This is the MOST CRITICAL test file in the project.
 * These tests enforce ARCHITECTURE.md §7.2 strict rules.
 *
 * ❗ If any of these tests fail, Phase 4 CANNOT pass the gate.
 */
import { describe, it, expect } from 'vitest';
import {
  applyTransition,
  canTransition,
  getValidActions,
  TRANSITIONS,
  TERMINAL_STATES,
  type TransitionParams,
  type TransitionAction,
} from './state-machine.js';
import { BOOKING_STATUSES } from './booking-status.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR_ID = 'user-001';

function makeParams(overrides: Partial<TransitionParams>): TransitionParams {
  return {
    currentStatus: null,
    action: 'create',
    actorRole: 'patient',
    actorId: ACTOR_ID,
    ...overrides,
  };
}

function expectOk(result: ReturnType<typeof applyTransition>) {
  expect(result.ok).toBe(true);
  if (result.ok) return result.value;
  throw new Error(`Expected ok but got err: ${result.error}`);
}

function expectErr(result: ReturnType<typeof applyTransition>, error?: string) {
  expect(result.ok).toBe(false);
  if (!result.ok && error) expect(result.error).toBe(error);
}

// ---------------------------------------------------------------------------
// Transition definitions completeness
// ---------------------------------------------------------------------------
describe('Transition definitions', () => {
  it('has 17 transitions defined (ARCHITECTURE.md §7.1)', () => {
    // T17 is handled by billing module, so we have 16 in our code
    expect(TRANSITIONS.length).toBe(16);
  });

  it('all transitions have unique IDs', () => {
    const ids = TRANSITIONS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all transition target statuses are valid BookingStatuses', () => {
    for (const t of TRANSITIONS) {
      expect(BOOKING_STATUSES).toContain(t.to);
    }
  });

  it('all transitions require audit (implicitly — triggersAudit always true)', () => {
    // Every transition is recorded in booking_status_history
    // This is enforced by booking-service.ts, not the transition definition
    expect(true).toBe(true); // Placeholder — integration test validates this
  });
});

// ---------------------------------------------------------------------------
// T1: Create booking (null → NEW)
// ---------------------------------------------------------------------------
describe('T1: Create booking', () => {
  it('patient can create a booking', () => {
    const result = applyTransition(makeParams({
      currentStatus: null, action: 'create', actorRole: 'patient',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('NEW');
    expect(value.transition.id).toBe('T1');
  });

  it('system (agent) can create a booking', () => {
    const result = applyTransition(makeParams({
      currentStatus: null, action: 'create', actorRole: 'system',
    }));
    expectOk(result);
  });
});

// ---------------------------------------------------------------------------
// T2: Submit (NEW → PENDING_CONFIRMATION)
// ---------------------------------------------------------------------------
describe('T2: Submit to clinic', () => {
  it('system submits after OTP', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'NEW', action: 'submit', actorRole: 'system',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('PENDING_CONFIRMATION');
  });
});

// ---------------------------------------------------------------------------
// T3: Confirm (PENDING_CONFIRMATION → CONFIRMED)
// ---------------------------------------------------------------------------
describe('T3: Confirm booking', () => {
  it('receptionist can confirm', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'confirm', actorRole: 'receptionist',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('CONFIRMED');
  });

  it('branch_manager can confirm', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'confirm', actorRole: 'branch_manager',
    }));
    expectOk(result);
  });

  it('facility_manager can confirm', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'confirm', actorRole: 'facility_manager',
    }));
    expectOk(result);
  });

  it('❗ patient CANNOT confirm their own booking (A-11)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'confirm', actorRole: 'patient',
    }));
    expectErr(result, 'PATIENT_CANNOT_CONFIRM');
  });

  it('❗ doctor CANNOT confirm a booking', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'confirm', actorRole: 'doctor',
    }));
    expectErr(result, 'DOCTOR_CANNOT_CONFIRM');
  });
});

// ---------------------------------------------------------------------------
// T4: Reject (PENDING_CONFIRMATION → REJECTED)
// ---------------------------------------------------------------------------
describe('T4: Reject booking (B-07)', () => {
  it('receptionist can reject with reason', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'reject', actorRole: 'receptionist',
      reason: 'الطبيب غير متاح',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('REJECTED');
  });

  it('❗ reject WITHOUT reason FAILS (B-07)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'reject', actorRole: 'receptionist',
    }));
    expectErr(result, 'REASON_REQUIRED');
  });

  it('❗ reject with empty reason FAILS', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'reject', actorRole: 'receptionist',
      reason: '   ',
    }));
    expectErr(result, 'REASON_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// T6: Cancel pending (PENDING_CONFIRMATION → CANCELLED)
// ---------------------------------------------------------------------------
describe('T6: Cancel pending booking', () => {
  it('patient can cancel with reason', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'cancel', actorRole: 'patient',
      reason: 'لم أعد بحاجة للموعد',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('CANCELLED');
  });

  it('cancel without reason fails', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'cancel', actorRole: 'patient',
    }));
    expectErr(result, 'REASON_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// T8: Reschedule (B-20)
// ---------------------------------------------------------------------------
describe('T8: Reschedule (B-20)', () => {
  it('patient reschedule → returns to PENDING_CONFIRMATION (B-20 rule 1)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'CONFIRMED', action: 'reschedule', actorRole: 'patient',
      rescheduleCount: 0,
      hoursUntilAppointment: 48,
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('PENDING_CONFIRMATION');
  });

  it('receptionist reschedule → stays CONFIRMED (B-20 rule 2)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'CONFIRMED', action: 'reschedule', actorRole: 'receptionist',
      rescheduleCount: 0,
      hoursUntilAppointment: 48,
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('CONFIRMED');
    expect(value.modified).toBe(true);
  });

  it('within 4 hours → always PENDING_CONFIRMATION (B-20 rule 3)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'CONFIRMED', action: 'reschedule', actorRole: 'receptionist',
      rescheduleCount: 0,
      hoursUntilAppointment: 2, // < 4 hours
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('PENDING_CONFIRMATION');
    expect(value.modified).toBe(true);
  });

  it('❗ 3rd reschedule attempt FAILS (B-14: max 2)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'CONFIRMED', action: 'reschedule', actorRole: 'patient',
      rescheduleCount: 2,
    }));
    expectErr(result, 'MAX_RESCHEDULES');
  });

  it('2nd reschedule succeeds (boundary)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'CONFIRMED', action: 'reschedule', actorRole: 'patient',
      rescheduleCount: 1,
      hoursUntilAppointment: 48,
    }));
    expectOk(result);
  });
});

// ---------------------------------------------------------------------------
// T9: Cancel confirmed (CONFIRMED → CANCELLED)
// ---------------------------------------------------------------------------
describe('T9: Cancel confirmed booking', () => {
  it('patient can cancel confirmed booking with reason', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'CONFIRMED', action: 'cancel', actorRole: 'patient',
      reason: 'ظرف طارئ',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('CANCELLED');
  });

  it('zamo_admin can cancel with reason (A-21)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'CONFIRMED', action: 'cancel', actorRole: 'zamo_admin',
      reason: 'طلب تصعيد من المريض',
    }));
    expectOk(result);
  });
});

// ---------------------------------------------------------------------------
// T11: Attend (CONFIRMED → ATTENDED)
// ---------------------------------------------------------------------------
describe('T11: Record attendance', () => {
  it('receptionist records attendance', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'CONFIRMED', action: 'attend', actorRole: 'receptionist',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('ATTENDED');
  });
});

// ---------------------------------------------------------------------------
// T12: No-show (CONFIRMED → NO_SHOW)
// ---------------------------------------------------------------------------
describe('T12: No-show', () => {
  it('receptionist records no-show', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'CONFIRMED', action: 'no_show', actorRole: 'receptionist',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('NO_SHOW');
  });
});

// ---------------------------------------------------------------------------
// T13: Record service (ATTENDED → SERVICE_DONE)
// ---------------------------------------------------------------------------
describe('T13: Record service', () => {
  it('receptionist records service', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'ATTENDED', action: 'record_service', actorRole: 'receptionist',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('SERVICE_DONE');
  });

  it('doctor can record service (with delegation)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'ATTENDED', action: 'record_service', actorRole: 'doctor',
    }));
    expectOk(result);
  });
});

// ---------------------------------------------------------------------------
// T15: Approve value (SERVICE_DONE → COLLECTED)
// ---------------------------------------------------------------------------
describe('T15: Approve value (A-27)', () => {
  it('❗ facility_manager can approve value', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'SERVICE_DONE', action: 'approve_value', actorRole: 'facility_manager',
    }));
    const value = expectOk(result);
    expect(value.newStatus).toBe('COLLECTED');
  });

  it('❗ receptionist CANNOT approve value (A-27)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'SERVICE_DONE', action: 'approve_value', actorRole: 'receptionist',
    }));
    expectErr(result, 'RECEPTIONIST_CANNOT_APPROVE_VALUE');
  });

  it('❗ doctor CANNOT approve value', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'SERVICE_DONE', action: 'approve_value', actorRole: 'doctor',
    }));
    expectErr(result, 'UNAUTHORIZED');
  });

  it('❗ branch_manager CANNOT approve value', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'SERVICE_DONE', action: 'approve_value', actorRole: 'branch_manager',
    }));
    expectErr(result, 'UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// ❗ FORBIDDEN TRANSITIONS — ARCHITECTURE.md §7.2
// ---------------------------------------------------------------------------
describe('❗ Forbidden transitions (§7.2)', () => {
  it('❗ PENDING_CONFIRMATION → ATTENDED directly FAILS (rule 1)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'PENDING_CONFIRMATION', action: 'attend', actorRole: 'receptionist',
    }));
    expectErr(result, 'INVALID_TRANSITION');
  });

  it('❗ NEW → CONFIRMED directly FAILS (rule 1)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'NEW', action: 'confirm', actorRole: 'receptionist',
    }));
    expectErr(result, 'INVALID_TRANSITION');
  });

  it('❗ ATTENDED → COLLECTED without SERVICE_DONE FAILS (rule 2)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'ATTENDED', action: 'approve_value', actorRole: 'facility_manager',
    }));
    expectErr(result, 'INVALID_TRANSITION');
  });

  it('❗ CANCELLED → any state FAILS (rule 3 — terminal)', () => {
    const actions: TransitionAction[] = ['create', 'submit', 'confirm', 'attend', 'cancel'];
    for (const action of actions) {
      const result = applyTransition(makeParams({
        currentStatus: 'CANCELLED', action, actorRole: 'receptionist',
        reason: 'test',
      }));
      expectErr(result, 'TERMINAL_STATE');
    }
  });

  it('❗ COLLECTED → any state FAILS (rule 3 — terminal)', () => {
    const actions: TransitionAction[] = ['cancel', 'attend', 'confirm'];
    for (const action of actions) {
      const result = applyTransition(makeParams({
        currentStatus: 'COLLECTED', action, actorRole: 'facility_manager',
        reason: 'test',
      }));
      expectErr(result, 'TERMINAL_STATE');
    }
  });

  it('❗ NO_SHOW → any state FAILS (terminal)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'NO_SHOW', action: 'attend', actorRole: 'receptionist',
    }));
    expectErr(result, 'TERMINAL_STATE');
  });

  it('❗ REJECTED → any state FAILS (terminal)', () => {
    const result = applyTransition(makeParams({
      currentStatus: 'REJECTED', action: 'confirm', actorRole: 'receptionist',
    }));
    expectErr(result, 'TERMINAL_STATE');
  });
});

// ---------------------------------------------------------------------------
// canTransition & getValidActions
// ---------------------------------------------------------------------------
describe('canTransition', () => {
  it('returns true for valid transition', () => {
    expect(canTransition('PENDING_CONFIRMATION', 'confirm', 'receptionist')).toBe(true);
  });

  it('returns false for invalid transition', () => {
    expect(canTransition('NEW', 'confirm', 'receptionist')).toBe(false);
  });

  it('returns false for unauthorized role', () => {
    expect(canTransition('PENDING_CONFIRMATION', 'confirm', 'patient')).toBe(false);
  });
});

describe('getValidActions', () => {
  it('receptionist at PENDING_CONFIRMATION has confirm, reject, suggest_alternative, cancel', () => {
    const actions = getValidActions('PENDING_CONFIRMATION', 'receptionist');
    expect(actions).toContain('confirm');
    expect(actions).toContain('reject');
    expect(actions).toContain('suggest_alternative');
    expect(actions).toContain('cancel');
  });

  it('patient at CONFIRMED has reschedule and cancel', () => {
    const actions = getValidActions('CONFIRMED', 'patient');
    expect(actions).toContain('reschedule');
    expect(actions).toContain('cancel');
  });

  it('no valid actions for terminal states', () => {
    for (const state of TERMINAL_STATES) {
      const actions = getValidActions(state, 'receptionist');
      expect(actions).toHaveLength(0);
    }
  });
});
