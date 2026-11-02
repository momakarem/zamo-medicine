/**
 * ZAMO-NOTIF-055 — bilingual template engine.
 *
 * Renders notification templates for all 15 types in both Arabic and English.
 *
 * Rules:
 *   - Every template has an `ar` and `en` variant.
 *   - Variables use `{{variableName}}` syntax.
 *   - ❗ Rendering FAILS if any `{{...}}` placeholder remains unreplaced.
 *   - Uses i18n.ts helpers for date/price/phone formatting.
 *
 * Decisions enforced:
 *   A-12: ❗ NEVER say "confirmed" in patient-facing submission templates.
 *   A-13: Use the approved pending-confirmation message.
 */

import type { NotificationType, TemplateVariables } from './notification-types.js';
import type { Locale } from '../../shared/i18n.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RenderedTemplate {
  subject: string;
  body: string;
}

export type TemplateError =
  | 'UNKNOWN_TYPE'
  | 'UNKNOWN_LOCALE'
  | 'UNRESOLVED_VARIABLES';

interface TemplateEntry {
  subject: string;
  body: string;
}

type TemplateMap = Record<NotificationType, Record<Locale, TemplateEntry>>;

// ---------------------------------------------------------------------------
// Templates — inline for simplicity, one per type × locale
// ---------------------------------------------------------------------------

const TEMPLATES: TemplateMap = {
  // T2: Booking submitted ─────────────────────────────────────────────────
  // ❗ A-12/A-13: patient message MUST say "pending clinic confirmation"
  BOOKING_SUBMITTED: {
    ar: {
      subject: 'طلب حجز جديد',
      body: 'مرحبًا {{patientName}}، تم إرسال طلب حجزك ({{bookingNumber}}) إلى {{facilityName}} — {{branchName}}. سنبلغك فور تأكيد الموعد.',
    },
    en: {
      subject: 'New Booking Request',
      body: 'Hello {{patientName}}, your booking request ({{bookingNumber}}) has been sent to {{facilityName}} — {{branchName}}. We will notify you once the appointment is confirmed.',
    },
  },

  // T3: Booking confirmed ────────────────────────────────────────────────
  BOOKING_CONFIRMED: {
    ar: {
      subject: 'تأكيد الموعد',
      body: 'مرحبًا {{patientName}}، تم تأكيد موعدك ({{bookingNumber}}) في {{facilityName}} — {{branchName}} يوم {{appointmentDate}} الساعة {{appointmentTime}} مع د. {{doctorName}}. خدمة: {{serviceName}}.',
    },
    en: {
      subject: 'Appointment Confirmed',
      body: 'Hello {{patientName}}, your appointment ({{bookingNumber}}) at {{facilityName}} — {{branchName}} on {{appointmentDate}} at {{appointmentTime}} with Dr. {{doctorName}} has been confirmed. Service: {{serviceName}}.',
    },
  },

  // T4: Booking rejected ─────────────────────────────────────────────────
  BOOKING_REJECTED: {
    ar: {
      subject: 'اعتذار — لم يُقبل طلب الحجز',
      body: 'مرحبًا {{patientName}}، نأسف لإبلاغك أن طلب حجزك ({{bookingNumber}}) في {{facilityName}} لم يُقبل. السبب: {{rejectionReason}}. يمكنك البحث عن بدائل متاحة عبر المنصة.',
    },
    en: {
      subject: 'Apologies — Booking Request Not Accepted',
      body: 'Hello {{patientName}}, we regret to inform you that your booking request ({{bookingNumber}}) at {{facilityName}} was not accepted. Reason: {{rejectionReason}}. You can search for available alternatives on the platform.',
    },
  },

  // T5: Alternative suggested ────────────────────────────────────────────
  ALTERNATIVE_SUGGESTED: {
    ar: {
      subject: 'موعد بديل مقترح',
      body: 'مرحبًا {{patientName}}، اقترحت {{facilityName}} موعدًا بديلًا لحجزك ({{bookingNumber}}): {{alternativeDate}} الساعة {{alternativeTime}}. يمكنك القبول أو رفض الاقتراح عبر المنصة.',
    },
    en: {
      subject: 'Alternative Appointment Suggested',
      body: 'Hello {{patientName}}, {{facilityName}} has suggested an alternative time for your booking ({{bookingNumber}}): {{alternativeDate}} at {{alternativeTime}}. You can accept or decline via the platform.',
    },
  },

  // T6/T9: Booking cancelled ─────────────────────────────────────────────
  BOOKING_CANCELLED: {
    ar: {
      subject: 'إلغاء الحجز',
      body: 'مرحبًا {{patientName}}، تم إلغاء حجزك ({{bookingNumber}}) في {{facilityName}}. السبب: {{cancellationReason}}.',
    },
    en: {
      subject: 'Booking Cancelled',
      body: 'Hello {{patientName}}, your booking ({{bookingNumber}}) at {{facilityName}} has been cancelled. Reason: {{cancellationReason}}.',
    },
  },

  // T7: SLA warning ──────────────────────────────────────────────────────
  SLA_WARNING: {
    ar: {
      subject: 'تنبيه تأخر — تجاوز وقت الاستجابة',
      body: 'تنبيه: الحجز ({{bookingNumber}}) في {{branchName}} تجاوز وقت الاستجابة المستهدف ({{slaMinutes}} دقيقة). يُرجى التأكيد أو الرفض فورًا.',
    },
    en: {
      subject: 'Delay Alert — Response Time Exceeded',
      body: 'Alert: Booking ({{bookingNumber}}) at {{branchName}} has exceeded the target response time ({{slaMinutes}} minutes). Please confirm or reject immediately.',
    },
  },

  // T8: Booking rescheduled ──────────────────────────────────────────────
  BOOKING_RESCHEDULED: {
    ar: {
      subject: 'إعادة جدولة الحجز',
      body: 'مرحبًا {{patientName}}، تمت إعادة جدولة حجزك ({{bookingNumber}}) في {{facilityName}} إلى {{appointmentDate}} الساعة {{appointmentTime}}.',
    },
    en: {
      subject: 'Booking Rescheduled',
      body: 'Hello {{patientName}}, your booking ({{bookingNumber}}) at {{facilityName}} has been rescheduled to {{appointmentDate}} at {{appointmentTime}}.',
    },
  },

  // T10: Appointment reminder ────────────────────────────────────────────
  APPOINTMENT_REMINDER: {
    ar: {
      subject: 'تذكير بالموعد',
      body: 'مرحبًا {{patientName}}، نذكرك بموعدك ({{bookingNumber}}) في {{facilityName}} — {{branchName}} يوم {{appointmentDate}} الساعة {{appointmentTime}} مع د. {{doctorName}}.',
    },
    en: {
      subject: 'Appointment Reminder',
      body: 'Hello {{patientName}}, this is a reminder for your appointment ({{bookingNumber}}) at {{facilityName}} — {{branchName}} on {{appointmentDate}} at {{appointmentTime}} with Dr. {{doctorName}}.',
    },
  },

  // T12: No-show recorded ────────────────────────────────────────────────
  NO_SHOW_RECORDED: {
    ar: {
      subject: 'تسجيل عدم حضور',
      body: 'مرحبًا {{patientName}}، تم تسجيل عدم حضورك لموعدك ({{bookingNumber}}) في {{facilityName}} يوم {{appointmentDate}}. إذا كان هناك خطأ، يُرجى التواصل معنا.',
    },
    en: {
      subject: 'No-Show Recorded',
      body: 'Hello {{patientName}}, a no-show has been recorded for your appointment ({{bookingNumber}}) at {{facilityName}} on {{appointmentDate}}. If this is an error, please contact us.',
    },
  },

  // T14: Value submitted ─────────────────────────────────────────────────
  VALUE_SUBMITTED: {
    ar: {
      subject: 'قيمة خدمة بانتظار الاعتماد',
      body: 'تم تقديم قيمة الخدمة للحجز ({{bookingNumber}}) في {{branchName}}. يُرجى مراجعتها واعتمادها.',
    },
    en: {
      subject: 'Service Value Pending Approval',
      body: 'A service value has been submitted for booking ({{bookingNumber}}) at {{branchName}}. Please review and approve.',
    },
  },

  // T15: Value approved ──────────────────────────────────────────────────
  VALUE_APPROVED: {
    ar: {
      subject: 'اعتماد القيمة النهائية',
      body: 'مرحبًا {{patientName}}، تم اعتماد القيمة النهائية لحجزك ({{bookingNumber}}) في {{facilityName}}. إذا كان لديك اعتراض، يمكنك تقديمه عبر المنصة.',
    },
    en: {
      subject: 'Final Value Approved',
      body: 'Hello {{patientName}}, the final value for your booking ({{bookingNumber}}) at {{facilityName}} has been approved. If you have an objection, you can submit it via the platform.',
    },
  },

  // T16: Value rejected ──────────────────────────────────────────────────
  VALUE_REJECTED: {
    ar: {
      subject: 'رفض القيمة المقدمة',
      body: 'تم رفض القيمة المقدمة للحجز ({{bookingNumber}}) في {{branchName}}. السبب: {{rejectionReason}}. يُرجى تعديلها وإعادة التقديم.',
    },
    en: {
      subject: 'Submitted Value Rejected',
      body: 'The submitted value for booking ({{bookingNumber}}) at {{branchName}} has been rejected. Reason: {{rejectionReason}}. Please revise and resubmit.',
    },
  },

  // B-29: SLA auto-cancel ────────────────────────────────────────────────
  SLA_AUTO_CANCEL: {
    ar: {
      subject: 'إلغاء تلقائي — تجاوز وقت الاستجابة',
      body: 'مرحبًا {{patientName}}، نعتذر — تم إلغاء حجزك ({{bookingNumber}}) تلقائيًا لعدم تأكيد العيادة خلال المدة المحددة. يمكنك البحث عن بدائل متاحة عبر المنصة أو التحدث مع المساعد الذكي.',
    },
    en: {
      subject: 'Auto-Cancelled — Response Time Exceeded',
      body: 'Hello {{patientName}}, we apologize — your booking ({{bookingNumber}}) has been automatically cancelled as the clinic did not confirm within the required time. You can search for available alternatives on the platform or speak with the smart assistant.',
    },
  },

  // NOTIF-061: License expiring ──────────────────────────────────────────
  LICENSE_EXPIRING: {
    ar: {
      subject: 'تنبيه انتهاء ترخيص',
      body: 'تنبيه: ترخيص {{licenseType}} لمنشأة {{facilityName}} ينتهي في {{licenseExpiry}} (بعد {{daysUntilExpiry}} يوم). يُرجى التجديد قبل الانتهاء.',
    },
    en: {
      subject: 'License Expiry Alert',
      body: 'Alert: {{licenseType}} license for {{facilityName}} expires on {{licenseExpiry}} ({{daysUntilExpiry}} days remaining). Please renew before expiry.',
    },
  },

  // NOTIF-061: Stalled bookings ──────────────────────────────────────────
  STALLED_BOOKINGS_ALERT: {
    ar: {
      subject: 'تنبيه حجوزات متعثرة',
      body: 'تنبيه: يوجد {{stalledCount}} حجز متعثر في {{branchName}} — {{facilityName}}. يُرجى مراجعتها واتخاذ الإجراء اللازم.',
    },
    en: {
      subject: 'Stalled Bookings Alert',
      body: 'Alert: There are {{stalledCount}} stalled bookings at {{branchName}} — {{facilityName}}. Please review and take action.',
    },
  },
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a notification template.
 *
 * ❗ Returns an error if any `{{variable}}` remains unreplaced.
 */
export function renderTemplate(
  type: NotificationType,
  locale: Locale,
  variables: TemplateVariables,
): Result<RenderedTemplate, TemplateError> {
  const typeTemplates = TEMPLATES[type];
  if (!typeTemplates) return err('UNKNOWN_TYPE');

  const template = typeTemplates[locale];
  if (!template) return err('UNKNOWN_LOCALE');

  const subject = replaceVariables(template.subject, variables);
  const body = replaceVariables(template.body, variables);

  // ❗ Safety check: no unresolved variables
  if (hasUnresolvedVariables(subject) || hasUnresolvedVariables(body)) {
    return err('UNRESOLVED_VARIABLES');
  }

  return ok({ subject, body });
}

/**
 * Get the raw template for a type and locale (for inspection/testing).
 */
export function getRawTemplate(
  type: NotificationType,
  locale: Locale,
): TemplateEntry | undefined {
  return TEMPLATES[type]?.[locale];
}

/**
 * Get all template types that have both ar and en variants.
 */
export function getAllTemplateTypes(): NotificationType[] {
  return Object.keys(TEMPLATES) as NotificationType[];
}

// ---------------------------------------------------------------------------
// Variable replacement
// ---------------------------------------------------------------------------

/**
 * Replace `{{variableName}}` with the corresponding value from `variables`.
 *
 * Numbers and booleans are coerced to strings.
 * Undefined values are left as-is (caught by hasUnresolvedVariables).
 */
function replaceVariables(text: string, variables: TemplateVariables): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined || value === null) {
      return `{{${key}}}`; // Leave unresolved — will be caught
    }
    return String(value);
  });
}

/**
 * Check if any `{{...}}` placeholders remain in the text.
 */
function hasUnresolvedVariables(text: string): boolean {
  return /\{\{\w+\}\}/.test(text);
}
