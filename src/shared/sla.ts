/**
 * ZAMO SLA Calculator — shared utility.
 *
 * Calculates SLA deadlines based on branch working hours (B-28).
 *
 * Rules:
 *   B-28: SLA runs during branch working hours only.
 *         After closing → starts next business morning.
 *         Holidays → treated as closed days.
 *   B-29: Auto-cancel after 24 working-hours without confirmation.
 *   A-14: 15–30 minute target response during working hours.
 *
 * Timezone: fixed Asia/Riyadh (UTC+3) per B-35.
 */

import {
  parseTimeToMinutes,
  riyadhDateTime,
  toRiyadhDateString,
  getDayOfWeekRiyadh,
} from '../modules/scheduling/slot-generator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkingHoursEntry {
  dayOfWeek: number;  // 0=Sun .. 6=Sat
  openTime: string;   // HH:MM
  closeTime: string;  // HH:MM
  isClosed: boolean;
}

export interface SlaParams {
  /** When the booking was submitted */
  submittedAt: Date;
  /** Target SLA in minutes (A-14: 15–30) */
  targetMinutes: number;
  /** Branch working hours (7 entries, one per day) */
  workingHours: WorkingHoursEntry[];
  /** Holiday dates (YYYY-MM-DD) for the branch */
  holidays: string[];
}

// ---------------------------------------------------------------------------
// SLA calculation (pure function)
// ---------------------------------------------------------------------------

/**
 * Calculate the SLA deadline by adding `targetMinutes` of *working time*
 * starting from `submittedAt`.
 *
 * If the submission time is outside working hours, the clock starts at
 * the next business day opening (B-28).
 *
 * The function walks day by day until all target minutes are consumed.
 * This is O(days) which is acceptable since SLA targets are measured in
 * minutes/hours, not months.
 */
export function calculateSlaDeadline(params: SlaParams): Date {
  const { submittedAt, targetMinutes, workingHours, holidays } = params;

  let remainingMinutes = targetMinutes;
  let current = new Date(submittedAt);

  // Safety: max 30 days of iteration to prevent infinite loop
  const maxIterations = 30;
  let iterations = 0;

  while (remainingMinutes > 0 && iterations < maxIterations) {
    iterations++;

    const dateStr = toRiyadhDateString(current);
    const dayOfWeek = getDayOfWeekRiyadh(current);

    // Check if this day is a working day
    const hours = workingHours.find(h => h.dayOfWeek === dayOfWeek);

    // Skip if closed, no schedule, or holiday
    if (!hours || hours.isClosed || holidays.includes(dateStr)) {
      // Advance to next day's start
      current = riyadhDateTime(nextDateStr(dateStr), '00:00');
      continue;
    }

    const openMin = parseTimeToMinutes(hours.openTime);
    const closeMin = parseTimeToMinutes(hours.closeTime);

    // Where are we in the current day?
    const currentTimeStr = formatTime(current);
    const currentMin = parseTimeToMinutes(currentTimeStr);

    // If we're before opening, start from opening
    const effectiveStart = Math.max(currentMin, openMin);

    // If we're after closing, skip to next day
    if (effectiveStart >= closeMin) {
      current = riyadhDateTime(nextDateStr(dateStr), '00:00');
      continue;
    }

    // Available minutes in this working day
    const availableMinutes = closeMin - effectiveStart;

    if (remainingMinutes <= availableMinutes) {
      // SLA deadline falls within this day
      const deadlineMin = effectiveStart + remainingMinutes;
      const deadlineTime = `${String(Math.floor(deadlineMin / 60)).padStart(2, '0')}:${String(deadlineMin % 60).padStart(2, '0')}`;
      return riyadhDateTime(dateStr, deadlineTime);
    }

    // Consume all available minutes and move to next day
    remainingMinutes -= availableMinutes;
    current = riyadhDateTime(nextDateStr(dateStr), '00:00');
  }

  // Fallback: if we ran out of iterations, return the last position
  return current;
}

/**
 * Calculate the 24-hour (working time) auto-cancel deadline (B-29).
 */
export function calculateAutoCancelDeadline(params: Omit<SlaParams, 'targetMinutes'>): Date {
  return calculateSlaDeadline({ ...params, targetMinutes: 24 * 60 });
}

/**
 * Check if a given time is within branch working hours.
 */
export function isWithinWorkingHours(
  at: Date,
  workingHours: WorkingHoursEntry[],
  holidays: string[],
): boolean {
  const dateStr = toRiyadhDateString(at);
  const dayOfWeek = getDayOfWeekRiyadh(at);

  // Holiday check
  if (holidays.includes(dateStr)) return false;

  const hours = workingHours.find(h => h.dayOfWeek === dayOfWeek);
  if (!hours || hours.isClosed) return false;

  const currentMin = parseTimeToMinutes(formatTime(at));
  const openMin = parseTimeToMinutes(hours.openTime);
  const closeMin = parseTimeToMinutes(hours.closeTime);

  return currentMin >= openMin && currentMin < closeMin;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get HH:MM string for a Date in Riyadh timezone */
function formatTime(date: Date): string {
  const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
  const riyadhTime = new Date(date.getTime() + RIYADH_OFFSET_MS);
  const h = riyadhTime.getUTCHours();
  const m = riyadhTime.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Advance a YYYY-MM-DD string by one day */
function nextDateStr(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}
