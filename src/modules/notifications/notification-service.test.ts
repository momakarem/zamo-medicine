/**
 * ZAMO-NOTIF-058 — notification service tests.
 *
 * Validates:
 *   - Each notification type sends at the right time
 *   - ❗ No confirmation notification before reception confirms
 *   - Consent is checked before sending
 *   - Transition-to-notification mapping is correct
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NotificationService,
  MemoryConsentProvider,
  TRANSITION_TO_NOTIFICATION,
} from './notification-service.js';
import {
  ChannelDispatcher,
  MemoryWhatsAppAdapter,
  MemoryInAppAdapter,
} from './channel-dispatcher.js';
import { grantConsent } from './consent-manager.js';
import type { NotificationRecipient, TemplateVariables } from './notification-types.js';
import { NOTIFICATION_TYPES } from './notification-types.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let service: NotificationService;
let dispatcher: ChannelDispatcher;
let whatsapp: MemoryWhatsAppAdapter;
let inApp: MemoryInAppAdapter;
let consentProvider: MemoryConsentProvider;

const NOW = new Date('2026-09-20T10:00:00Z');

const PATIENT: NotificationRecipient = {
  userId: 'patient-1',
  phone: '+966512345678',
  email: 'patient@example.com',
  locale: 'ar',
};

const RECEPTIONIST: NotificationRecipient = {
  userId: 'receptionist-1',
  phone: '+966598765432',
  locale: 'ar',
};

const FULL_VARS: TemplateVariables = {
  patientName: 'أحمد محمد',
  doctorName: 'سارة الأحمد',
  facilityName: 'عيادات النور',
  branchName: 'فرع الملقا',
  serviceName: 'استشارة جلدية',
  bookingNumber: 'ZAMO-20260920-AB12',
  appointmentDate: '2026-09-25',
  appointmentTime: '10:30',
  rejectionReason: 'الطبيب غير متاح',
  cancellationReason: 'رغبة المريض',
  alternativeDate: '2026-09-26',
  alternativeTime: '14:00',
  slaMinutes: 30,
  licenseType: 'ترخيص مزاولة',
  licenseExpiry: '2026-12-31',
  daysUntilExpiry: 7,
  stalledCount: 3,
};

beforeEach(() => {
  dispatcher = new ChannelDispatcher();
  whatsapp = new MemoryWhatsAppAdapter();
  inApp = new MemoryInAppAdapter();
  dispatcher.registerAdapter(whatsapp);
  dispatcher.registerAdapter(inApp);

  consentProvider = new MemoryConsentProvider();
  // Default: patient has operational consent
  consentProvider.setConsents('patient-1', [
    grantConsent('patient-1', 'operational', NOW),
  ]);
  consentProvider.setConsents('receptionist-1', [
    grantConsent('receptionist-1', 'operational', NOW),
  ]);

  service = new NotificationService(dispatcher, consentProvider);
});

// ---------------------------------------------------------------------------
// Core notification flow
// ---------------------------------------------------------------------------

describe('NotificationService — core flow', () => {
  it('sends BOOKING_SUBMITTED to patient via whatsapp + in_app', async () => {
    const result = await service.notify({
      type: 'BOOKING_SUBMITTED',
      recipients: [PATIENT],
      variables: FULL_VARS,
      entityId: 'booking-1',
      timestamp: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.successCount).toBe(1);
    expect(whatsapp.sent.length + inApp.sent.length).toBeGreaterThan(0);
  });

  it('sends to multiple recipients', async () => {
    const result = await service.notify({
      type: 'BOOKING_SUBMITTED',
      recipients: [PATIENT, RECEPTIONIST],
      variables: FULL_VARS,
      entityId: 'booking-1',
      timestamp: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.successCount).toBe(2);
  });

  it('returns NO_RECIPIENTS error for empty recipients', async () => {
    const result = await service.notify({
      type: 'BOOKING_SUBMITTED',
      recipients: [],
      variables: FULL_VARS,
      entityId: 'booking-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('NO_RECIPIENTS');
    }
  });
});

// ---------------------------------------------------------------------------
// Consent checks
// ---------------------------------------------------------------------------

describe('NotificationService — consent', () => {
  it('skips sending when consent is not granted', async () => {
    // Remove consent
    consentProvider.setConsents('patient-1', []);

    const result = await service.notify({
      type: 'BOOKING_CONFIRMED',
      recipients: [PATIENT],
      variables: FULL_VARS,
      entityId: 'booking-1',
      timestamp: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.skippedCount).toBe(1);
    expect(result.value.successCount).toBe(0);
    expect(whatsapp.sent).toHaveLength(0);
  });

  it('logs skipped notification as skipped_consent', async () => {
    consentProvider.setConsents('patient-1', []);

    await service.notify({
      type: 'BOOKING_CONFIRMED',
      recipients: [PATIENT],
      variables: FULL_VARS,
      entityId: 'booking-1',
      timestamp: NOW,
    });

    const logs = service.getLogEntries();
    expect(logs.some((l) => l.status === 'skipped_consent')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ❗ Safety: no premature confirmation
// ---------------------------------------------------------------------------

describe('NotificationService — A-12 safety', () => {
  it('❗ BOOKING_SUBMITTED template does NOT contain confirmation language', async () => {
    const result = await service.notify({
      type: 'BOOKING_SUBMITTED',
      recipients: [PATIENT],
      variables: FULL_VARS,
      entityId: 'booking-1',
      timestamp: NOW,
    });

    expect(result.ok).toBe(true);

    // Check all sent messages
    for (const msg of whatsapp.sent) {
      expect(msg.body).not.toContain('تم تأكيد');
      expect(msg.body).not.toMatch(/booking.*is confirmed/i);
    }
    for (const msg of inApp.sent) {
      expect(msg.body).not.toContain('تم تأكيد');
      expect(msg.body).not.toMatch(/booking.*is confirmed/i);
    }
  });

  it('BOOKING_CONFIRMED template DOES contain confirmation language', async () => {
    const result = await service.notify({
      type: 'BOOKING_CONFIRMED',
      recipients: [PATIENT],
      variables: FULL_VARS,
      entityId: 'booking-1',
      timestamp: NOW,
    });

    expect(result.ok).toBe(true);

    const allMessages = [...whatsapp.sent, ...inApp.sent];
    expect(allMessages.some((m) => m.body.includes('تأكيد'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reminder timing
// ---------------------------------------------------------------------------

describe('NotificationService — reminder', () => {
  it('sends APPOINTMENT_REMINDER with correct appointment details', async () => {
    const result = await service.notify({
      type: 'APPOINTMENT_REMINDER',
      recipients: [PATIENT],
      variables: FULL_VARS,
      entityId: 'booking-1',
      timestamp: NOW,
    });

    expect(result.ok).toBe(true);

    const allMessages = [...whatsapp.sent, ...inApp.sent];
    expect(allMessages.some((m) => m.body.includes('نذكرك'))).toBe(true);
    expect(allMessages.some((m) => m.body.includes('2026-09-25'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transition → notification mapping
// ---------------------------------------------------------------------------

describe('TRANSITION_TO_NOTIFICATION mapping', () => {
  it('maps T2 to BOOKING_SUBMITTED', () => {
    expect(TRANSITION_TO_NOTIFICATION['T2']).toBe('BOOKING_SUBMITTED');
  });

  it('maps T3 to BOOKING_CONFIRMED', () => {
    expect(TRANSITION_TO_NOTIFICATION['T3']).toBe('BOOKING_CONFIRMED');
  });

  it('maps T7 to SLA_WARNING', () => {
    expect(TRANSITION_TO_NOTIFICATION['T7']).toBe('SLA_WARNING');
  });

  it('maps both T6 and T9 to BOOKING_CANCELLED', () => {
    expect(TRANSITION_TO_NOTIFICATION['T6']).toBe('BOOKING_CANCELLED');
    expect(TRANSITION_TO_NOTIFICATION['T9']).toBe('BOOKING_CANCELLED');
  });

  it('covers all transitions that trigger notifications', () => {
    const expectedTransitions = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T12', 'T14', 'T15', 'T16'];
    for (const tid of expectedTransitions) {
      expect(TRANSITION_TO_NOTIFICATION[tid], `Missing mapping for ${tid}`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

describe('NotificationService — logging', () => {
  it('creates log entries for sent notifications', async () => {
    await service.notify({
      type: 'BOOKING_CONFIRMED',
      recipients: [PATIENT],
      variables: FULL_VARS,
      entityId: 'booking-1',
      timestamp: NOW,
    });

    const logs = service.getLogEntries();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.status === 'sent')).toBe(true);
    expect(logs[0]?.notificationType).toBe('BOOKING_CONFIRMED');
  });
});
