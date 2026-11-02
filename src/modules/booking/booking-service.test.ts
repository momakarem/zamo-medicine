/**
 * ZAMO-BOOK-029/031 — Booking service unit tests.
 *
 * Tests booking creation validation, number generation,
 * and the critical A-12 safety check.
 */
import { describe, it, expect } from 'vitest';
import {
  generateBookingNumber,
  validateCreateBooking,
  BOOKING_SUCCESS_MESSAGES,
  FORBIDDEN_SUCCESS_WORDS,
} from './booking-service.js';

// ---------------------------------------------------------------------------
// generateBookingNumber
// ---------------------------------------------------------------------------
describe('generateBookingNumber', () => {
  it('generates a number matching ZAMO-YYYYMMDD-XXXX format', () => {
    const num = generateBookingNumber(new Date('2026-09-17T12:00:00Z'));
    expect(num).toMatch(/^ZAMO-20260917-[A-Z0-9]{4}$/);
  });

  it('generates unique numbers', () => {
    const numbers = new Set(
      Array.from({ length: 100 }, () => generateBookingNumber()),
    );
    // With 4 alphanumeric chars, collisions in 100 should be extremely rare
    expect(numbers.size).toBeGreaterThan(95);
  });
});

// ---------------------------------------------------------------------------
// validateCreateBooking
// ---------------------------------------------------------------------------
describe('validateCreateBooking', () => {
  const validParams = {
    patientId: 'p-001',
    doctorId: 'd-001',
    branchId: 'b-001',
    facilityId: 'f-001',
    branchServiceId: 'bs-001',
    slotStart: new Date('2026-09-20T09:00:00Z'),
    slotEnd: new Date('2026-09-20T09:30:00Z'),
    consentPrivacy: true,
    consentOperational: true,
    consentMarketing: false,
  };

  it('accepts valid booking with 0 pending', () => {
    const result = validateCreateBooking(validParams, 0);
    expect(result.ok).toBe(true);
  });

  it('accepts valid booking with 2 pending (under limit)', () => {
    const result = validateCreateBooking(validParams, 2);
    expect(result.ok).toBe(true);
  });

  it('❗ rejects when privacy consent is missing (A-51)', () => {
    const result = validateCreateBooking(
      { ...validParams, consentPrivacy: false },
      0,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('PRIVACY_CONSENT_REQUIRED');
  });

  it('❗ rejects when patient has 3+ pending bookings (B-32)', () => {
    const result = validateCreateBooking(validParams, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('MAX_PENDING_BOOKINGS');
  });

  it('❗ rejects when patient has 5 pending bookings (B-32)', () => {
    const result = validateCreateBooking(validParams, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('MAX_PENDING_BOOKINGS');
  });
});

// ---------------------------------------------------------------------------
// ❗ A-12 Safety Check: Success page messages
// ---------------------------------------------------------------------------
describe('❗ A-12: Success page MUST NOT say "confirmed"', () => {
  it('Arabic success message does NOT contain forbidden words', () => {
    const msg = BOOKING_SUCCESS_MESSAGES.ar;
    for (const forbidden of FORBIDDEN_SUCCESS_WORDS.ar) {
      expect(msg).not.toContain(forbidden);
    }
  });

  it('English success message does NOT contain forbidden words', () => {
    const msg = BOOKING_SUCCESS_MESSAGES.en.toLowerCase();
    for (const forbidden of FORBIDDEN_SUCCESS_WORDS.en) {
      expect(msg).not.toContain(forbidden);
    }
  });

  it('Arabic message matches the approved text (A-13)', () => {
    expect(BOOKING_SUCCESS_MESSAGES.ar).toBe(
      'تم إرسال طلب حجزك إلى العيادة، وسنبلغك فور تأكيد الموعد',
    );
  });

  it('success message mentions "بانتظار" or "pending" concept', () => {
    // The message must convey that confirmation is PENDING
    const arHasPending = BOOKING_SUCCESS_MESSAGES.ar.includes('إرسال') ||
                          BOOKING_SUCCESS_MESSAGES.ar.includes('طلب');
    const enHasPending = BOOKING_SUCCESS_MESSAGES.en.toLowerCase().includes('request') ||
                          BOOKING_SUCCESS_MESSAGES.en.toLowerCase().includes('sent');
    expect(arHasPending).toBe(true);
    expect(enHasPending).toBe(true);
  });
});
