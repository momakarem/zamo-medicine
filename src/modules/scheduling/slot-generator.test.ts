/**
 * ZAMO-SCHED-027 — slot generator unit tests.
 *
 * Tests the pure slot generation logic without any DB dependency.
 */
import { describe, it, expect } from 'vitest';
import {
  generateSlotsForDay,
  generateAllSlots,
  parseTimeToMinutes,
  getDayOfWeekRiyadh,
  toRiyadhDateString,
  riyadhDateTime,
  rangesOverlap,
  enumerateDates,
  type DoctorScheduleRow,
  type WorkingHoursRow,
  type LeaveRow,
  type HolidayRow,
  type BookedSlotRow,
} from './slot-generator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOCTOR_ID = 'doc-001';
const BRANCH_ID = 'br-001';

/** Standard Sunday schedule: 09:00–17:00, 30-min slots */
const sundaySchedule: DoctorScheduleRow = {
  dayOfWeek: 0, // Sunday
  startTime: '09:00',
  endTime: '17:00',
  slotDurationMinutes: 30,
  isActive: true,
};

/** Standard branch hours: 08:00–20:00 */
const sundayBranchHours: WorkingHoursRow = {
  dayOfWeek: 0,
  openTime: '08:00',
  closeTime: '20:00',
  isClosed: false,
};

/** A date that is a Sunday in Riyadh TZ: 2026-09-20 */
const SUNDAY_DATE = '2026-09-20';

/** Far-past "now" so no slots are filtered as past */
const PAST_NOW = new Date('2020-01-01T00:00:00Z');

function makeBaseParams() {
  return {
    dateStr: SUNDAY_DATE,
    doctorSchedule: sundaySchedule,
    branchHours: sundayBranchHours,
    serviceDurationMinutes: 30,
    leaves: [] as LeaveRow[],
    holidays: [] as HolidayRow[],
    bookedSlots: [] as BookedSlotRow[],
    heldSlots: [] as BookedSlotRow[],
    now: PAST_NOW,
    doctorId: DOCTOR_ID,
    branchId: BRANCH_ID,
  };
}

// ---------------------------------------------------------------------------
// parseTimeToMinutes
// ---------------------------------------------------------------------------
describe('parseTimeToMinutes', () => {
  it('parses 09:00 correctly', () => {
    expect(parseTimeToMinutes('09:00')).toBe(540);
  });

  it('parses 17:30 correctly', () => {
    expect(parseTimeToMinutes('17:30')).toBe(1050);
  });

  it('parses 00:00 correctly', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// riyadhDateTime
// ---------------------------------------------------------------------------
describe('riyadhDateTime', () => {
  it('creates correct UTC date for Riyadh 09:00', () => {
    const dt = riyadhDateTime('2026-09-20', '09:00');
    // 09:00 Riyadh = 06:00 UTC
    expect(dt.getUTCHours()).toBe(6);
    expect(dt.getUTCMinutes()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rangesOverlap
// ---------------------------------------------------------------------------
describe('rangesOverlap', () => {
  it('detects overlapping ranges', () => {
    const a = { start: new Date('2026-09-20T09:00Z'), end: new Date('2026-09-20T09:30Z') };
    const b = { start: new Date('2026-09-20T09:15Z'), end: new Date('2026-09-20T09:45Z') };
    expect(rangesOverlap(a, b)).toBe(true);
  });

  it('non-overlapping ranges (adjacent)', () => {
    const a = { start: new Date('2026-09-20T09:00Z'), end: new Date('2026-09-20T09:30Z') };
    const b = { start: new Date('2026-09-20T09:30Z'), end: new Date('2026-09-20T10:00Z') };
    expect(rangesOverlap(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateSlotsForDay
// ---------------------------------------------------------------------------
describe('generateSlotsForDay', () => {
  it('generates correct number of 30-min slots for 09:00–17:00', () => {
    const slots = generateSlotsForDay(makeBaseParams());
    // 8 hours = 480 min / 30 min = 16 slots
    expect(slots).toHaveLength(16);
    expect(slots.every(s => s.isAvailable)).toBe(true);
  });

  it('respects service duration longer than slot grid', () => {
    const params = makeBaseParams();
    params.serviceDurationMinutes = 60; // 1-hour service in 30-min grid
    const slots = generateSlotsForDay(params);
    // Still 16 start points, but each needs 60 min to fit
    // Last valid start: 16:00 (16:00 + 60 = 17:00 ✓), 16:30 + 60 = 17:30 ✗
    expect(slots).toHaveLength(15);
  });

  it('returns empty for no doctor schedule', () => {
    const params = makeBaseParams();
    params.doctorSchedule = undefined as unknown as DoctorScheduleRow;
    expect(generateSlotsForDay(params)).toHaveLength(0);
  });

  it('returns empty for inactive doctor schedule', () => {
    const params = makeBaseParams();
    params.doctorSchedule = { ...sundaySchedule, isActive: false };
    expect(generateSlotsForDay(params)).toHaveLength(0);
  });

  it('returns empty when branch is closed', () => {
    const params = makeBaseParams();
    params.branchHours = { ...sundayBranchHours, isClosed: true };
    expect(generateSlotsForDay(params)).toHaveLength(0);
  });

  it('returns empty on holiday (B-28)', () => {
    const params = makeBaseParams();
    params.holidays = [{ holidayDate: SUNDAY_DATE }];
    expect(generateSlotsForDay(params)).toHaveLength(0);
  });

  it('returns empty when doctor is on leave', () => {
    const params = makeBaseParams();
    params.leaves = [{ startDate: '2026-09-19', endDate: '2026-09-21' }];
    expect(generateSlotsForDay(params)).toHaveLength(0);
  });

  it('narrows slots to branch hours when doctor schedule is wider', () => {
    const params = makeBaseParams();
    // Doctor: 07:00–18:00 but branch opens 10:00–15:00
    params.doctorSchedule = { ...sundaySchedule, startTime: '07:00', endTime: '18:00' };
    params.branchHours = { ...sundayBranchHours, openTime: '10:00', closeTime: '15:00' };
    const slots = generateSlotsForDay(params);
    // 5 hours = 300 min / 30 = 10 slots
    expect(slots).toHaveLength(10);
    // First slot starts at 10:00 Riyadh
    expect(slots[0]!.start).toEqual(riyadhDateTime(SUNDAY_DATE, '10:00'));
  });

  it('marks booked slots as unavailable', () => {
    const params = makeBaseParams();
    params.bookedSlots = [{
      slotStart: riyadhDateTime(SUNDAY_DATE, '10:00'),
      slotEnd: riyadhDateTime(SUNDAY_DATE, '10:30'),
    }];
    const slots = generateSlotsForDay(params);
    const slot10 = slots.find(s => s.start.getTime() === riyadhDateTime(SUNDAY_DATE, '10:00').getTime());
    expect(slot10).toBeDefined();
    expect(slot10!.isAvailable).toBe(false);
    expect(slot10!.unavailableReason).toBe('booked');
  });

  it('marks held slots as unavailable (B-30)', () => {
    const params = makeBaseParams();
    params.heldSlots = [{
      slotStart: riyadhDateTime(SUNDAY_DATE, '11:00'),
      slotEnd: riyadhDateTime(SUNDAY_DATE, '11:30'),
    }];
    const slots = generateSlotsForDay(params);
    const slot11 = slots.find(s => s.start.getTime() === riyadhDateTime(SUNDAY_DATE, '11:00').getTime());
    expect(slot11).toBeDefined();
    expect(slot11!.isAvailable).toBe(false);
    expect(slot11!.unavailableReason).toBe('held');
  });

  it('marks past slots as unavailable', () => {
    const params = makeBaseParams();
    // Set "now" to 12:00 Riyadh on the same day
    params.now = riyadhDateTime(SUNDAY_DATE, '12:00');
    const slots = generateSlotsForDay(params);

    const pastSlots = slots.filter(s => !s.isAvailable && s.unavailableReason === 'past');
    // 09:00, 09:30, 10:00, 10:30, 11:00, 11:30 = 6 past slots
    expect(pastSlots).toHaveLength(6);

    const futureSlots = slots.filter(s => s.isAvailable);
    // 12:00–16:30 = 10 available slots
    expect(futureSlots).toHaveLength(10);
  });

  it('all slots carry correct doctorId and branchId', () => {
    const slots = generateSlotsForDay(makeBaseParams());
    expect(slots.every(s => s.doctorId === DOCTOR_ID)).toBe(true);
    expect(slots.every(s => s.branchId === BRANCH_ID)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateAllSlots
// ---------------------------------------------------------------------------
describe('generateAllSlots', () => {
  it('generates slots across multiple days', () => {
    const from = riyadhDateTime('2026-09-20', '00:00'); // Sunday
    const to = riyadhDateTime('2026-09-21', '23:59');   // Monday

    const mondaySchedule: DoctorScheduleRow = {
      dayOfWeek: 1, // Monday
      startTime: '09:00',
      endTime: '13:00',
      slotDurationMinutes: 30,
      isActive: true,
    };

    const mondayBranchHours: WorkingHoursRow = {
      dayOfWeek: 1,
      openTime: '08:00',
      closeTime: '20:00',
      isClosed: false,
    };

    const slots = generateAllSlots({
      dateRange: { from, to },
      doctorId: DOCTOR_ID,
      branchId: BRANCH_ID,
      serviceDurationMinutes: 30,
      doctorSchedules: [sundaySchedule, mondaySchedule],
      branchWorkingHours: [sundayBranchHours, mondayBranchHours],
      leaves: [],
      holidays: [],
      bookedSlots: [],
      heldSlots: [],
      now: PAST_NOW,
    });

    // Sunday: 16 slots + Monday: 8 slots = 24
    expect(slots).toHaveLength(24);
  });

  it('skips days with no doctor schedule', () => {
    const from = riyadhDateTime('2026-09-20', '00:00'); // Sunday
    const to = riyadhDateTime('2026-09-21', '23:59');   // Monday (no schedule)

    const slots = generateAllSlots({
      dateRange: { from, to },
      doctorId: DOCTOR_ID,
      branchId: BRANCH_ID,
      serviceDurationMinutes: 30,
      doctorSchedules: [sundaySchedule], // Only Sunday
      branchWorkingHours: [sundayBranchHours, { dayOfWeek: 1, openTime: '08:00', closeTime: '20:00', isClosed: false }],
      leaves: [],
      holidays: [],
      bookedSlots: [],
      heldSlots: [],
      now: PAST_NOW,
    });

    // Only Sunday slots
    expect(slots).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// enumerateDates
// ---------------------------------------------------------------------------
describe('enumerateDates', () => {
  it('enumerates 3 consecutive days', () => {
    const from = riyadhDateTime('2026-09-20', '00:00');
    const to = riyadhDateTime('2026-09-22', '23:59');
    const dates = enumerateDates(from, to);
    expect(dates).toContain('2026-09-20');
    expect(dates).toContain('2026-09-21');
    expect(dates).toContain('2026-09-22');
    expect(dates.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// getDayOfWeekRiyadh / toRiyadhDateString
// ---------------------------------------------------------------------------
describe('timezone helpers', () => {
  it('getDayOfWeekRiyadh returns Sunday=0 for 2026-09-20', () => {
    const dt = riyadhDateTime('2026-09-20', '12:00');
    expect(getDayOfWeekRiyadh(dt)).toBe(0); // Sunday
  });

  it('toRiyadhDateString formats correctly', () => {
    const dt = riyadhDateTime('2026-09-20', '23:30');
    expect(toRiyadhDateString(dt)).toBe('2026-09-20');
  });
});
