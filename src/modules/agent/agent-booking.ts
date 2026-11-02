/**
 * ZAMO-AGENT-051/052 — Agent Booking Bridge.
 *
 * Bridges the agent's create_booking_req, reschedule, cancel, and
 * get_booking_status tools to the existing booking module.
 *
 * Key rules:
 *   ❗ Uses the SAME State Machine — no parallel path (ARCH §9.2 rule 1).
 *   A-12: Never says "confirmed" — always "pending clinic confirmation".
 *   A-13: «تم إرسال طلب حجزك إلى العيادة، وسنبلغك فور تأكيد الموعد»
 *   A-33: OTP required before booking (patient must be verified).
 *   B-14: Max 2 reschedules.
 *   B-32: Max 3 pending bookings per patient.
 */

import type { Result } from '../../shared/result.ts';
import type { Locale } from '../../shared/i18n.ts';
import type { BookingStatus } from '../booking/booking-status.ts';
import { ok, err } from '../../shared/result.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentBookingParams {
  patientId: string;
  doctorId: string;
  branchId: string;
  facilityId: string;
  branchServiceId: string;
  slotStart: string;  // ISO 8601
  slotEnd: string;    // ISO 8601
  consentPrivacy: boolean;
  consentOperational: boolean;
  consentMarketing?: boolean;
}

export type AgentBookingError =
  | 'PATIENT_NOT_VERIFIED'
  | 'PRIVACY_CONSENT_REQUIRED'
  | 'MAX_PENDING_BOOKINGS'
  | 'SLOT_CONFLICT'
  | 'BOOKING_NOT_FOUND'
  | 'NOT_OWNER'
  | 'MAX_RESCHEDULES'
  | 'INVALID_TRANSITION'
  | 'INVALID_PARAMS';

export interface AgentBookingResult {
  bookingId: string;
  bookingNumber: string;
  status: BookingStatus;
  messageAr: string;
  messageEn: string;
}

export interface BookingStatusResult {
  bookingId: string;
  bookingNumber: string;
  status: BookingStatus;
  statusLabelAr: string;
  statusLabelEn: string;
  doctorName: string;
  serviceName: string;
  branchName: string;
  slotStart: string;
  slotEnd: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate booking parameters from the agent.
 *
 * A-33: Patient must be verified (OTP) before booking.
 * A-51: Privacy consent is mandatory.
 */
export function validateAgentBooking(
  params: AgentBookingParams,
  isPatientVerified: boolean,
): Result<void, AgentBookingError> {
  if (!isPatientVerified) {
    return err('PATIENT_NOT_VERIFIED');
  }

  if (!params.consentPrivacy) {
    return err('PRIVACY_CONSENT_REQUIRED');
  }

  if (!params.patientId || !params.doctorId || !params.branchId ||
      !params.branchServiceId || !params.slotStart || !params.slotEnd) {
    return err('INVALID_PARAMS');
  }

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Response messages
// ---------------------------------------------------------------------------

/**
 * Status labels in both languages.
 */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, { ar: string; en: string }> = {
  NEW: { ar: 'جديد', en: 'New' },
  PENDING_CONFIRMATION: { ar: 'بانتظار تأكيد العيادة', en: 'Pending Clinic Confirmation' },
  CONFIRMED: { ar: 'مؤكد', en: 'Confirmed' },
  ATTENDED: { ar: 'حضر', en: 'Attended' },
  SERVICE_DONE: { ar: 'تمت الخدمة', en: 'Service Done' },
  COLLECTED: { ar: 'محصّل', en: 'Collected' },
  CANCELLED: { ar: 'ملغي', en: 'Cancelled' },
  NO_SHOW: { ar: 'لم يحضر', en: 'No Show' },
  REJECTED: { ar: 'مرفوض', en: 'Rejected' },
};

/**
 * ❗ A-13: The APPROVED message when a booking is created.
 * «تم إرسال طلب حجزك إلى العيادة، وسنبلغك فور تأكيد الموعد»
 */
export const BOOKING_CREATED_MESSAGE = {
  ar: 'تم إرسال طلب حجزك إلى العيادة، وسنبلغك فور تأكيد الموعد. ⏳',
  en: 'Your booking request has been sent to the clinic. We will notify you once the appointment is confirmed. ⏳',
} as const;

/**
 * Error messages for the agent to relay to the patient.
 */
export const BOOKING_ERROR_MESSAGES: Record<AgentBookingError, { ar: string; en: string }> = {
  PATIENT_NOT_VERIFIED: {
    ar: 'يجب التحقق من رقم الجوال أولاً عبر رمز التحقق (OTP) قبل إنشاء الحجز.',
    en: 'Phone number verification (OTP) is required before creating a booking.',
  },
  PRIVACY_CONSENT_REQUIRED: {
    ar: 'الموافقة على سياسة الخصوصية مطلوبة لإتمام الحجز.',
    en: 'Privacy policy consent is required to complete the booking.',
  },
  MAX_PENDING_BOOKINGS: {
    ar: 'لديك 3 حجوزات قيد الانتظار بالفعل. يرجى إلغاء حجز أو انتظار رد العيادة قبل إنشاء حجز جديد.',
    en: 'You already have 3 pending bookings. Please cancel one or wait for a clinic response before creating a new booking.',
  },
  SLOT_CONFLICT: {
    ar: 'عذراً، هذا الموعد لم يعد متاحاً. هل تريد البحث عن مواعيد أخرى؟',
    en: 'Sorry, this time slot is no longer available. Would you like to search for other slots?',
  },
  BOOKING_NOT_FOUND: {
    ar: 'لم أجد هذا الحجز. تأكد من رقم الحجز وحاول مرة أخرى.',
    en: 'Booking not found. Please verify the booking number and try again.',
  },
  NOT_OWNER: {
    ar: 'هذا الحجز ليس لك. لا يمكنك تعديل حجوزات الآخرين.',
    en: 'This is not your booking. You cannot modify other patients\' bookings.',
  },
  MAX_RESCHEDULES: {
    ar: 'تم الوصول للحد الأقصى لإعادة الجدولة (مرتان). يمكنك إلغاء الحجز وإنشاء حجز جديد.',
    en: 'Maximum reschedule limit reached (2 times). You can cancel and create a new booking.',
  },
  INVALID_TRANSITION: {
    ar: 'لا يمكن تنفيذ هذا الإجراء على الحجز في حالته الحالية.',
    en: 'This action cannot be performed on the booking in its current state.',
  },
  INVALID_PARAMS: {
    ar: 'بيانات الحجز غير مكتملة. أحتاج الطبيب والخدمة والموعد والموافقة على الخصوصية.',
    en: 'Booking data is incomplete. I need the doctor, service, time slot, and privacy consent.',
  },
};

/**
 * Get the localized error message for a booking error.
 */
export function getBookingErrorMessage(
  error: AgentBookingError,
  locale: Locale,
): string {
  const messages = BOOKING_ERROR_MESSAGES[error];
  return locale === 'ar' ? messages.ar : messages.en;
}

/**
 * Get the localized booking status label.
 */
export function getStatusLabel(status: BookingStatus, locale: Locale): string {
  const labels = BOOKING_STATUS_LABELS[status];
  return locale === 'ar' ? labels.ar : labels.en;
}

/**
 * Format the booking creation success message.
 */
export function formatBookingCreatedMessage(
  bookingNumber: string,
  locale: Locale,
): string {
  const base = locale === 'ar'
    ? BOOKING_CREATED_MESSAGE.ar
    : BOOKING_CREATED_MESSAGE.en;

  const numberLabel = locale === 'ar'
    ? `رقم الحجز: ${bookingNumber}`
    : `Booking number: ${bookingNumber}`;

  return `${base}\n${numberLabel}`;
}

/**
 * Format a booking status response.
 */
export function formatBookingStatus(
  status: BookingStatusResult,
  locale: Locale,
): string {
  const lines = [
    `📋 ${locale === 'ar' ? 'حالة الحجز' : 'Booking Status'}`,
    `${locale === 'ar' ? 'الرقم' : 'Number'}: ${status.bookingNumber}`,
    `${locale === 'ar' ? 'الحالة' : 'Status'}: ${locale === 'ar' ? status.statusLabelAr : status.statusLabelEn}`,
    `${locale === 'ar' ? 'الطبيب' : 'Doctor'}: ${status.doctorName}`,
    `${locale === 'ar' ? 'الخدمة' : 'Service'}: ${status.serviceName}`,
    `${locale === 'ar' ? 'الفرع' : 'Branch'}: ${status.branchName}`,
    `${locale === 'ar' ? 'الموعد' : 'Appointment'}: ${status.slotStart}`,
  ];

  return lines.join('\n');
}
