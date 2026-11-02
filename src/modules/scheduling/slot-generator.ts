/**
 * ZAMO-SCHED-027 — slot generator.
 *
 * Generates available time slots for a doctor at a branch by combining:
 *   - doctor_schedules (weekly recurring schedule)
 *   - working_hours   (branch open/close times)
 *   - doctor_leaves   (absence periods)
 *   - branch_holidays (official holidays — B-28)
 *   - bookings        (existing confirmed/pending bookings)
 *   - slot_holds      (temporary reservations — B-30)
 *
 * The slot duration comes from the branch_service (duration_minutes).
 *
 * Timezone: fixed Asia/Riyadh (UTC+3) per B-35.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeSlot {
  /** Doctor performing the service */
  doctorId: string;
  /** Branch where the appointment takes place */
  branchId: string;
  /** Slot start (Asia/Riyadh) */
  start: Date;
  /** Slot end (Asia/Riyadh) */
  end: Date;
  /** Duration in minutes (from branch_service) */
  durationMinutes: number;
  /** Whether the slot is available for booking */
  isAvailable: boolean;
  /** Reason slot is unavailable (if applicable) */
  unavailableReason?: 'booked' | 'held' | 'leave' | 'holiday' | 'closed' | 'past';
}

export interface SlotGenerationParams {
  doctorId: string;
  branchId: string;
  /** The service determines slot duration */
  branchServiceId: string;
  /** Date range to generate slots for (inclusive) */
  dateRange: { from: Date; to: Date };
}

export interface DoctorScheduleRow {
  dayOfWeek: number;    // 0=Sun .. 6=Sat
  startTime: string;    // HH:MM
  endTime: string;      // HH:MM
  slotDurationMinutes: number;
  isActive: boolean;
}

export interface WorkingHoursRow {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface LeaveRow {
  startDate: string;    // YYYY-MM-DD
  endDate: string;
}

export interface HolidayRow {
  holidayDate: string;  // YYYY-MM-DD
}

export interface BookedSlotRow {
  slotStart: Date;
  slotEnd: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Saudi Arabia timezone (B-35: fixed, no multi-tz in MVP) */
export const RIYADH_TZ = 'Asia/Riyadh';
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3

// ---------------------------------------------------------------------------
// Core logic (pure functions — no DB dependency)
// ---------------------------------------------------------------------------

/**
 * Parse a time string "HH:MM" into minutes since midnight.
 */
export function parseTimeToMinutes(time: string): number {
  const parts = time.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return h * 60 + m;
}

/**
 * Get the day of week (0=Sun) for a date in Riyadh timezone.
 */
export function getDayOfWeekRiyadh(date: Date): number {
  const riyadhTime = new Date(date.getTime() + RIYADH_OFFSET_MS);
  return riyadhTime.getUTCDay();
}

/**
 * Get YYYY-MM-DD string for a date in Riyadh timezone.
 */
export function toRiyadhDateString(date: Date): string {
  const riyadhTime = new Date(date.getTime() + RIYADH_OFFSET_MS);
  return riyadhTime.toISOString().slice(0, 10);
}

/**
 * Create a Date from a Riyadh-local date string and time string.
 * e.g. ("2026-09-17", "09:00") → Date representing 09:00 Asia/Riyadh
 */
export function riyadhDateTime(dateStr: string, timeStr: string): Date {
  const dateParts = dateStr.split('-').map(Number);
  const timeParts = timeStr.split(':').map(Number);
  const year = dateParts[0] ?? 0;
  const month = dateParts[1] ?? 1;
  const day = dateParts[2] ?? 1;
  const hour = timeParts[0] ?? 0;
  const minute = timeParts[1] ?? 0;
  // Build UTC date then subtract Riyadh offset
  const utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  return new Date(utc - RIYADH_OFFSET_MS);
}

/**
 * Check if two time ranges overlap.
 */
export function rangesOverlap(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Enumerate dates in a range (inclusive), returning YYYY-MM-DD strings
 * in Riyadh timezone.
 */
export function enumerateDates(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const current = new Date(from);
  // Normalize to start of day in Riyadh
  while (current <= to) {
    dates.push(toRiyadhDateString(current));
    current.setTime(current.getTime() + 24 * 60 * 60 * 1000);
  }
  // Deduplicate (in case of DST-like edge cases, though Riyadh has none)
  return [...new Set(dates)];
}

/**
 * Generate time slots for a single day, given the doctor's schedule and
 * branch working hours.
 *
 * This is a pure function — it does not query the database.
 */
export function generateSlotsForDay(params: {
  dateStr: string;
  doctorSchedule: DoctorScheduleRow | undefined;
  branchHours: WorkingHoursRow | undefined;
  serviceDurationMinutes: number;
  leaves: LeaveRow[];
  holidays: HolidayRow[];
  bookedSlots: BookedSlotRow[];
  heldSlots: BookedSlotRow[];
  now: Date;
  doctorId: string;
  branchId: string;
}): TimeSlot[] {
  const {
    dateStr, doctorSchedule, branchHours, serviceDurationMinutes,
    leaves, holidays, bookedSlots, heldSlots, now, doctorId, branchId,
  } = params;

  const slots: TimeSlot[] = [];

  // 1. No doctor schedule for this day → no slots
  if (!doctorSchedule || !doctorSchedule.isActive) return slots;

  // 2. Branch is closed
  if (!branchHours || branchHours.isClosed) return slots;

  // 3. Holiday
  if (holidays.some(h => h.holidayDate === dateStr)) return slots;

  // 4. Doctor on leave
  if (leaves.some(l => dateStr >= l.startDate && dateStr <= l.endDate)) return slots;

  // 5. Calculate effective time range (intersection of doctor schedule and branch hours)
  const docStartMin = parseTimeToMinutes(doctorSchedule.startTime);
  const docEndMin = parseTimeToMinutes(doctorSchedule.endTime);
  const branchOpenMin = parseTimeToMinutes(branchHours.openTime);
  const branchCloseMin = parseTimeToMinutes(branchHours.closeTime);

  const effectiveStartMin = Math.max(docStartMin, branchOpenMin);
  const effectiveEndMin = Math.min(docEndMin, branchCloseMin);

  if (effectiveStartMin >= effectiveEndMin) return slots;

  // 6. Generate slots within the effective range
  const duration = serviceDurationMinutes;
  let currentMin = effectiveStartMin;

  while (currentMin + duration <= effectiveEndMin) {
    const startTimeStr = `${String(Math.floor(currentMin / 60)).padStart(2, '0')}:${String(currentMin % 60).padStart(2, '0')}`;
    const endMin = currentMin + duration;
    const endTimeStr = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    const slotStart = riyadhDateTime(dateStr, startTimeStr);
    const slotEnd = riyadhDateTime(dateStr, endTimeStr);
    const slotRange = { start: slotStart, end: slotEnd };

    // Determine availability
    let isAvailable = true;
    let unavailableReason: TimeSlot['unavailableReason'];

    // Past slots
    if (slotStart < now) {
      isAvailable = false;
      unavailableReason = 'past';
    }

    // Booked slots
    if (isAvailable && bookedSlots.some(b => rangesOverlap(slotRange, { start: b.slotStart, end: b.slotEnd }))) {
      isAvailable = false;
      unavailableReason = 'booked';
    }

    // Held slots (soft reserve)
    if (isAvailable && heldSlots.some(h => rangesOverlap(slotRange, { start: h.slotStart, end: h.slotEnd }))) {
      isAvailable = false;
      unavailableReason = 'held';
    }

    const slot: TimeSlot = {
      doctorId,
      branchId,
      start: slotStart,
      end: slotEnd,
      durationMinutes: duration,
      isAvailable,
    };
    if (unavailableReason) {
      slot.unavailableReason = unavailableReason;
    }
    slots.push(slot);

    currentMin += doctorSchedule.slotDurationMinutes;
  }

  return slots;
}

/**
 * Generate all slots for a date range, combining all data sources.
 *
 * This is the orchestrator function called by the service layer.
 * In production, the data parameters would come from DB queries.
 */
export function generateAllSlots(params: {
  dateRange: { from: Date; to: Date };
  doctorId: string;
  branchId: string;
  serviceDurationMinutes: number;
  doctorSchedules: DoctorScheduleRow[];
  branchWorkingHours: WorkingHoursRow[];
  leaves: LeaveRow[];
  holidays: HolidayRow[];
  bookedSlots: BookedSlotRow[];
  heldSlots: BookedSlotRow[];
  now?: Date;
}): TimeSlot[] {
  const {
    dateRange, doctorId, branchId, serviceDurationMinutes,
    doctorSchedules, branchWorkingHours, leaves, holidays,
    bookedSlots, heldSlots,
  } = params;
  const now = params.now ?? new Date();

  const dates = enumerateDates(dateRange.from, dateRange.to);
  const allSlots: TimeSlot[] = [];

  for (const dateStr of dates) {
    // Parse the date to get the day of week
    const parts = dateStr.split('-').map(Number);
    const y = parts[0] ?? 0;
    const mo = parts[1] ?? 1;
    const dy = parts[2] ?? 1;
    const tempDate = new Date(Date.UTC(y, mo - 1, dy, 12, 0, 0));
    const dayOfWeek = getDayOfWeekRiyadh(tempDate);

    const doctorSchedule = doctorSchedules.find(s => s.dayOfWeek === dayOfWeek);
    const branchHours = branchWorkingHours.find(h => h.dayOfWeek === dayOfWeek);

    const daySlots = generateSlotsForDay({
      dateStr,
      doctorSchedule,
      branchHours,
      serviceDurationMinutes,
      leaves,
      holidays,
      bookedSlots,
      heldSlots,
      now,
      doctorId,
      branchId,
    });

    allSlots.push(...daySlots);
  }

  return allSlots;
}
