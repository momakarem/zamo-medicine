/**
 * ZAMO-BOOK-032 / ZAMO-BOOK-033 — Patient Account.
 *
 * Provides:
 *   - My bookings list with 5 filters (status, date, service, branch, search)
 *   - Booking details with timeline
 *   - Account deletion request (B-19: anonymize)
 *   - Profile view/edit
 *
 * Security:
 *   - Patient sees ONLY their own bookings (RLS enforced at DB level)
 *   - ❗ Attempting to view another patient's booking FAILS
 */

import type { BookingStatus } from '../booking/booking-status.js';
import { STATUS_META } from '../booking/booking-status.js';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatientBookingSummary {
  id: string;
  bookingNumber: string;
  status: BookingStatus;
  doctorNameAr: string;
  doctorNameEn: string;
  branchNameAr: string;
  branchNameEn: string;
  serviceNameAr: string;
  serviceNameEn: string;
  slotStart: Date;
  slotEnd: Date;
  isLate: boolean;
  createdAt: Date;
}

export interface BookingTimeline {
  bookingId: string;
  entries: TimelineEntry[];
}

export interface TimelineEntry {
  status: BookingStatus;
  label: { ar: string; en: string };
  icon: string;
  color: string;
  timestamp: Date | null;
  isActive: boolean;
  isCurrent: boolean;
}

export interface PatientProfile {
  id: string;
  phone: string | null;
  fullName: string | null;
  preferredLang: 'ar' | 'en';
  createdAt: Date;
}

export interface DeletionRequest {
  id: string;
  patientId: string;
  reason: string;
  requestedAt: Date;
  status: 'pending' | 'processed';
}

export type PatientError =
  | 'BOOKING_NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'INVALID_FILTER'
  | 'DELETION_ALREADY_REQUESTED';

// ---------------------------------------------------------------------------
// Timeline builder
// ---------------------------------------------------------------------------

/** The standard happy-path order for timeline display */
const TIMELINE_ORDER: BookingStatus[] = [
  'NEW',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'ATTENDED',
  'SERVICE_DONE',
  'COLLECTED',
];

/**
 * Build a booking timeline for display.
 *
 * The timeline shows the standard happy path with the current status
 * highlighted. Terminal states (CANCELLED, REJECTED, NO_SHOW) are
 * shown as special end states.
 */
export function buildTimeline(
  currentStatus: BookingStatus,
  timestamps: Partial<Record<BookingStatus, Date>>,
  _lang: 'ar' | 'en' = 'ar',
): TimelineEntry[] {
  const isTerminal = ['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(currentStatus);
  const currentIdx = TIMELINE_ORDER.indexOf(currentStatus);

  const entries: TimelineEntry[] = TIMELINE_ORDER.map((status, idx) => {
    const meta = STATUS_META[status];
    const timestamp = timestamps[status] ?? null;

    let isActive: boolean;
    let isCurrent: boolean;

    if (isTerminal) {
      // For terminal states, show progress up to where it was before termination
      isActive = timestamp !== null;
      isCurrent = false;
    } else {
      isActive = idx <= currentIdx;
      isCurrent = idx === currentIdx;
    }

    return {
      status,
      label: { ar: meta.labelAr, en: meta.labelEn },
      icon: meta.icon,
      color: isActive ? meta.color : '#CBD5E1', // gray for inactive
      timestamp,
      isActive,
      isCurrent,
    };
  });

  // Add terminal state as final entry if applicable
  if (isTerminal) {
    const meta = STATUS_META[currentStatus];
    entries.push({
      status: currentStatus,
      label: { ar: meta.labelAr, en: meta.labelEn },
      icon: meta.icon,
      color: meta.color,
      timestamp: timestamps[currentStatus] ?? null,
      isActive: true,
      isCurrent: true,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

/**
 * Build SQL for patient's booking list with 5 filters.
 *
 * The RLS policy on bookings ensures the patient can only see their own.
 * This query joins with doctors, branches, and services for display names.
 */
export function buildMyBookingsSQL(
  patientId: string,
  filters: {
    status?: BookingStatus | BookingStatus[];
    fromDate?: Date;
    toDate?: Date;
    serviceId?: string;
    branchId?: string;
    search?: string;
  },
): { sql: string; values: unknown[] } {
  const conditions: string[] = ['b.patient_id = $1'];
  const values: unknown[] = [patientId];
  let idx = 2;

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      const ph = filters.status.map((_, i) => `$${idx + i}`);
      conditions.push(`b.status IN (${ph.join(', ')})`);
      values.push(...filters.status);
      idx += filters.status.length;
    } else {
      conditions.push(`b.status = $${idx}`);
      values.push(filters.status);
      idx++;
    }
  }

  if (filters.fromDate) {
    conditions.push(`b.slot_start >= $${idx}`);
    values.push(filters.fromDate);
    idx++;
  }

  if (filters.toDate) {
    conditions.push(`b.slot_start <= $${idx}`);
    values.push(filters.toDate);
    idx++;
  }

  if (filters.branchId) {
    conditions.push(`b.branch_id = $${idx}`);
    values.push(filters.branchId);
    idx++;
  }

  if (filters.serviceId) {
    conditions.push(`bs.service_id = $${idx}`);
    values.push(filters.serviceId);
    idx++;
  }

  if (filters.search) {
    conditions.push(`(
      d.name_ar ILIKE $${idx} OR d.name_en ILIKE $${idx}
      OR br.name_ar ILIKE $${idx} OR br.name_en ILIKE $${idx}
      OR b.booking_number ILIKE $${idx}
    )`);
    values.push(`%${filters.search}%`);
    idx++;
  }

  return {
    sql: `
      SELECT
        b.id, b.booking_number, b.status, b.slot_start, b.slot_end,
        b.is_late, b.created_at,
        d.name_ar AS doctor_name_ar, d.name_en AS doctor_name_en,
        br.name_ar AS branch_name_ar, br.name_en AS branch_name_en,
        s.name_ar AS service_name_ar, s.name_en AS service_name_en
      FROM bookings b
      JOIN doctors d ON b.doctor_id = d.id
      JOIN branches br ON b.branch_id = br.id
      JOIN branch_services bs ON b.branch_service_id = bs.id
      JOIN services s ON bs.service_id = s.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.slot_start DESC
    `,
    values,
  };
}

/**
 * Build SQL for booking detail view including status history.
 */
export function buildBookingDetailSQL(bookingId: string): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      SELECT
        b.*,
        d.name_ar AS doctor_name_ar, d.name_en AS doctor_name_en,
        d.photo_url AS doctor_photo,
        sp.name_ar AS specialty_name_ar, sp.name_en AS specialty_name_en,
        br.name_ar AS branch_name_ar, br.name_en AS branch_name_en,
        br.district_ar, br.district_en, br.phone AS branch_phone,
        br.latitude, br.longitude,
        s.name_ar AS service_name_ar, s.name_en AS service_name_en,
        f.name_ar AS facility_name_ar, f.name_en AS facility_name_en
      FROM bookings b
      JOIN doctors d ON b.doctor_id = d.id
      JOIN specialties sp ON d.specialty_id = sp.id
      JOIN branches br ON b.branch_id = br.id
      JOIN branch_services bs ON b.branch_service_id = bs.id
      JOIN services s ON bs.service_id = s.id
      JOIN facilities f ON b.facility_id = f.id
      WHERE b.id = $1
    `,
    values: [bookingId],
  };
}

/**
 * Build SQL for booking status history (for timeline).
 */
export function buildBookingHistorySQL(bookingId: string): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      SELECT * FROM booking_status_history
      WHERE booking_id = $1
      ORDER BY created_at ASC
    `,
    values: [bookingId],
  };
}

/**
 * Build SQL for account deletion request (A-52, B-19).
 */
export function buildDeletionRequestSQL(
  patientId: string,
  reason: string,
): { sql: string; values: unknown[] } {
  // We use audit_log to record the deletion request
  return {
    sql: `
      INSERT INTO audit_log (
        actor_user_id, actor_role, action, entity_type, entity_id,
        reason
      ) VALUES ($1, 'patient', 'account.deletion_request', 'user', $1, $2)
    `,
    values: [patientId, reason],
  };
}
