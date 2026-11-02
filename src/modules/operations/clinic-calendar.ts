/**
 * ZAMO-OPS-039 — Clinic Calendar.
 *
 * Five calendar views as specified in [S1]:
 *   1. Daily view — all bookings for a day
 *   2. Weekly view — bookings across a week
 *   3. By doctor — filtered to a specific doctor
 *   4. By branch — filtered to a specific branch
 *   5. By service — filtered to a specific service
 *
 * Key rules:
 *   - ❗ Conflict prevention via slot_holds (EXCLUDE constraint in DB)
 *   - ❗ Status shown as colour + icon + text (DEC-015)
 *   - Calendar shows only bookings for user's authorized branches (RBAC)
 */

import type { BookingStatus } from '../booking/booking-status.js';
import { STATUS_META } from '../booking/booking-status.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalendarView = 'daily' | 'weekly' | 'by_doctor' | 'by_branch' | 'by_service';

export interface CalendarEntry {
  id: string;
  bookingNumber: string;
  slotStart: Date;
  slotEnd: Date;
  durationMinutes: number;
  status: BookingStatus;
  isLate: boolean;
  patientId: string;
  doctorId: string;
  serviceId: string;
  branchId: string;
  /** Display metadata */
  display: CalendarEntryDisplay;
}

export interface CalendarEntryDisplay {
  /** Status label (bilingual) */
  labelAr: string;
  labelEn: string;
  /** Lucide icon for the status */
  icon: string;
  /** Badge color */
  color: string;
  /** Text color on badge */
  textColor: string;
  /** Whether this is a late booking */
  isLate: boolean;
  /** CSS class suggestion for the calendar cell */
  cssClass: string;
}

export interface TimeSlotInfo {
  hour: number;
  minute: number;
  label: string;  // "09:00", "09:30", etc.
  bookings: CalendarEntry[];
}

export interface DailyCalendarResult {
  date: Date;
  branchId: string;
  slots: TimeSlotInfo[];
  totalBookings: number;
}

export interface WeeklyCalendarResult {
  weekStart: Date;
  branchId: string;
  days: Array<{
    date: Date;
    dayLabel: string;  // "الأحد", "الإثنين", etc.
    bookings: CalendarEntry[];
  }>;
  totalBookings: number;
}

// ---------------------------------------------------------------------------
// Calendar entry display builder
// ---------------------------------------------------------------------------

/**
 * Build display metadata for a calendar entry.
 * ❗ DEC-015: status = colour + icon + text (never colour alone).
 */
export function buildEntryDisplay(
  status: BookingStatus,
  isLate: boolean,
): CalendarEntryDisplay {
  const meta = STATUS_META[status];

  // CSS class based on status for calendar cell styling
  let cssClass = `cal-${status.toLowerCase().replace(/_/g, '-')}`;
  if (isLate) {
    cssClass += ' cal-late';
  }

  return {
    labelAr: meta.labelAr,
    labelEn: meta.labelEn,
    icon: meta.icon,
    color: meta.color,
    textColor: meta.textColor,
    isLate,
    cssClass,
  };
}

/**
 * Convert a booking row into a CalendarEntry.
 */
export function toCalendarEntry(row: {
  id: string;
  booking_number: string;
  slot_start: Date;
  slot_end: Date;
  status: BookingStatus;
  is_late: boolean;
  patient_id: string;
  doctor_id: string;
  branch_service_id: string;
  branch_id?: string;
}): CalendarEntry {
  const slotStart = new Date(row.slot_start);
  const slotEnd = new Date(row.slot_end);
  const durationMinutes = Math.round(
    (slotEnd.getTime() - slotStart.getTime()) / 60_000,
  );

  return {
    id: row.id,
    bookingNumber: row.booking_number,
    slotStart,
    slotEnd,
    durationMinutes,
    status: row.status,
    isLate: row.is_late,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    serviceId: row.branch_service_id,
    branchId: row.branch_id ?? '',
    display: buildEntryDisplay(row.status, row.is_late),
  };
}

// ---------------------------------------------------------------------------
// Time slot generation
// ---------------------------------------------------------------------------

/**
 * Generate time slot labels for a daily view (30-min intervals).
 * Used for the calendar grid.
 */
export function generateTimeSlots(
  startHour: number = 8,
  endHour: number = 22,
  intervalMinutes: number = 30,
): Array<{ hour: number; minute: number; label: string }> {
  const slots: Array<{ hour: number; minute: number; label: string }> = [];

  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += intervalMinutes) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      slots.push({ hour: h, minute: m, label: `${hh}:${mm}` });
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Day labels (Arabic)
// ---------------------------------------------------------------------------

const DAY_NAMES_AR = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

const DAY_NAMES_EN = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Get the Arabic day name for a date.
 */
export function getDayNameAr(date: Date): string {
  return DAY_NAMES_AR[date.getDay()] ?? '';
}

/**
 * Get the English day name for a date.
 */
export function getDayNameEn(date: Date): string {
  return DAY_NAMES_EN[date.getDay()] ?? '';
}

// ---------------------------------------------------------------------------
// Conflict detection helper
// ---------------------------------------------------------------------------

/**
 * Check if two time ranges overlap.
 *
 * Used by the calendar view to visually indicate conflicts.
 * Actual conflict prevention is handled at the database level
 * (slot_holds EXCLUDE constraint) and in slot-generator.ts.
 */
export function hasTimeConflict(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
): boolean {
  return a.start < b.end && a.end > b.start;
}
