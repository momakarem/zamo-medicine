/**
 * ZAMO-DS-006 — booking status component (data layer).
 *
 * Implements the mandatory design rule [S2]: «عدم الاعتماد على اللون وحده
 * لشرح حالة الحجز» — every status is conveyed by **text + icon + colour**,
 * never by colour alone. The greyscale test in the test suite proves this.
 *
 * The nine approved states come from ARCHITECTURE.md §7 + OQ-003 decision B-07
 * (REJECTED is a real state). "late" is a **flag**, not a state (DEC-006).
 *
 * Lucide icon names are used as the icon identifier (A-64).
 */

// ---------------------------------------------------------------------------
// Status enum
// ---------------------------------------------------------------------------

export const BOOKING_STATUSES = [
  'NEW',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'ATTENDED',
  'SERVICE_DONE',
  'COLLECTED',
  'CANCELLED',
  'NO_SHOW',
  'REJECTED',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// ---------------------------------------------------------------------------
// Status metadata
// ---------------------------------------------------------------------------

export interface BookingStatusMeta {
  /** Machine key */
  status: BookingStatus;
  /** Arabic label */
  labelAr: string;
  /** English label */
  labelEn: string;
  /** Lucide icon name */
  icon: string;
  /** Hex colour (for badge background) */
  color: string;
  /** Accessible text colour on the badge background */
  textColor: string;
  /** Short Arabic description for screen readers */
  descriptionAr: string;
  /** Short English description for screen readers */
  descriptionEn: string;
  /** Numeric order for timeline rendering */
  order: number;
}

export const STATUS_META: Record<BookingStatus, BookingStatusMeta> = {
  NEW: {
    status: 'NEW',
    labelAr: 'جديد',
    labelEn: 'New',
    icon: 'plus-circle',
    color: '#2563EB',
    textColor: '#FFFFFF',
    descriptionAr: 'طلب حجز جديد لم يُرسل بعد',
    descriptionEn: 'A new booking request not yet submitted',
    order: 0,
  },
  PENDING_CONFIRMATION: {
    status: 'PENDING_CONFIRMATION',
    labelAr: 'بانتظار تأكيد العيادة',
    labelEn: 'Pending Confirmation',
    icon: 'clock',
    color: '#E6B566',
    textColor: '#000000',
    descriptionAr: 'تم إرسال الطلب وبانتظار تأكيد العيادة',
    descriptionEn: 'Request sent, awaiting clinic confirmation',
    order: 1,
  },
  CONFIRMED: {
    status: 'CONFIRMED',
    labelAr: 'مؤكد',
    labelEn: 'Confirmed',
    icon: 'check-circle',
    color: '#059669',
    textColor: '#FFFFFF',
    descriptionAr: 'تم تأكيد الموعد من العيادة',
    descriptionEn: 'Appointment confirmed by clinic',
    order: 2,
  },
  ATTENDED: {
    status: 'ATTENDED',
    labelAr: 'حضر',
    labelEn: 'Attended',
    icon: 'user-check',
    color: '#16A7A0',
    textColor: '#FFFFFF',
    descriptionAr: 'المريض حضر في الموعد',
    descriptionEn: 'Patient attended the appointment',
    order: 3,
  },
  SERVICE_DONE: {
    status: 'SERVICE_DONE',
    labelAr: 'الخدمة مكتملة',
    labelEn: 'Service Done',
    icon: 'clipboard-check',
    color: '#243B6B',
    textColor: '#FFFFFF',
    descriptionAr: 'تم تسجيل الخدمة الفعلية والمبلغ المحصل',
    descriptionEn: 'Service performed and amount collected recorded',
    order: 4,
  },
  COLLECTED: {
    status: 'COLLECTED',
    labelAr: 'تم التحصيل',
    labelEn: 'Collected',
    icon: 'badge-check',
    color: '#059669',
    textColor: '#FFFFFF',
    descriptionAr: 'مدير المنشأة اعتمد القيمة النهائية — العمولة محتسبة',
    descriptionEn: 'Facility manager approved final value — commission calculated',
    order: 5,
  },
  CANCELLED: {
    status: 'CANCELLED',
    labelAr: 'ملغى',
    labelEn: 'Cancelled',
    icon: 'x-circle',
    color: '#94A3B8',
    textColor: '#FFFFFF',
    descriptionAr: 'تم إلغاء الحجز',
    descriptionEn: 'Booking cancelled',
    order: 6,
  },
  NO_SHOW: {
    status: 'NO_SHOW',
    labelAr: 'لم يحضر',
    labelEn: 'No Show',
    icon: 'user-x',
    color: '#DC2626',
    textColor: '#FFFFFF',
    descriptionAr: 'المريض لم يحضر في الموعد المؤكد',
    descriptionEn: 'Patient did not show up for confirmed appointment',
    order: 7,
  },
  REJECTED: {
    status: 'REJECTED',
    labelAr: 'مرفوض',
    labelEn: 'Rejected',
    icon: 'slash',
    color: '#7C3AED',
    textColor: '#FFFFFF',
    descriptionAr: 'رفضت العيادة الطلب مع سبب مسجّل',
    descriptionEn: 'Clinic rejected the request with a recorded reason',
    order: 8,
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up metadata for a status. Returns undefined for invalid status codes.
 */
export function getStatusMeta(status: string): BookingStatusMeta | undefined {
  return STATUS_META[status as BookingStatus];
}

/**
 * Get the label for a status in the requested language.
 */
export function getStatusLabel(status: BookingStatus, lang: 'ar' | 'en' = 'ar'): string {
  const meta = STATUS_META[status];
  return lang === 'ar' ? meta.labelAr : meta.labelEn;
}

/**
 * Get the accessible description for screen readers.
 */
export function getStatusDescription(status: BookingStatus, lang: 'ar' | 'en' = 'ar'): string {
  const meta = STATUS_META[status];
  return lang === 'ar' ? meta.descriptionAr : meta.descriptionEn;
}

/**
 * Check if a string is a valid BookingStatus.
 */
export function isBookingStatus(s: string): s is BookingStatus {
  return BOOKING_STATUSES.includes(s as BookingStatus);
}

// ---------------------------------------------------------------------------
// Late flag — DEC-006: "متأخر" is a label, not a state.
// ---------------------------------------------------------------------------

export interface LateFlag {
  isLate: boolean;
  labelAr: string;
  labelEn: string;
  icon: string;
  color: string;
}

/**
 * The "late" flag is shown alongside PENDING_CONFIRMATION when the SLA window
 * has elapsed. It is NOT a separate booking state (DEC-006).
 */
export const LATE_FLAG: Omit<LateFlag, 'isLate'> = {
  labelAr: 'متأخر',
  labelEn: 'Late',
  icon: 'alert-triangle',
  color: '#DC2626',
} as const;

/**
 * Determine if a booking is late based on the SLA deadline.
 */
export function computeLateFlag(
  status: BookingStatus,
  slaDeadline: Date | null,
  now: Date = new Date(),
): LateFlag {
  const isLate =
    status === 'PENDING_CONFIRMATION' &&
    slaDeadline !== null &&
    now.getTime() > slaDeadline.getTime();

  return {
    isLate,
    ...LATE_FLAG,
  };
}
