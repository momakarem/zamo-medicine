/**
 * ZAMO-GROW-071..072 — Growth Module Unit Tests.
 *
 * Tests for UTM attribution capture and campaign management.
 *
 * Covers IMPLEMENTATION_CHECKLIST.md Phase 9 — Growth:
 *   GROW-071: Attribution capture (4 tests)
 *   GROW-072: Campaign management + contribution margin (3 tests)
 */

import { describe, it, expect } from 'vitest';
import {
  deriveChannel,
  validateCapture,
  validateLinkToBooking,
} from './attribution-service.js';
import {
  validateCreateCampaign,
  validateStatusTransition,
  computeContributionMargin,
  canManageCampaigns,
} from './campaign-service.js';
import type { RoleCode } from '../booking/state-machine.js';

// ═══════════════════════════════════════════════════════════════════════════
// GROW-071 — Attribution Capture
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-GROW-071 · Attribution Capture', () => {
  // --- Test 1: الدخول من إعلان يحفظ المصدر ---

  it('captures UTM from ad click and saves the source', () => {
    const result = validateCapture({
      sessionId: 'sess-001',
      utm: {
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'summer-teeth-2026',
        utmTerm: 'teeth whitening riyadh',
        utmContent: 'ad-variant-a',
      },
      referrer: 'https://www.google.com/',
      landingPage: '/ar/dentists/riyadh',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.utmSource).toBe('google');
      expect(result.value.utmMedium).toBe('cpc');
      expect(result.value.utmCampaign).toBe('summer-teeth-2026');
      expect(result.value.utmTerm).toBe('teeth whitening riyadh');
      expect(result.value.utmContent).toBe('ad-variant-a');
      expect(result.value.channel).toBe('paid');
      expect(result.value.referrer).toBe('https://www.google.com/');
      expect(result.value.landingPage).toBe('/ar/dentists/riyadh');
    }
  });

  // --- Test 2: ❗ المصدر يبقى عبر الجلسة حتى الحجز ---

  it('preserves attribution across session — sessionId is the binding key', () => {
    const result = validateCapture({
      sessionId: 'persistent-session-42',
      utm: { utmSource: 'facebook', utmMedium: 'social' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionId).toBe('persistent-session-42');
      // sessionId is the binding key that persists across the session
      // until the booking is created and attribution_id is set
    }
  });

  // --- Test 3: المصدر ينتقل من المحادثة للحجز ---

  it('validates link-to-booking — source transfers from conversation to booking', () => {
    // Attribution not yet linked
    const result = validateLinkToBooking({
      id: 'attr-001',
      linkedToBookingAt: null,
    });
    expect(result.ok).toBe(true);

    // Already linked → rejected (first-touch only)
    const alreadyLinked = validateLinkToBooking({
      id: 'attr-001',
      linkedToBookingAt: new Date(),
    });
    expect(alreadyLinked.ok).toBe(false);
    if (!alreadyLinked.ok) {
      expect(alreadyLinked.error).toBe('ALREADY_LINKED_TO_BOOKING');
    }
  });

  // --- Test 4: الدخول المباشر يُسجَّل كمصدر مباشر ---

  it('records direct visit as channel "direct"', () => {
    const result = validateCapture({
      sessionId: 'sess-direct-001',
      // No UTM, no referrer → direct
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.channel).toBe('direct');
      expect(result.value.utmSource).toBeNull();
      expect(result.value.utmMedium).toBeNull();
      expect(result.value.utmCampaign).toBeNull();
    }
  });

  // --- Channel derivation tests ---

  it('derives "paid" channel from cpc/ppc medium', () => {
    expect(deriveChannel({ utmMedium: 'cpc' }, null)).toBe('paid');
    expect(deriveChannel({ utmMedium: 'ppc' }, null)).toBe('paid');
    expect(deriveChannel({ utmMedium: 'paid' }, null)).toBe('paid');
  });

  it('derives "social" channel from social platform sources', () => {
    expect(deriveChannel({ utmSource: 'facebook' }, null)).toBe('social');
    expect(deriveChannel({ utmSource: 'instagram' }, null)).toBe('social');
    expect(deriveChannel({ utmSource: 'tiktok' }, null)).toBe('social');
    expect(deriveChannel({ utmSource: 'snapchat' }, null)).toBe('social');
    expect(deriveChannel({ utmMedium: 'social' }, null)).toBe('social');
  });

  it('derives "referral" from referrer when no UTM', () => {
    expect(deriveChannel(undefined, 'https://some-blog.com/article')).toBe('referral');
  });

  it('derives "organic" from non-social UTM source', () => {
    expect(deriveChannel({ utmSource: 'google', utmMedium: 'organic' }, null)).toBe('organic');
    expect(deriveChannel({ utmSource: 'bing' }, null)).toBe('organic');
  });

  it('rejects capture without sessionId', () => {
    const result = validateCapture({ sessionId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('SESSION_REQUIRED');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GROW-072 — Campaigns + Contribution Margin
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-GROW-072 · Campaigns & Contribution Margin', () => {
  const baseCampaign = {
    name: 'حملة تبييض الأسنان',
    platform: 'Google Ads',
    utmCampaign: 'summer-teeth-2026',
    budget: 5000,
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-08-31'),
    actorId: 'admin-001',
    actorRole: 'zamo_admin' as RoleCode,
  };

  // --- Test 5: ربط حملة بعيادة وخدمة ---

  it('creates a campaign linked to a facility and service', () => {
    const result = validateCreateCampaign({
      ...baseCampaign,
      facilityId: 'fac-001',
      serviceId: 'svc-001',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('حملة تبييض الأسنان');
      expect(result.value.facilityId).toBe('fac-001');
      expect(result.value.serviceId).toBe('svc-001');
      expect(result.value.utmCampaign).toBe('summer-teeth-2026');
    }
  });

  // --- Test 6: القمع كامل: حجوزات ← حضور ← خدمات ← إيراد ← عمولة ---

  it('computes the full funnel correctly', () => {
    // Simulating a campaign with:
    //   budget = 5000 SAR
    //   20 bookings → 15 attended → 12 services done → 10000 revenue → 1000 commission
    const result = computeContributionMargin(
      5000,   // budget
      10000,  // totalRevenue (collected)
      1000,   // totalCommission
      12,     // completedServices
    );

    // هامش المساهمة = 10000 - 5000 - 1000 = 4000
    expect(result.contributionMargin).toBe(4000);

    // costPerCompletedService = 5000 / 12 ≈ 416.67
    expect(result.costPerCompletedService).toBeCloseTo(416.67, 1);
  });

  // --- Test 7: ❗ تكلفة الخدمة المكتملة وهامش المساهمة محسوبان ---

  it('computes cost-per-completed-service and contribution margin correctly', () => {
    // Edge case: no completed services
    const noServices = computeContributionMargin(5000, 0, 0, 0);
    expect(noServices.costPerCompletedService).toBeNull();
    expect(noServices.contributionMargin).toBe(-5000); // loss = -budget

    // Normal case
    const normal = computeContributionMargin(2000, 8000, 800, 10);
    expect(normal.costPerCompletedService).toBe(200); // 2000/10
    expect(normal.contributionMargin).toBe(5200); // 8000 - 2000 - 800

    // Break-even
    const breakEven = computeContributionMargin(3000, 4000, 1000, 5);
    expect(breakEven.contributionMargin).toBe(0); // 4000 - 3000 - 1000
    expect(breakEven.costPerCompletedService).toBe(600); // 3000/5
  });

  // --- Access control ---

  it('rejects campaign creation by non-zamo roles', () => {
    const result = validateCreateCampaign({
      ...baseCampaign,
      actorRole: 'facility_manager' as RoleCode,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('NOT_AUTHORIZED');
    }
  });

  it('allows zamo_ops to manage campaigns', () => {
    expect(canManageCampaigns('zamo_ops' as RoleCode)).toBe(true);
    expect(canManageCampaigns('facility_manager' as RoleCode)).toBe(false);
  });

  // --- Validation ---

  it('rejects campaign with empty name', () => {
    const result = validateCreateCampaign({ ...baseCampaign, name: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('NAME_REQUIRED');
  });

  it('rejects campaign with negative budget', () => {
    const result = validateCreateCampaign({ ...baseCampaign, budget: -100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('BUDGET_NEGATIVE');
  });

  it('rejects campaign with invalid date range', () => {
    const result = validateCreateCampaign({
      ...baseCampaign,
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-08-01'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_DATES');
  });

  // --- Status transitions ---

  it('allows valid status transitions', () => {
    expect(validateStatusTransition('draft', 'active', 'zamo_admin' as RoleCode).ok).toBe(true);
    expect(validateStatusTransition('active', 'paused', 'zamo_admin' as RoleCode).ok).toBe(true);
    expect(validateStatusTransition('active', 'ended', 'zamo_admin' as RoleCode).ok).toBe(true);
    expect(validateStatusTransition('paused', 'active', 'zamo_admin' as RoleCode).ok).toBe(true);
    expect(validateStatusTransition('paused', 'ended', 'zamo_admin' as RoleCode).ok).toBe(true);
  });

  it('rejects invalid status transitions', () => {
    const result = validateStatusTransition('ended', 'active', 'zamo_admin' as RoleCode);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_STATUS_TRANSITION');
  });
});
