/**
 * ZAMO-BOOK-036 — Comparison page unit tests.
 */
import { describe, it, expect } from 'vitest';
import {
  validateComparison,
  buildComparison,
  haversineDistance,
  type ComparisonOption,
} from './comparison.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOption(overrides: Partial<ComparisonOption> = {}): ComparisonOption {
  return {
    doctorId: `doc-${Math.random().toString(36).slice(2, 6)}`,
    doctorNameAr: 'د. أحمد',
    doctorNameEn: 'Dr. Ahmad',
    specialtyNameAr: 'أسنان',
    specialtyNameEn: 'Dentistry',
    branchNameAr: 'فرع الملقا',
    branchNameEn: 'Malqa Branch',
    districtAr: 'الملقا',
    districtEn: 'Malqa',
    facilityNameAr: 'عيادات النخبة',
    facilityNameEn: 'Elite Clinics',
    price: 200,
    nextAvailable: new Date('2026-09-20T09:00:00Z'),
    distanceKm: 5.2,
    insurancePlans: [{ nameAr: 'بوبا', nameEn: 'Bupa' }],
    languages: ['ar', 'en'],
    gender: 'male',
    photoUrl: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateComparison
// ---------------------------------------------------------------------------
describe('validateComparison', () => {
  it('accepts 2 options', () => {
    const result = validateComparison([makeOption(), makeOption()]);
    expect(result.ok).toBe(true);
  });

  it('accepts 3 options', () => {
    const result = validateComparison([makeOption(), makeOption(), makeOption()]);
    expect(result.ok).toBe(true);
  });

  it('rejects 1 option (too few)', () => {
    const result = validateComparison([makeOption()]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('TOO_FEW_OPTIONS');
  });

  it('rejects 4 options (too many)', () => {
    const result = validateComparison([
      makeOption(), makeOption(), makeOption(), makeOption(),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('TOO_MANY_OPTIONS');
  });

  it('rejects duplicate doctors', () => {
    const opt = makeOption({ doctorId: 'doc-same' });
    const result = validateComparison([opt, { ...opt }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('DUPLICATE_DOCTOR');
  });
});

// ---------------------------------------------------------------------------
// buildComparison
// ---------------------------------------------------------------------------
describe('buildComparison', () => {
  it('produces 9 criteria', () => {
    const criteria = buildComparison([
      makeOption({ price: 200, distanceKm: 5 }),
      makeOption({ price: 150, distanceKm: 10 }),
    ]);
    expect(criteria).toHaveLength(9);
  });

  it('marks cheapest option as best for price', () => {
    const criteria = buildComparison([
      makeOption({ price: 200 }),
      makeOption({ price: 150 }),
    ]);
    const priceCrit = criteria.find(c => c.key === 'price');
    expect(priceCrit).toBeDefined();
    expect(priceCrit!.bestIndex).toBe(1); // Second option is cheaper
  });

  it('marks soonest option as best for next available', () => {
    const criteria = buildComparison([
      makeOption({ nextAvailable: new Date('2026-09-22T09:00:00Z') }),
      makeOption({ nextAvailable: new Date('2026-09-20T09:00:00Z') }),
    ]);
    const dateCrit = criteria.find(c => c.key === 'nextAvailable');
    expect(dateCrit!.bestIndex).toBe(1);
  });

  it('marks closest option as best for distance', () => {
    const criteria = buildComparison([
      makeOption({ distanceKm: 10 }),
      makeOption({ distanceKm: 3 }),
    ]);
    const distCrit = criteria.find(c => c.key === 'distance');
    expect(distCrit!.bestIndex).toBe(1);
  });

  it('❌ NEVER marks a "best doctor" (A-38)', () => {
    const criteria = buildComparison([makeOption(), makeOption()]);
    const doctorCrit = criteria.find(c => c.key === 'doctor');
    expect(doctorCrit).toBeDefined();
    expect(doctorCrit!.bestIndex).toBeNull();
  });

  it('price criterion is null when all prices are equal', () => {
    const criteria = buildComparison([
      makeOption({ price: 200 }),
      makeOption({ price: 200 }),
    ]);
    const priceCrit = criteria.find(c => c.key === 'price');
    expect(priceCrit!.bestIndex).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// haversineDistance
// ---------------------------------------------------------------------------
describe('haversineDistance', () => {
  it('distance between same point is 0', () => {
    const dist = haversineDistance(24.7136, 46.6753, 24.7136, 46.6753);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('Riyadh center to Malqa is ~15-20 km', () => {
    // Approximate coords
    const dist = haversineDistance(24.6877, 46.7219, 24.7989, 46.6250);
    expect(dist).toBeGreaterThan(10);
    expect(dist).toBeLessThan(25);
  });

  it('always returns positive distance', () => {
    const dist = haversineDistance(24.0, 46.0, 25.0, 47.0);
    expect(dist).toBeGreaterThan(0);
  });
});
