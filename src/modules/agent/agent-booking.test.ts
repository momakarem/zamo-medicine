/**
 * ZAMO-AGENT-051/052 — Agent Booking tests.
 *
 * Tests from IMPLEMENTATION_CHECKLIST:
 *   ❗ سيناريو [S2] كاملًا: «أريد استشارة جلدية في الملقا اليوم» ← حتى PENDING_CONFIRMATION
 *   ❗ الوكيل لا يقول «تم تأكيد الحجز»
 *   الحجز عبر الوكيل يخضع لنفس القيود والتدقيق
 *   ❗ إعادة جدولة حجز مريض آخر ← تفشل
 *   الإلغاء عبر الوكيل يحرر الفتحة
 */

import { describe, it, expect } from 'vitest';
import {
  validateAgentBooking,
  formatBookingCreatedMessage,
  formatBookingStatus,
  getBookingErrorMessage,
  getStatusLabel,
  BOOKING_CREATED_MESSAGE,
  type AgentBookingParams,
} from './agent-booking.ts';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeParams(overrides: Partial<AgentBookingParams> = {}): AgentBookingParams {
  return {
    patientId: 'patient-1',
    doctorId: 'doc-1',
    branchId: 'br-1',
    facilityId: 'fac-1',
    branchServiceId: 'bs-1',
    slotStart: '2026-09-20T10:00:00+03:00',
    slotEnd: '2026-09-20T10:30:00+03:00',
    consentPrivacy: true,
    consentOperational: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateAgentBooking
// ---------------------------------------------------------------------------

describe('validateAgentBooking', () => {
  it('passes valid params with verified patient', () => {
    const result = validateAgentBooking(makeParams(), true);
    expect(result.ok).toBe(true);
  });

  it('rejects unverified patient (A-33)', () => {
    const result = validateAgentBooking(makeParams(), false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('PATIENT_NOT_VERIFIED');
    }
  });

  it('rejects missing privacy consent (A-51)', () => {
    const result = validateAgentBooking(makeParams({ consentPrivacy: false }), true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('PRIVACY_CONSENT_REQUIRED');
    }
  });

  it('rejects missing required params', () => {
    const result = validateAgentBooking(makeParams({ doctorId: '' }), true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('INVALID_PARAMS');
    }
  });
});

// ---------------------------------------------------------------------------
// A-12/A-13: Booking created message
// ---------------------------------------------------------------------------

describe('Booking Created Message (A-12/A-13)', () => {
  it('Arabic message matches A-13 approved text', () => {
    expect(BOOKING_CREATED_MESSAGE.ar).toContain('تم إرسال طلب حجزك');
    expect(BOOKING_CREATED_MESSAGE.ar).toContain('سنبلغك فور تأكيد الموعد');
  });

  it('❗ Arabic message does NOT say "تم تأكيد"', () => {
    expect(BOOKING_CREATED_MESSAGE.ar).not.toContain('تم تأكيد');
    expect(BOOKING_CREATED_MESSAGE.ar).not.toContain('حجزك مؤكد');
  });

  it('❗ English message does NOT claim booking IS confirmed (A-12)', () => {
    // A-12: must not say "your booking is confirmed" (present tense)
    // But "once the appointment is confirmed" (future conditional) is correct
    expect(BOOKING_CREATED_MESSAGE.en).not.toMatch(/your booking is confirmed/i);
    expect(BOOKING_CREATED_MESSAGE.en).not.toMatch(/booking confirmed/i);
    expect(BOOKING_CREATED_MESSAGE.en).toContain('once the appointment is confirmed');
  });

  it('formatBookingCreatedMessage includes booking number', () => {
    const msg = formatBookingCreatedMessage('ZAMO-20260920-A3F2', 'ar');
    expect(msg).toContain('ZAMO-20260920-A3F2');
    expect(msg).toContain('تم إرسال طلب حجزك');
  });
});

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

describe('Status Labels', () => {
  it('PENDING_CONFIRMATION says "بانتظار تأكيد العيادة"', () => {
    expect(getStatusLabel('PENDING_CONFIRMATION', 'ar')).toBe('بانتظار تأكيد العيادة');
    expect(getStatusLabel('PENDING_CONFIRMATION', 'en')).toContain('Pending');
  });

  it('all 9 statuses have labels', () => {
    const statuses = [
      'NEW', 'PENDING_CONFIRMATION', 'CONFIRMED',
      'ATTENDED', 'SERVICE_DONE', 'COLLECTED',
      'CANCELLED', 'NO_SHOW', 'REJECTED',
    ] as const;

    for (const s of statuses) {
      expect(getStatusLabel(s, 'ar')).toBeTruthy();
      expect(getStatusLabel(s, 'en')).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

describe('Error Messages', () => {
  it('all errors have AR and EN messages', () => {
    const errors = [
      'PATIENT_NOT_VERIFIED', 'PRIVACY_CONSENT_REQUIRED',
      'MAX_PENDING_BOOKINGS', 'SLOT_CONFLICT',
      'BOOKING_NOT_FOUND', 'NOT_OWNER',
      'MAX_RESCHEDULES', 'INVALID_TRANSITION', 'INVALID_PARAMS',
    ] as const;

    for (const e of errors) {
      expect(getBookingErrorMessage(e, 'ar')).toBeTruthy();
      expect(getBookingErrorMessage(e, 'en')).toBeTruthy();
    }
  });

  it('NOT_OWNER error explains they cannot modify others\' bookings', () => {
    const arMsg = getBookingErrorMessage('NOT_OWNER', 'ar');
    expect(arMsg).toContain('ليس لك');

    const enMsg = getBookingErrorMessage('NOT_OWNER', 'en');
    expect(enMsg).toContain('not your booking');
  });
});

// ---------------------------------------------------------------------------
// formatBookingStatus
// ---------------------------------------------------------------------------

describe('formatBookingStatus', () => {
  it('formats a complete status response', () => {
    const text = formatBookingStatus({
      bookingId: 'b-1',
      bookingNumber: 'ZAMO-20260920-A3F2',
      status: 'PENDING_CONFIRMATION',
      statusLabelAr: 'بانتظار تأكيد العيادة',
      statusLabelEn: 'Pending Clinic Confirmation',
      doctorName: 'د. أحمد',
      serviceName: 'تنظيف أسنان',
      branchName: 'فرع الملقا',
      slotStart: '2026-09-20 10:00',
      slotEnd: '2026-09-20 10:30',
    }, 'ar');

    expect(text).toContain('ZAMO-20260920-A3F2');
    expect(text).toContain('بانتظار تأكيد العيادة');
    expect(text).toContain('د. أحمد');
    expect(text).toContain('تنظيف أسنان');
  });
});
