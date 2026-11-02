/**
 * SLA Calculator unit tests (B-28, B-29).
 */
import { describe, it, expect } from 'vitest';
import {
  calculateSlaDeadline,
  calculateAutoCancelDeadline,
  isWithinWorkingHours,
  type WorkingHoursEntry,
} from './sla.js';
import { riyadhDateTime } from '../modules/scheduling/slot-generator.js';

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

const NO_HOLIDAYS: string[] = [];

// ---------------------------------------------------------------------------
// calculateSlaDeadline
// ---------------------------------------------------------------------------
describe('calculateSlaDeadline', () => {
  it('30-min SLA during working hours completes same day', () => {
    // Sunday 10:00 + 30 min = Sunday 10:30
    const submitted = riyadhDateTime('2026-09-20', '10:00'); // Sunday
    const deadline = calculateSlaDeadline({
      submittedAt: submitted,
      targetMinutes: 30,
      workingHours: STANDARD_HOURS,
      holidays: NO_HOLIDAYS,
    });
    const expected = riyadhDateTime('2026-09-20', '10:30');
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('SLA submitted near closing rolls to next business day (B-28)', () => {
    // Sunday 16:45 + 30 min: 15 min today + 15 min tomorrow = Mon 09:15
    const submitted = riyadhDateTime('2026-09-20', '16:45'); // Sunday
    const deadline = calculateSlaDeadline({
      submittedAt: submitted,
      targetMinutes: 30,
      workingHours: STANDARD_HOURS,
      holidays: NO_HOLIDAYS,
    });
    const expected = riyadhDateTime('2026-09-21', '09:15'); // Monday
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('SLA submitted after closing starts next business morning (B-28)', () => {
    // Sunday 18:00 (after 17:00 close) + 30 min = Monday 09:30
    const submitted = riyadhDateTime('2026-09-20', '18:00');
    const deadline = calculateSlaDeadline({
      submittedAt: submitted,
      targetMinutes: 30,
      workingHours: STANDARD_HOURS,
      holidays: NO_HOLIDAYS,
    });
    const expected = riyadhDateTime('2026-09-21', '09:30');
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('SLA submitted on Friday skips to Sunday (B-28)', () => {
    // Friday (closed) + 30 min = Sunday 09:30
    const submitted = riyadhDateTime('2026-09-25', '10:00'); // Friday
    const deadline = calculateSlaDeadline({
      submittedAt: submitted,
      targetMinutes: 30,
      workingHours: STANDARD_HOURS,
      holidays: NO_HOLIDAYS,
    });
    const expected = riyadhDateTime('2026-09-27', '09:30'); // Sunday
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('SLA skips holidays (B-28)', () => {
    // Sunday is a holiday + 30 min = Monday 09:30
    const submitted = riyadhDateTime('2026-09-20', '10:00'); // Sunday
    const deadline = calculateSlaDeadline({
      submittedAt: submitted,
      targetMinutes: 30,
      workingHours: STANDARD_HOURS,
      holidays: ['2026-09-20'], // Sunday is holiday
    });
    const expected = riyadhDateTime('2026-09-21', '09:30'); // Monday
    expect(deadline.getTime()).toBe(expected.getTime());
  });

  it('SLA submitted before opening starts from opening', () => {
    // Sunday 07:00 (before 09:00 open) + 30 min = Sunday 09:30
    const submitted = riyadhDateTime('2026-09-20', '07:00');
    const deadline = calculateSlaDeadline({
      submittedAt: submitted,
      targetMinutes: 30,
      workingHours: STANDARD_HOURS,
      holidays: NO_HOLIDAYS,
    });
    const expected = riyadhDateTime('2026-09-20', '09:30');
    expect(deadline.getTime()).toBe(expected.getTime());
  });
});

// ---------------------------------------------------------------------------
// calculateAutoCancelDeadline (B-29: 24 working hours)
// ---------------------------------------------------------------------------
describe('calculateAutoCancelDeadline (B-29)', () => {
  it('24 working hours = 3 business days for 8h/day schedule', () => {
    // Sunday 09:00 + 24h working = 8h Sun + 8h Mon + 8h Tue = Tue 17:00
    const submitted = riyadhDateTime('2026-09-20', '09:00'); // Sunday
    const deadline = calculateAutoCancelDeadline({
      submittedAt: submitted,
      workingHours: STANDARD_HOURS,
      holidays: NO_HOLIDAYS,
    });
    const expected = riyadhDateTime('2026-09-22', '17:00'); // Tuesday
    expect(deadline.getTime()).toBe(expected.getTime());
  });
});

// ---------------------------------------------------------------------------
// isWithinWorkingHours
// ---------------------------------------------------------------------------
describe('isWithinWorkingHours', () => {
  it('returns true during working hours', () => {
    const at = riyadhDateTime('2026-09-20', '12:00'); // Sunday noon
    expect(isWithinWorkingHours(at, STANDARD_HOURS, NO_HOLIDAYS)).toBe(true);
  });

  it('returns false after closing', () => {
    const at = riyadhDateTime('2026-09-20', '18:00');
    expect(isWithinWorkingHours(at, STANDARD_HOURS, NO_HOLIDAYS)).toBe(false);
  });

  it('returns false on closed day (Friday)', () => {
    const at = riyadhDateTime('2026-09-25', '12:00'); // Friday
    expect(isWithinWorkingHours(at, STANDARD_HOURS, NO_HOLIDAYS)).toBe(false);
  });

  it('returns false on holiday', () => {
    const at = riyadhDateTime('2026-09-20', '12:00');
    expect(isWithinWorkingHours(at, STANDARD_HOURS, ['2026-09-20'])).toBe(false);
  });
});
