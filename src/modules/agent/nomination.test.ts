/**
 * ZAMO-AGENT-050 — Nomination tests.
 *
 * Tests from IMPLEMENTATION_CHECKLIST:
 *   ❗ الوكيل لا يذكر طبيبًا غير موجود في البيانات
 *   ❗ الوكيل لا يخترع سعرًا أو موعدًا
 *   سبب الترشيح يطابق البيانات
 *   المقارنة تعمل
 */

import { describe, it, expect } from 'vitest';
import {
  formatDoctorCards,
  formatCardsAsText,
  buildComparison,
  formatComparisonAsText,
  describeSearchCriteria,
} from './nomination.ts';
import type { SearchResult } from '../search/search.ts';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    doctorId: 'doc-1',
    doctorNameAr: 'د. أحمد محمد',
    doctorNameEn: 'Dr. Ahmad Mohammed',
    doctorName: 'د. أحمد محمد',
    photoUrl: null,
    gender: 'male',
    licenseNumber: 'LIC-001',
    licenseVerified: true,
    specialtyId: 'spec-1',
    specialtyNameAr: 'طب أسنان',
    specialtyNameEn: 'Dentistry',
    specialtyName: 'طب أسنان',
    branchId: 'br-1',
    branchNameAr: 'فرع الملقا',
    branchNameEn: 'Al-Malqa Branch',
    branchName: 'فرع الملقا',
    districtAr: 'الملقا',
    districtEn: 'Al-Malqa',
    districtName: 'الملقا',
    facilityId: 'fac-1',
    facilityNameAr: 'عيادات النور',
    facilityNameEn: 'Al-Noor Clinics',
    facilityName: 'عيادات النور',
    facilityLogoUrl: null,
    priceType: 'fixed',
    amount: '350',
    amountMax: null,
    recommendationReason: 'nearest_appointment',
    recommendationReasonLabel: 'أقرب موعد متاح',
    isSponsored: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatDoctorCards
// ---------------------------------------------------------------------------

describe('formatDoctorCards', () => {
  it('formats search results as cards in Arabic', () => {
    const results = [makeSearchResult()];
    const cards = formatDoctorCards(results, 'ar');

    expect(cards).toHaveLength(1);
    expect(cards[0].doctorName).toBe('د. أحمد محمد');
    expect(cards[0].specialtyName).toBe('طب أسنان');
    expect(cards[0].price).toBe('350');
    expect(cards[0].recommendationReason).toBe('nearest_appointment');
  });

  it('formats search results as cards in English', () => {
    const results = [makeSearchResult()];
    const cards = formatDoctorCards(results, 'en');

    expect(cards[0].doctorName).toBe('Dr. Ahmad Mohammed');
    expect(cards[0].specialtyName).toBe('Dentistry');
  });

  it('only includes data from search results — no hallucination', () => {
    const result = makeSearchResult({ amount: null, recommendationReason: null });
    const cards = formatDoctorCards([result], 'ar');

    expect(cards[0].price).toBeNull();
    expect(cards[0].recommendationReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatCardsAsText
// ---------------------------------------------------------------------------

describe('formatCardsAsText', () => {
  it('includes doctor name, specialty, branch, and price', () => {
    const cards = formatDoctorCards([makeSearchResult()], 'ar');
    const text = formatCardsAsText(cards, 'ar');

    expect(text).toContain('د. أحمد محمد');
    expect(text).toContain('طب أسنان');
    expect(text).toContain('فرع الملقا');
    expect(text).toContain('350');
  });

  it('includes recommendation reason label', () => {
    const cards = formatDoctorCards([makeSearchResult()], 'ar');
    const text = formatCardsAsText(cards, 'ar');

    expect(text).toContain('أقرب موعد متاح');
    expect(text).toContain('سبب الترشيح');
  });

  it('returns "no results" message for empty cards', () => {
    const textAr = formatCardsAsText([], 'ar');
    expect(textAr).toContain('لم أجد');

    const textEn = formatCardsAsText([], 'en');
    expect(textEn).toContain('No results');
  });
});

// ---------------------------------------------------------------------------
// buildComparison
// ---------------------------------------------------------------------------

describe('buildComparison', () => {
  it('compares two doctors on price, location, facility', () => {
    const cards = formatDoctorCards([
      makeSearchResult({ doctorId: 'doc-1', amount: '350' }),
      makeSearchResult({
        doctorId: 'doc-2',
        doctorNameAr: 'د. سارة علي',
        amount: '450',
        districtAr: 'النخيل',
        districtName: 'النخيل',
        facilityNameAr: 'عيادات الشفاء',
      }),
    ], 'ar');

    const comparison = buildComparison(cards, 'ar');

    expect(comparison.doctors).toHaveLength(2);
    expect(comparison.comparisonPoints.length).toBeGreaterThanOrEqual(2);

    // Price point
    const pricePoint = comparison.comparisonPoints.find((p) => p.labelAr === 'السعر');
    expect(pricePoint).toBeDefined();
    expect(pricePoint!.values[0]).toContain('350');
    expect(pricePoint!.values[1]).toContain('450');
  });
});

// ---------------------------------------------------------------------------
// describeSearchCriteria
// ---------------------------------------------------------------------------

describe('describeSearchCriteria', () => {
  it('describes specialty and district', () => {
    const desc = describeSearchCriteria(
      { specialtySlug: 'dental', district: 'الملقا' },
      'ar',
    );
    expect(desc).toContain('dental');
    expect(desc).toContain('الملقا');
  });

  it('returns general search for empty filters', () => {
    expect(describeSearchCriteria({}, 'ar')).toBe('بحث عام');
    expect(describeSearchCriteria({}, 'en')).toBe('General search');
  });
});
