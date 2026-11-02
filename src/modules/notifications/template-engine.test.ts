/**
 * ZAMO-NOTIF-055 — template engine tests.
 *
 * Validates:
 *   - Arabic template renders for Arabic locale
 *   - English template renders for English locale
 *   - ❗ No unresolved variables in any template
 *   - All 15 types have both ar and en templates
 */

import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  getRawTemplate,
  getAllTemplateTypes,
} from './template-engine.js';
import { NOTIFICATION_TYPES } from './notification-types.js';
import type { NotificationType, TemplateVariables } from './notification-types.js';

// ---------------------------------------------------------------------------
// Test data — complete variable set that satisfies all templates
// ---------------------------------------------------------------------------

const FULL_VARIABLES: TemplateVariables = {
  patientName: 'أحمد محمد',
  doctorName: 'سارة الأحمد',
  facilityName: 'عيادات النور',
  branchName: 'فرع الملقا',
  serviceName: 'استشارة جلدية',
  bookingNumber: 'ZAMO-20260920-AB12',
  appointmentDate: '2026-09-25',
  appointmentTime: '10:30',
  rejectionReason: 'الطبيب غير متاح في هذا الوقت',
  cancellationReason: 'رغبة المريض',
  alternativeDate: '2026-09-26',
  alternativeTime: '14:00',
  slaMinutes: 30,
  licenseType: 'ترخيص مزاولة',
  licenseExpiry: '2026-12-31',
  daysUntilExpiry: 7,
  stalledCount: 3,
};

// ---------------------------------------------------------------------------
// Arabic templates
// ---------------------------------------------------------------------------

describe('Template Engine — Arabic', () => {
  it('renders BOOKING_SUBMITTED in Arabic with correct message (A-12/A-13)', () => {
    const result = renderTemplate('BOOKING_SUBMITTED', 'ar', FULL_VARIABLES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.body).toContain('أحمد محمد');
    expect(result.value.body).toContain('ZAMO-20260920-AB12');
    expect(result.value.body).toContain('عيادات النور');
    // ❗ A-12: must NOT contain "تم تأكيد" in submission template
    expect(result.value.body).not.toContain('تم تأكيد');
    // ❗ A-13: must say "سنبلغك فور تأكيد الموعد"
    expect(result.value.body).toContain('سنبلغك فور تأكيد الموعد');
  });

  it('renders BOOKING_CONFIRMED in Arabic', () => {
    const result = renderTemplate('BOOKING_CONFIRMED', 'ar', FULL_VARIABLES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.body).toContain('تم تأكيد');
    expect(result.value.body).toContain('د. سارة الأحمد');
    expect(result.value.body).toContain('استشارة جلدية');
  });

  it('renders SLA_WARNING in Arabic', () => {
    const result = renderTemplate('SLA_WARNING', 'ar', FULL_VARIABLES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.body).toContain('30 دقيقة');
    expect(result.value.body).toContain('فرع الملقا');
  });

  it('renders SLA_AUTO_CANCEL in Arabic with apology and alternatives', () => {
    const result = renderTemplate('SLA_AUTO_CANCEL', 'ar', FULL_VARIABLES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.body).toContain('نعتذر');
    expect(result.value.body).toContain('بدائل');
  });

  it('renders LICENSE_EXPIRING in Arabic', () => {
    const result = renderTemplate('LICENSE_EXPIRING', 'ar', FULL_VARIABLES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.body).toContain('7 يوم');
    expect(result.value.body).toContain('ترخيص مزاولة');
  });
});

// ---------------------------------------------------------------------------
// English templates
// ---------------------------------------------------------------------------

describe('Template Engine — English', () => {
  it('renders BOOKING_SUBMITTED in English with correct message (A-12/A-13)', () => {
    const result = renderTemplate('BOOKING_SUBMITTED', 'en', {
      ...FULL_VARIABLES,
      patientName: 'Ahmed Mohammed',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.body).toContain('Ahmed Mohammed');
    // ❗ A-12: must NOT say "your booking is confirmed" in submission template
    expect(result.value.body).not.toMatch(/your booking[^.]*?\bis confirmed/i);
    expect(result.value.body).toContain('once the appointment is confirmed');
  });

  it('renders BOOKING_CONFIRMED in English', () => {
    const result = renderTemplate('BOOKING_CONFIRMED', 'en', FULL_VARIABLES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.body).toContain('has been confirmed');
    expect(result.value.body).toContain('Dr.');
  });

  it('renders SLA_AUTO_CANCEL in English with apology and alternatives', () => {
    const result = renderTemplate('SLA_AUTO_CANCEL', 'en', FULL_VARIABLES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.body).toContain('apologize');
    expect(result.value.body).toContain('alternatives');
  });
});

// ---------------------------------------------------------------------------
// ❗ No unresolved variables — critical safety check
// ---------------------------------------------------------------------------

describe('Template Engine — no unresolved variables', () => {
  for (const type of NOTIFICATION_TYPES) {
    it(`${type} (ar) has no unresolved variables`, () => {
      const result = renderTemplate(type, 'ar', FULL_VARIABLES);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        expect(result.error).not.toBe('UNRESOLVED_VARIABLES');
      }
    });

    it(`${type} (en) has no unresolved variables`, () => {
      const result = renderTemplate(type, 'en', FULL_VARIABLES);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        expect(result.error).not.toBe('UNRESOLVED_VARIABLES');
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Completeness — every type has both locales
// ---------------------------------------------------------------------------

describe('Template completeness', () => {
  it('every NotificationType has a raw template for ar and en', () => {
    for (const type of NOTIFICATION_TYPES) {
      const ar = getRawTemplate(type, 'ar');
      const en = getRawTemplate(type, 'en');
      expect(ar, `Missing Arabic template for ${type}`).toBeDefined();
      expect(en, `Missing English template for ${type}`).toBeDefined();
    }
  });

  it('getAllTemplateTypes returns all 15 types', () => {
    const types = getAllTemplateTypes();
    expect(types.length).toBe(NOTIFICATION_TYPES.length);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('Template Engine — errors', () => {
  it('returns UNRESOLVED_VARIABLES when variables are missing', () => {
    const result = renderTemplate('BOOKING_SUBMITTED', 'ar', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('UNRESOLVED_VARIABLES');
    }
  });

  it('returns UNKNOWN_TYPE for invalid type', () => {
    const result = renderTemplate('INVALID' as NotificationType, 'ar', FULL_VARIABLES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('UNKNOWN_TYPE');
    }
  });
});
