/**
 * ZAMO-OPS-037 / ZAMO-OPS-038 — Reception Dashboard.
 *
 * «هذه أهم شاشة تشغيلية» `[S1]`
 *
 * Provides:
 *   - 6 dashboard indicators (total, pending, late, confirmed, attended, service_done)
 *   - Booking list with 9 columns (❗ phone masked)
 *   - 8 quick-action buttons
 *   - Late booking highlighting (❗ visually and textually)
 *   - Branch-scoped filtering (receptionist sees own branch only)
 *
 * Key rules:
 *   - ❗ Phone partially masked in the table (05X XXX XX34)
 *   - ❗ Late bookings highlighted visually AND textually (DEC-015)
 *   - ❗ Receptionist sees own branch bookings only (RBAC Layer 2b)
 *   - ❗ Rejection requires recorded reason (B-07)
 */

import type { BookingStatus } from '../booking/booking-status.js';
import { STATUS_META, LATE_FLAG } from '../booking/booking-status.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardStats {
  totalToday: number;
  pending: number;
  late: number;
  confirmed: number;
  attended: number;
  serviceDone: number;
  collected: number;
}

export interface DashboardBooking {
  id: string;
  bookingNumber: string;
  slotStart: Date;
  slotEnd: Date;
  patientId: string;
  patientName?: string;
  /** ❗ Partially masked phone number (05X XXX XX34) */
  patientPhoneMasked: string;
  doctorId: string;
  doctorName?: string;
  serviceId: string;
  serviceName?: string;
  status: BookingStatus;
  isLate: boolean;
  slaDeadline: Date | null;
  rescheduleCount: number;
  /** Available quick actions for the current status. */
  availableActions: QuickAction[];
}

export type QuickAction =
  | 'confirm'
  | 'reject'
  | 'suggest_alternative'
  | 'record_attendance'
  | 'record_no_show'
  | 'record_service'
  | 'cancel'
  | 'reschedule';

// ---------------------------------------------------------------------------
// Phone masking — ❗ [S1]: «الجوال مخفي جزئيًا»
// ---------------------------------------------------------------------------

/**
 * Mask a phone number for display in the reception dashboard.
 *
 * Rules:
 *   - Show first 3 digits and last 2 digits.
 *   - Mask the middle with X.
 *   - Format: 05X XXX XX34
 *
 * ❗ This is a security requirement from [S1].
 */
export function maskPhone(phone: string): string {
  if (!phone) return '';

  // Remove spaces, dashes, and plus sign for processing
  const cleaned = phone.replace(/[\s\-+]/g, '');

  if (cleaned.length < 5) {
    // Too short to mask meaningfully
    return '*'.repeat(cleaned.length);
  }

  const visibleStart = 3;
  const visibleEnd = 2;
  const maskedLength = cleaned.length - visibleStart - visibleEnd;

  const start = cleaned.slice(0, visibleStart);
  const end = cleaned.slice(-visibleEnd);
  const masked = 'X'.repeat(maskedLength);

  // Format with spaces for readability
  const full = start + masked + end;
  if (full.length === 10) {
    // Saudi format: 05X XXX XX34
    return `${full.slice(0, 3)} ${full.slice(3, 6)} ${full.slice(6, 8)}${full.slice(8)}`;
  }

  return full;
}

// ---------------------------------------------------------------------------
// Available actions by status
// ---------------------------------------------------------------------------

/**
 * Get available quick actions for a booking based on its status.
 *
 * Maps to the 8 quick-action buttons in the reception dashboard.
 */
export function getAvailableActions(status: BookingStatus): QuickAction[] {
  switch (status) {
    case 'PENDING_CONFIRMATION':
      return ['confirm', 'reject', 'suggest_alternative', 'cancel'];

    case 'CONFIRMED':
      return ['record_attendance', 'record_no_show', 'cancel', 'reschedule'];

    case 'ATTENDED':
      return ['record_service'];

    case 'SERVICE_DONE':
      // Value submission/approval handled in a separate flow
      return [];

    // Terminal states — no actions
    case 'COLLECTED':
    case 'CANCELLED':
    case 'NO_SHOW':
    case 'REJECTED':
    case 'NEW':
      return [];

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Late booking formatting
// ---------------------------------------------------------------------------

export interface LateBookingDisplay {
  /** Whether the booking is late (SLA exceeded). */
  isLate: boolean;
  /** The late label for display. */
  labelAr: string;
  labelEn: string;
  /** Lucide icon name for late indicator. */
  icon: string;
  /** Color for late indicator. */
  color: string;
  /** Minutes overdue (null if not late). */
  minutesOverdue: number | null;
}

/**
 * Compute late booking display information.
 *
 * ❗ Late bookings must be distinguished by:
 *   - Text (not color alone — DEC-015)
 *   - Icon (alert-triangle)
 *   - Color (red)
 *   - Numerical indicator (minutes overdue)
 */
export function computeLateDisplay(
  status: BookingStatus,
  isLate: boolean,
  slaDeadline: Date | null,
  now: Date = new Date(),
): LateBookingDisplay {
  if (!isLate || status !== 'PENDING_CONFIRMATION') {
    return {
      isLate: false,
      labelAr: '',
      labelEn: '',
      icon: '',
      color: '',
      minutesOverdue: null,
    };
  }

  const minutesOverdue = slaDeadline
    ? Math.floor((now.getTime() - slaDeadline.getTime()) / 60_000)
    : null;

  return {
    isLate: true,
    labelAr: LATE_FLAG.labelAr,
    labelEn: LATE_FLAG.labelEn,
    icon: LATE_FLAG.icon,
    color: LATE_FLAG.color,
    minutesOverdue,
  };
}

// ---------------------------------------------------------------------------
// Status display — ❗ color + icon + text (DEC-015)
// ---------------------------------------------------------------------------

export interface StatusDisplay {
  status: BookingStatus;
  labelAr: string;
  labelEn: string;
  icon: string;
  color: string;
  textColor: string;
}

/**
 * Get the full status display for a booking in the reception table.
 * Ensures DEC-015: status is conveyed by text + icon + colour.
 */
export function getStatusDisplay(status: BookingStatus): StatusDisplay {
  const meta = STATUS_META[status];
  return {
    status: meta.status,
    labelAr: meta.labelAr,
    labelEn: meta.labelEn,
    icon: meta.icon,
    color: meta.color,
    textColor: meta.textColor,
  };
}

// ---------------------------------------------------------------------------
// Wait time calculator
// ---------------------------------------------------------------------------

/**
 * Calculate current wait time for a patient in the queue.
 *
 * Returns minutes since slot_start for CONFIRMED bookings (waiting to be seen).
 */
export function calculateWaitTime(
  status: BookingStatus,
  slotStart: Date,
  now: Date = new Date(),
): number | null {
  if (status !== 'CONFIRMED') return null;

  const diff = now.getTime() - slotStart.getTime();
  if (diff <= 0) return 0;

  return Math.floor(diff / 60_000);
}
