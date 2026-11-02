/**
 * ZAMO-NOTIF-055 — notification type definitions.
 *
 * Enumerates the 13 operational notification types (mapped to state-machine
 * transitions T2..T16) plus 2 operational-alert types (NOTIF-061).
 *
 * Each type carries metadata about:
 *   - Which consent category it falls under (operational vs marketing)
 *   - Default delivery channels
 *   - Whether it maps to a booking transition
 *
 * Decisions enforced:
 *   B-33: Channels abstracted behind ports (WhatsApp/SMS/Email/InApp)
 *   B-28: SLA types respect branch working hours
 *   B-29: Auto-cancel after 24 working hours
 */

// ---------------------------------------------------------------------------
// Notification channels (B-33: abstracted)
// ---------------------------------------------------------------------------

export type NotificationChannel = 'whatsapp' | 'sms' | 'email' | 'in_app';

// ---------------------------------------------------------------------------
// Consent categories — ❗ NOTIF-057 Phase Gate:
// "operational" consent does NOT imply "marketing" consent.
// ---------------------------------------------------------------------------

export type ConsentCategory = 'operational' | 'marketing';

// ---------------------------------------------------------------------------
// Notification types — 13 operational + 2 alerts
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  // ── Booking lifecycle (maps to state-machine transitions) ──────────────
  'BOOKING_SUBMITTED',        // T2:  patient + receptionist
  'BOOKING_CONFIRMED',        // T3:  patient
  'BOOKING_REJECTED',         // T4:  patient + alternatives
  'ALTERNATIVE_SUGGESTED',    // T5:  patient
  'BOOKING_CANCELLED',        // T6/T9: other party
  'SLA_WARNING',              // T7:  receptionist + branch_manager
  'BOOKING_RESCHEDULED',      // T8:  both parties
  'APPOINTMENT_REMINDER',     // T10: patient
  'NO_SHOW_RECORDED',         // T12: patient
  'VALUE_SUBMITTED',          // T14: facility_manager
  'VALUE_APPROVED',           // T15: patient (objection window)
  'VALUE_REJECTED',           // T16: staff
  'SLA_AUTO_CANCEL',          // B-29: patient + facility + zamo_admin

  // ── Operational alerts (NOTIF-061) ────────────────────────────────────
  'LICENSE_EXPIRING',         // Before license expiry
  'STALLED_BOOKINGS_ALERT',   // Bookings stuck in one state
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ---------------------------------------------------------------------------
// Notification type metadata
// ---------------------------------------------------------------------------

export interface NotificationTypeMeta {
  /** Machine key */
  type: NotificationType;
  /** Consent category — operational or marketing */
  consentCategory: ConsentCategory;
  /** Default delivery channels (order = priority) */
  defaultChannels: readonly NotificationChannel[];
  /** State-machine transition ID that triggers this, if any */
  transitionId: string | null;
  /** Description for admin panel */
  descriptionAr: string;
  descriptionEn: string;
}

export const NOTIFICATION_TYPE_META: Record<NotificationType, NotificationTypeMeta> = {
  BOOKING_SUBMITTED: {
    type: 'BOOKING_SUBMITTED',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp', 'in_app'],
    transitionId: 'T2',
    descriptionAr: 'تم إرسال طلب الحجز',
    descriptionEn: 'Booking request submitted',
  },
  BOOKING_CONFIRMED: {
    type: 'BOOKING_CONFIRMED',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp', 'in_app'],
    transitionId: 'T3',
    descriptionAr: 'تم تأكيد الحجز من العيادة',
    descriptionEn: 'Booking confirmed by clinic',
  },
  BOOKING_REJECTED: {
    type: 'BOOKING_REJECTED',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp', 'in_app'],
    transitionId: 'T4',
    descriptionAr: 'تم رفض طلب الحجز',
    descriptionEn: 'Booking request rejected',
  },
  ALTERNATIVE_SUGGESTED: {
    type: 'ALTERNATIVE_SUGGESTED',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp', 'in_app'],
    transitionId: 'T5',
    descriptionAr: 'تم اقتراح موعد بديل',
    descriptionEn: 'Alternative time suggested',
  },
  BOOKING_CANCELLED: {
    type: 'BOOKING_CANCELLED',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp', 'in_app'],
    transitionId: null, // T6 or T9
    descriptionAr: 'تم إلغاء الحجز',
    descriptionEn: 'Booking cancelled',
  },
  SLA_WARNING: {
    type: 'SLA_WARNING',
    consentCategory: 'operational',
    defaultChannels: ['in_app', 'whatsapp'],
    transitionId: 'T7',
    descriptionAr: 'تأخر في الاستجابة — تجاوز SLA',
    descriptionEn: 'Response delay — SLA exceeded',
  },
  BOOKING_RESCHEDULED: {
    type: 'BOOKING_RESCHEDULED',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp', 'in_app'],
    transitionId: 'T8',
    descriptionAr: 'تمت إعادة جدولة الحجز',
    descriptionEn: 'Booking rescheduled',
  },
  APPOINTMENT_REMINDER: {
    type: 'APPOINTMENT_REMINDER',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp'],
    transitionId: 'T10',
    descriptionAr: 'تذكير بالموعد',
    descriptionEn: 'Appointment reminder',
  },
  NO_SHOW_RECORDED: {
    type: 'NO_SHOW_RECORDED',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp', 'in_app'],
    transitionId: 'T12',
    descriptionAr: 'تم تسجيل عدم حضور',
    descriptionEn: 'No-show recorded',
  },
  VALUE_SUBMITTED: {
    type: 'VALUE_SUBMITTED',
    consentCategory: 'operational',
    defaultChannels: ['in_app'],
    transitionId: 'T14',
    descriptionAr: 'تم تقديم قيمة الخدمة للاعتماد',
    descriptionEn: 'Service value submitted for approval',
  },
  VALUE_APPROVED: {
    type: 'VALUE_APPROVED',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp', 'in_app'],
    transitionId: 'T15',
    descriptionAr: 'تم اعتماد القيمة النهائية',
    descriptionEn: 'Final value approved',
  },
  VALUE_REJECTED: {
    type: 'VALUE_REJECTED',
    consentCategory: 'operational',
    defaultChannels: ['in_app'],
    transitionId: 'T16',
    descriptionAr: 'تم رفض القيمة المقدمة',
    descriptionEn: 'Submitted value rejected',
  },
  SLA_AUTO_CANCEL: {
    type: 'SLA_AUTO_CANCEL',
    consentCategory: 'operational',
    defaultChannels: ['whatsapp', 'in_app'],
    transitionId: null, // B-29: system-triggered
    descriptionAr: 'إلغاء تلقائي بسبب تجاوز SLA',
    descriptionEn: 'Auto-cancelled due to SLA breach',
  },
  LICENSE_EXPIRING: {
    type: 'LICENSE_EXPIRING',
    consentCategory: 'operational',
    defaultChannels: ['in_app', 'email'],
    transitionId: null,
    descriptionAr: 'تنبيه انتهاء ترخيص',
    descriptionEn: 'License expiry alert',
  },
  STALLED_BOOKINGS_ALERT: {
    type: 'STALLED_BOOKINGS_ALERT',
    consentCategory: 'operational',
    defaultChannels: ['in_app', 'email'],
    transitionId: null,
    descriptionAr: 'تنبيه حجوزات متعثرة',
    descriptionEn: 'Stalled bookings alert',
  },
} as const;

// ---------------------------------------------------------------------------
// Recipient
// ---------------------------------------------------------------------------

export interface NotificationRecipient {
  userId: string;
  phone?: string;           // E.164 format
  email?: string;
  locale: 'ar' | 'en';
}

// ---------------------------------------------------------------------------
// Channel message (what goes to a channel adapter)
// ---------------------------------------------------------------------------

export interface ChannelMessage {
  /** Unique key to prevent duplicate sends */
  idempotencyKey: string;
  /** Target channel */
  channel: NotificationChannel;
  /** Recipient info */
  to: string;              // phone for sms/whatsapp, email for email, userId for in_app
  /** Rendered subject (email/in_app) */
  subject?: string;
  /** Rendered body */
  body: string;
  /** Notification type for logging */
  notificationType: NotificationType;
}

// ---------------------------------------------------------------------------
// Template variables (what the template engine receives)
// ---------------------------------------------------------------------------

export interface TemplateVariables {
  patientName?: string;
  doctorName?: string;
  facilityName?: string;
  branchName?: string;
  serviceName?: string;
  bookingNumber?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  rejectionReason?: string;
  cancellationReason?: string;
  alternativeDate?: string;
  alternativeTime?: string;
  slaMinutes?: number;
  licenseType?: string;
  licenseExpiry?: string;
  daysUntilExpiry?: number;
  stalledCount?: number;
  [key: string]: string | number | boolean | undefined;
}

// ---------------------------------------------------------------------------
// Notification log entry (for audit / debugging)
// ---------------------------------------------------------------------------

export interface NotificationLogEntry {
  id?: string;
  notificationType: NotificationType;
  recipientUserId: string;
  channel: NotificationChannel;
  idempotencyKey: string;
  body: string;
  status: 'sent' | 'failed' | 'skipped_consent';
  errorMessage?: string;
  createdAt?: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a string is a valid NotificationType.
 */
export function isNotificationType(s: string): s is NotificationType {
  return NOTIFICATION_TYPES.includes(s as NotificationType);
}

/**
 * Get the consent category for a notification type.
 */
export function getConsentCategory(type: NotificationType): ConsentCategory {
  return NOTIFICATION_TYPE_META[type].consentCategory;
}

/**
 * Get default channels for a notification type.
 */
export function getDefaultChannels(type: NotificationType): readonly NotificationChannel[] {
  return NOTIFICATION_TYPE_META[type].defaultChannels;
}
