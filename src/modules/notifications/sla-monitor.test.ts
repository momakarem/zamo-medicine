/**
 * ZAMO-NOTIF-059 — SLA monitor tests.
 *
 * Validates:
 *   - Overdue booking is marked as late automatically
 *   - ❗ Late flag appears in reception dashboard query
 *   - ❗ SLA clock respects branch working hours (B-28)
 *   - On-time booking is NOT marked as late
 */

import { describe, it, expect } from 'vitest';
import {
  checkBookingSla,
  findNewlyOverdueBookings,
  computeSlaDeadlineForBooking,
  buildFindOverdueBookingsSQL,
  buildLateBookingsForDashboardSQL,
  type PendingBooking,
  type BranchSchedule,
} from './sla-monitor.js';
import type { WorkingHoursEntry } from '../../shared/sla.js';
import { riyadhDateTime } from '../scheduling/slot-generator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard working hours: Sun-Thu 09:00-17:00, Fri-Sat closed */
const STANDARD_HOURS: WorkingHoursEntry[] = [
  { dayOfWeek: 0, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Sun
  { dayOfWeek: 1, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Mon
  { dayOfWeek: 2, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Tue
  { dayOfWeek: 3, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Wed
  { dayOfWeek: 4, openTime: '09:00', closeTime: '17:00', isClosed: false }, // Thu
  { dayOfWeek: 5, openTime: '09:00', closeTime: '17:00', isClosed: true },  // Fri
  { dayOfWeek: 6, openTime: '09:00', closeTime: '17:00', isClosed: true },  // Sat
];

const BRANCH_SCHEDULE: BranchSchedule = {
  branchId: 'branch-1',
  workingHours: STANDARD_HOURS,
  holidays: [],
};

function makeBooking(overrides: Partial<PendingBooking> = {}): PendingBooking {
  return {
    id: 'booking-1',
    bookingNumber: 'ZAMO-20260920-AB12',
    branchId: 'branch-1',
    facilityId: 'facility-1',
    patientId: 'patient-1',
    submittedAt: riyadhDateTime('2026-09-20', '10:00'), // Sunday 10:00
    slaDeadline: null,
    isLate: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkBookingSla
// ---------------------------------------------------------------------------

describe('checkBookingSla', () => {
  it('booking checked during SLA window is NOT overdue', () => {
    // Submitted Sunday 10:00, SLA=30min → deadline 10:30
    // Check at 10:15 → not overdue
    const booking = makeBooking();
    const now = riyadhDateTime('2026-09-20', '10:15');
    const result = checkBookingSla(booking, BRANCH_SCHEDULE, 30, now);

    expect(result.isOverdue).toBe(false);
    expect(result.minutesOverdue).toBe(0);
  });

  it('booking checked after SLA window IS overdue', () => {
    // Submitted Sunday 10:00, SLA=30min → deadline 10:30
    // Check at 11:00 → overdue by 30 minutes
    const booking = makeBooking();
    const now = riyadhDateTime('2026-09-20', '11:00');
    const result = checkBookingSla(booking, BRANCH_SCHEDULE, 30, now);

    expect(result.isOverdue).toBe(true);
    expect(result.minutesOverdue).toBe(30);
  });

  it('uses pre-computed slaDeadline if available', () => {
    const deadline = riyadhDateTime('2026-09-20', '10:30');
    const booking = makeBooking({ slaDeadline: deadline });
    const now = riyadhDateTime('2026-09-20', '10:45');
    const result = checkBookingSla(booking, BRANCH_SCHEDULE, 30, now);

    expect(result.isOverdue).toBe(true);
    expect(result.slaDeadline.getTime()).toBe(deadline.getTime());
  });

  it('❗ SLA clock respects working hours — after-close submission starts next morning (B-28)', () => {
    // Submitted Sunday 16:50, SLA=30min
    // 10 min remaining today + 20 min tomorrow = Mon 09:20
    const booking = makeBooking({
      submittedAt: riyadhDateTime('2026-09-20', '16:50'),
    });

    // Check at Monday 09:10 → not overdue yet
    const earlyCheck = riyadhDateTime('2026-09-21', '09:10');
    const earlyResult = checkBookingSla(booking, BRANCH_SCHEDULE, 30, earlyCheck);
    expect(earlyResult.isOverdue).toBe(false);

    // Check at Monday 09:25 → overdue
    const lateCheck = riyadhDateTime('2026-09-21', '09:25');
    const lateResult = checkBookingSla(booking, BRANCH_SCHEDULE, 30, lateCheck);
    expect(lateResult.isOverdue).toBe(true);
  });

  it('❗ SLA clock skips holidays (B-28)', () => {
    // Sunday is a holiday, SLA=30min
    // Should start Monday 09:00 → deadline Mon 09:30
    const booking = makeBooking({
      submittedAt: riyadhDateTime('2026-09-20', '10:00'), // Sunday
    });
    const scheduleWithHoliday: BranchSchedule = {
      ...BRANCH_SCHEDULE,
      holidays: ['2026-09-20'], // Sunday is holiday
    };

    // Check at Monday 09:25 → not overdue (deadline is 09:30)
    const earlyCheck = riyadhDateTime('2026-09-21', '09:25');
    const earlyResult = checkBookingSla(booking, scheduleWithHoliday, 30, earlyCheck);
    expect(earlyResult.isOverdue).toBe(false);

    // Check at Monday 09:35 → overdue
    const lateCheck = riyadhDateTime('2026-09-21', '09:35');
    const lateResult = checkBookingSla(booking, scheduleWithHoliday, 30, lateCheck);
    expect(lateResult.isOverdue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findNewlyOverdueBookings
// ---------------------------------------------------------------------------

describe('findNewlyOverdueBookings', () => {
  it('returns only newly overdue bookings (not already late)', () => {
    const schedules = new Map([['branch-1', BRANCH_SCHEDULE]]);
    const now = riyadhDateTime('2026-09-20', '11:00');

    const bookings: PendingBooking[] = [
      makeBooking({ id: 'b1', isLate: false }), // newly overdue
      makeBooking({ id: 'b2', isLate: true }),   // already late — skip
      makeBooking({                              // on time — skip
        id: 'b3',
        submittedAt: riyadhDateTime('2026-09-20', '10:50'),
      }),
    ];

    const results = findNewlyOverdueBookings(bookings, schedules, 30, now);

    expect(results).toHaveLength(1);
    expect(results[0]?.bookingId).toBe('b1');
  });

  it('skips bookings with no matching schedule', () => {
    const schedules = new Map<string, BranchSchedule>(); // empty
    const now = riyadhDateTime('2026-09-20', '11:00');
    const bookings = [makeBooking()];

    const results = findNewlyOverdueBookings(bookings, schedules, 30, now);
    expect(results).toHaveLength(0);
  });

  it('on-time booking is NOT marked as late', () => {
    const schedules = new Map([['branch-1', BRANCH_SCHEDULE]]);
    const now = riyadhDateTime('2026-09-20', '10:15'); // within 30min SLA

    const bookings = [makeBooking()];
    const results = findNewlyOverdueBookings(bookings, schedules, 30, now);

    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeSlaDeadlineForBooking
// ---------------------------------------------------------------------------

describe('computeSlaDeadlineForBooking', () => {
  it('computes correct deadline for standard submission', () => {
    const submitted = riyadhDateTime('2026-09-20', '10:00');
    const deadline = computeSlaDeadlineForBooking(submitted, BRANCH_SCHEDULE, 30);
    const expected = riyadhDateTime('2026-09-20', '10:30');
    expect(deadline.getTime()).toBe(expected.getTime());
  });
});

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

describe('SLA Monitor SQL builders', () => {
  it('buildFindOverdueBookingsSQL filters correctly', () => {
    const { sql, values } = buildFindOverdueBookingsSQL(new Date());
    expect(sql).toContain("status = 'PENDING_CONFIRMATION'");
    expect(sql).toContain('is_late = false');
    expect(sql).toContain('sla_deadline < $1');
    expect(values).toHaveLength(1);
  });

  it('❗ buildLateBookingsForDashboardSQL shows late bookings in dashboard', () => {
    const { sql, values } = buildLateBookingsForDashboardSQL('branch-1');
    expect(sql).toContain('is_late = true');
    expect(sql).toContain('branch_id = $1');
    expect(values).toEqual(['branch-1']);
  });
});
