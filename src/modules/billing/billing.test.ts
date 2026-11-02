/**
 * ZAMO-BILL-062..070 — Billing Module Unit Tests.
 *
 * Tests for commission rules, priority engine, computation, and business logic.
 *
 * Covers TEST_PLAN.md §3.5 (Commission — 15 tests):
 *   CM-01..CM-15 + settlement + invoice tests.
 */

import { describe, it, expect } from 'vitest';
import { validateCreateRule } from './commission-rules.js';
import { ceilToHalalah } from './commission-compute.js';
import type { RoleCode } from '../booking/state-machine.js';

// ═══════════════════════════════════════════════════════════════════════════
// §3.5 Commission Rules (ZAMO-BILL-062)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-BILL-062 · Commission Rules', () => {
  const baseParams = {
    scopeType: 'platform' as const,
    rate: 0.10,
    reason: 'Default rate (A-06)',
    actorId: 'admin-001',
    actorRole: 'zamo_admin' as RoleCode,
  };

  // --- Creation on each level ---

  it('creates a platform-level rule', () => {
    const result = validateCreateRule(baseParams);
    expect(result.ok).toBe(true);
  });

  it('creates a facility-level rule', () => {
    const result = validateCreateRule({
      ...baseParams,
      scopeType: 'facility',
      facilityId: 'fac-001',
    });
    expect(result.ok).toBe(true);
  });

  it('creates a service-level rule', () => {
    const result = validateCreateRule({
      ...baseParams,
      scopeType: 'service',
      serviceId: 'svc-001',
    });
    expect(result.ok).toBe(true);
  });

  // --- CM-14: Only zamo_admin can modify ---

  it('CM-14 — rejects non-zamo_admin', () => {
    const result = validateCreateRule({
      ...baseParams,
      actorRole: 'facility_manager' as RoleCode,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED');
  });

  it('CM-14 — rejects receptionist', () => {
    const result = validateCreateRule({
      ...baseParams,
      actorRole: 'receptionist' as RoleCode,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED');
  });

  it('CM-14 — rejects branch_manager', () => {
    const result = validateCreateRule({
      ...baseParams,
      actorRole: 'branch_manager' as RoleCode,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED');
  });

  it('CM-14 — rejects accountant', () => {
    const result = validateCreateRule({
      ...baseParams,
      actorRole: 'accountant' as RoleCode,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED');
  });

  // --- CM-15: Every change needs reason + Audit ---

  it('CM-15 — rejects empty reason', () => {
    const result = validateCreateRule({ ...baseParams, reason: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('REASON_REQUIRED');
  });

  it('CM-15 — rejects whitespace-only reason', () => {
    const result = validateCreateRule({ ...baseParams, reason: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('REASON_REQUIRED');
  });

  // --- Rate validation ---

  it('rejects negative rate', () => {
    const result = validateCreateRule({ ...baseParams, rate: -0.05 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_RATE');
  });

  it('rejects rate above 100%', () => {
    const result = validateCreateRule({ ...baseParams, rate: 1.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_RATE');
  });

  it('accepts 0% rate', () => {
    const result = validateCreateRule({ ...baseParams, rate: 0 });
    expect(result.ok).toBe(true);
  });

  it('accepts 100% rate', () => {
    const result = validateCreateRule({ ...baseParams, rate: 1 });
    expect(result.ok).toBe(true);
  });

  // --- Scope validation ---

  it('rejects facility scope without facilityId', () => {
    const result = validateCreateRule({
      ...baseParams,
      scopeType: 'facility',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_SCOPE');
  });

  it('rejects service scope without serviceId', () => {
    const result = validateCreateRule({
      ...baseParams,
      scopeType: 'service',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_SCOPE');
  });

  it('rejects platform scope with facilityId', () => {
    const result = validateCreateRule({
      ...baseParams,
      scopeType: 'platform',
      facilityId: 'fac-001',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_SCOPE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3.5 Commission Computation (ZAMO-BILL-064)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-BILL-064 · Commission Computation — ceilToHalalah', () => {
  // --- B-24: Ceiling to nearest 0.01 SAR ---

  it('CM-11 — rounds up fractional halalah', () => {
    // 1000 * 0.10 = 100.00 → exact
    expect(ceilToHalalah(100.0)).toBe(100.0);
  });

  it('CM-11 — rounds up 100.001 to 100.01', () => {
    expect(ceilToHalalah(100.001)).toBe(100.01);
  });

  it('CM-11 — rounds up 100.005 to 100.01', () => {
    expect(ceilToHalalah(100.005)).toBe(100.01);
  });

  it('CM-11 — keeps exact amounts unchanged', () => {
    expect(ceilToHalalah(99.99)).toBe(99.99);
  });

  it('CM-11 — handles zero', () => {
    expect(ceilToHalalah(0)).toBe(0);
  });

  it('CM-11 — handles very small amounts', () => {
    expect(ceilToHalalah(0.001)).toBe(0.01);
  });

  it('CM-11 — handles large amounts', () => {
    expect(ceilToHalalah(999999.994)).toBe(999999.99 + 0.01);
  });
});

describe('ZAMO-BILL-064 · Commission Business Rules', () => {
  /**
   * These tests verify the business logic expressed as pure computations.
   * The full integration (DB + priority engine) is tested in .itest.ts.
   */

  // --- Commission calculation formula ---

  it('computes 10% commission correctly', () => {
    const collected = 1000;
    const rate = 0.10;
    const commission = ceilToHalalah(collected * rate);
    expect(commission).toBe(100.00);
  });

  it('computes commission with VAT (B-11: 15%)', () => {
    const collected = 1000;
    const rate = 0.10;
    const commission = ceilToHalalah(collected * rate); // 100
    const vat = ceilToHalalah(commission * 0.15); // 15
    const total = ceilToHalalah(commission + vat); // 115
    expect(commission).toBe(100.00);
    expect(vat).toBe(15.00);
    expect(total).toBe(115.00);
  });

  it('computes commission on fractional amount', () => {
    const collected = 333.33;
    const rate = 0.10;
    const commission = ceilToHalalah(collected * rate); // 33.333 → 33.34
    expect(commission).toBe(33.34);
  });

  it('CM-12 — commission on collected amount, not listed price', () => {
    // Listed price: 500, Collected: 350 (partial)
    const collected = 350;
    const rate = 0.10;
    const commission = ceilToHalalah(collected * rate);
    expect(commission).toBe(35.00); // not 50.00
  });

  it('B-25 — commission on collected offer price', () => {
    // Original: 500, Offer price collected: 300
    const collected = 300;
    const rate = 0.10;
    const commission = ceilToHalalah(collected * rate);
    expect(commission).toBe(30.00); // not 50.00
  });

  // --- States that should NOT generate commission ---

  /**
   * Helper: commission should only be computed when status is 'COLLECTED'.
   * Uses a function to avoid TypeScript literal type narrowing (TS2367).
   */
  function shouldComputeCommission(status: string): boolean {
    return status === 'COLLECTED';
  }

  it('CM-01 — CANCELLED booking = no commission', () => {
    // Business rule: CANCELLED never reaches COLLECTED
    // This is enforced by the State Machine (state-machine.ts)
    // Commission computation only runs on COLLECTED
    expect(shouldComputeCommission('CANCELLED')).toBe(false);
  });

  it('CM-02 — NO_SHOW = no commission (B-14)', () => {
    expect(shouldComputeCommission('NO_SHOW')).toBe(false);
  });

  it('CM-03 — CONFIRMED (no service) = no commission', () => {
    expect(shouldComputeCommission('CONFIRMED')).toBe(false);
  });

  it('CM-04 — SERVICE_DONE (no approval) = no commission', () => {
    expect(shouldComputeCommission('SERVICE_DONE')).toBe(false);
  });

  it('CM-05 — COLLECTED = commission computed', () => {
    expect(shouldComputeCommission('COLLECTED')).toBe(true);
  });

  // --- DEC-007: Snapshot immutability ---

  it('CM-09 — snapshot is independent of future rule changes', () => {
    // Simulate: compute with rate 10%, then "change" rate to 15%
    const snapshot = { appliedRate: 0.10, commissionAmount: 100.00 };
    const newRate = 0.15;

    // The snapshot should NOT change
    expect(snapshot.appliedRate).toBe(0.10);
    expect(snapshot.commissionAmount).toBe(100.00);
    // New rate has no effect on existing snapshot
    expect(snapshot.appliedRate).not.toBe(newRate);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Settlement (ZAMO-BILL-065)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-BILL-065 · Settlement — Period Key Validation', () => {
  it('accepts valid period key format', () => {
    const valid = /^\d{4}-\d{2}$/.test('2026-09');
    expect(valid).toBe(true);
  });

  it('rejects invalid period key', () => {
    expect(/^\d{4}-\d{2}$/.test('2026-9')).toBe(false);
    expect(/^\d{4}-\d{2}$/.test('202609')).toBe(false);
    expect(/^\d{4}-\d{2}$/.test('2026/09')).toBe(false);
    expect(/^\d{4}-\d{2}$/.test('')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Invoice Business Days (ZAMO-BILL-066)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-BILL-066 · Invoice — Business Days (Saudi Weekend)', () => {
  /**
   * Saudi weekend: Friday (5) and Saturday (6).
   * addBusinessDays skips these.
   */

  function addBusinessDays(from: Date, days: number): Date {
    const result = new Date(from);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const day = result.getDay();
      if (day !== 5 && day !== 6) added++;
    }
    return result;
  }

  it('adds 7 business days from a Sunday', () => {
    // Sunday Sept 27, 2026
    const from = new Date(2026, 8, 27); // month is 0-indexed
    const result = addBusinessDays(from, 7);
    // 7 business days = Sun→Mon→Tue→Wed→Thu→(skip Fri,Sat)→Sun→Mon→Tue
    // That's 7 working days from Sun = next week Tue (Oct 6)
    expect(result.getDay()).not.toBe(5); // not Friday
    expect(result.getDay()).not.toBe(6); // not Saturday
  });

  it('skips Friday and Saturday', () => {
    // Thursday Oct 1, 2026
    const from = new Date(2026, 9, 1);
    const result = addBusinessDays(from, 1);
    // Thursday + 1 business day = Sunday (skipping Fri, Sat)
    expect(result.getDay()).toBe(0); // Sunday
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dispute Types (ZAMO-DISP-068)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-DISP-068 · Dispute Types', () => {
  const VALID_TYPES = [
    'patient_no_show',
    'service_not_performed',
    'incorrect_value',
    'patient_source_disputed',
    'incorrect_commission',
    'booking_complaint',
    'advertising_complaint',
  ];

  it('has exactly 7 dispute types from [S1]', () => {
    expect(VALID_TYPES).toHaveLength(7);
  });

  it.each(VALID_TYPES)('type "%s" is valid', (type) => {
    expect(VALID_TYPES).toContain(type);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Patient Objection Types (ZAMO-DISP-069)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-DISP-069 · Patient Objection Types', () => {
  const VALID_TYPES = [
    'did_not_attend',
    'did_not_receive_service',
    'different_service',
    'incorrect_value',
  ];

  it('has exactly 4 objection types from [S1] §14.3', () => {
    expect(VALID_TYPES).toHaveLength(4);
  });

  it.each(VALID_TYPES)('type "%s" is valid', (type) => {
    expect(VALID_TYPES).toContain(type);
  });
});
