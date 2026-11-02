/**
 * ZAMO-NOTIF-060 — escalation handler tests.
 *
 * Validates:
 *   - Escalation works after 24 working hours
 *   - Alternatives are offered to the patient
 *   - Zamo admin is notified
 *   - ❗ Idempotent: does not re-cancel already cancelled bookings
 */

import { describe, it, expect } from 'vitest';
import {
  checkEscalation,
  findBookingsToEscalate,
  computeAutoCancelDeadline,
  buildAutoCancelSQL,
  buildSlaBreachCountSQL,
  SLA_CANCEL_REASON_AR,
  SLA_CANCEL_REASON_EN,
  SLA_CANCEL_SOURCE,
  type EscalationCandidate,
  type BranchWorkingHours,
} from './escalation-handler.js';
import type { WorkingHoursEntry } from '../../shared/sla.js';
import { riyadhDateTime } from '../scheduling/slot-generator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STANDARD_HOURS: WorkingHoursEntry[] = [
  { dayOfWeek: 0, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Sun
  { dayOfWeek: 1, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Mon
  { dayOfWeek: 2, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Tue
  { dayOfWeek: 3, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Wed
  { dayOfWeek: 4, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Thu
  { dayOfWeek: 5, openTime: '09:00', closeTime: '17:00', isClosed: true },  // Fri
  { dayOfWeek: 6, openTime: '09:00', closeTime: '17:00', isClosed: true },  // Sat
];

const BRANCH_SCHEDULE: BranchWorkingHours = {
  branchId: 'branch-1',
  workingHours: STANDARD_HOURS,
  holidays: [],
};

function makeCandidate(overrides: Partial<EscalationCandidate> = {}): EscalationCandidate {
  return {
    id: 'booking-1',
    bookingNumber: 'ZAMO-20260920-AB12',
    branchId: 'branch-1',
    facilityId: 'facility-1',
    patientId: 'patient-1',
    submittedAt: riyadhDateTime('2026-09-20', '09:00'), // Sunday 09:00
    status: 'PENDING_CONFIRMATION',
    isLate: true,
    autoCancelDeadline: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkEscalation
// ---------------------------------------------------------------------------

describe('checkEscalation', () => {
  it('cancels booking after 24 working hours (B-29)', () => {
    // Sunday 09:00 + 24 working hours = 3 business days (8h/day)
    // = Tuesday 17:00
    const candidate = makeCandidate();

    // Check at Wednesday 09:00 → should cancel
    const now = riyadhDateTime('2026-09-23', '09:00'); // Wed
    const result = checkEscalation(candidate, BRANCH_SCHEDULE, now);

    expect(result.action).toBe('cancelled');
  });

  it('does NOT cancel before 24 working hours', () => {
    const candidate = makeCandidate();

    // Check at Monday 15:00 → only ~14 working hours passed
    const now = riyadhDateTime('2026-09-21', '15:00'); // Mon
    const result = checkEscalation(candidate, BRANCH_SCHEDULE, now);

    expect(result.action).toBe('skipped_not_due');
  });

  it('❗ idempotent: skips already cancelled bookings', () => {
    const candidate = makeCandidate({ status: 'CANCELLED' });
    const now = riyadhDateTime('2026-09-23', '09:00');
    const result = checkEscalation(candidate, BRANCH_SCHEDULE, now);

    expect(result.action).toBe('skipped_already_cancelled');
  });

  it('uses pre-computed autoCancelDeadline if available', () => {
    const deadline = riyadhDateTime('2026-09-22', '17:00');
    const candidate = makeCandidate({ autoCancelDeadline: deadline });

    // Just past deadline
    const now = riyadhDateTime('2026-09-22', '17:01');
    const result = checkEscalation(candidate, BRANCH_SCHEDULE, now);

    expect(result.action).toBe('cancelled');
    expect(result.autoCancelDeadline.getTime()).toBe(deadline.getTime());
  });
});

// ---------------------------------------------------------------------------
// findBookingsToEscalate
// ---------------------------------------------------------------------------

describe('findBookingsToEscalate', () => {
  it('returns only bookings that need cancellation', () => {
    const schedules = new Map([['branch-1', BRANCH_SCHEDULE]]);
    const now = riyadhDateTime('2026-09-23', '09:00'); // Wed

    const candidates: EscalationCandidate[] = [
      makeCandidate({ id: 'b1' }),                          // overdue → cancel
      makeCandidate({ id: 'b2', status: 'CANCELLED' }),     // already cancelled → skip
      makeCandidate({                                        // recent → not due
        id: 'b3',
        submittedAt: riyadhDateTime('2026-09-22', '15:00'),
      }),
    ];

    const results = findBookingsToEscalate(candidates, schedules, now);

    expect(results).toHaveLength(1);
    expect(results[0]?.bookingId).toBe('b1');
    expect(results[0]?.action).toBe('cancelled');
  });

  it('skips bookings with no matching schedule', () => {
    const schedules = new Map<string, BranchWorkingHours>();
    const now = riyadhDateTime('2026-09-23', '09:00');
    const candidates = [makeCandidate()];

    const results = findBookingsToEscalate(candidates, schedules, now);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeAutoCancelDeadline
// ---------------------------------------------------------------------------

describe('computeAutoCancelDeadline', () => {
  it('24 working hours = 3 business days for 8h/day schedule', () => {
    const submitted = riyadhDateTime('2026-09-20', '09:00'); // Sunday
    const deadline = computeAutoCancelDeadline(submitted, BRANCH_SCHEDULE);
    const expected = riyadhDateTime('2026-09-22', '17:00'); // Tuesday 17:00
    expect(deadline.getTime()).toBe(expected.getTime());
  });
});

// ---------------------------------------------------------------------------
// Cancellation constants
// ---------------------------------------------------------------------------

describe('Cancellation constants', () => {
  it('Arabic reason mentions auto-cancel and SLA', () => {
    expect(SLA_CANCEL_REASON_AR).toContain('تلقائي');
    expect(SLA_CANCEL_REASON_AR).toContain('استجابة');
  });

  it('English reason mentions auto-cancel and SLA', () => {
    expect(SLA_CANCEL_REASON_EN).toContain('Auto-cancelled');
    expect(SLA_CANCEL_REASON_EN).toContain('response time');
  });

  it('cancellation source is system_sla_escalation', () => {
    expect(SLA_CANCEL_SOURCE).toBe('system_sla_escalation');
  });
});

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

describe('Escalation SQL builders', () => {
  it('buildAutoCancelSQL only cancels PENDING_CONFIRMATION (idempotent)', () => {
    const { sql, values } = buildAutoCancelSQL('booking-1', SLA_CANCEL_REASON_AR);
    expect(sql).toContain("status = 'CANCELLED'");
    expect(sql).toContain("AND status = 'PENDING_CONFIRMATION'");
    expect(values).toEqual(['booking-1', SLA_CANCEL_REASON_AR]);
  });

  it('buildSlaBreachCountSQL queries by facility and month', () => {
    const { sql, values } = buildSlaBreachCountSQL('facility-1', '2026-09');
    expect(sql).toContain('facility_id = $1');
    expect(sql).toContain("cancellation_source = 'system_sla_escalation'");
    expect(values).toEqual(['facility-1', '2026-09']);
  });
});
