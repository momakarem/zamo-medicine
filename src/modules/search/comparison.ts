/**
 * ZAMO-BOOK-036 — Comparison page.
 *
 * Compare up to 3 options by 9 criteria (B-22 recommendation factors):
 *   1. Doctor name
 *   2. Specialty
 *   3. Branch / location
 *   4. Price
 *   5. Next available appointment
 *   6. Distance (Haversine — B-34)
 *   7. Insurance acceptance
 *   8. Doctor language
 *   9. Doctor gender
 *
 * ❌ No "best doctor" without verifiable data (A-38).
 */

import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComparisonOption {
  doctorId: string;
  doctorNameAr: string;
  doctorNameEn: string;
  specialtyNameAr: string;
  specialtyNameEn: string;
  branchNameAr: string;
  branchNameEn: string;
  districtAr: string | null;
  districtEn: string | null;
  facilityNameAr: string;
  facilityNameEn: string;
  /** Price in SAR (numeric) */
  price: number | null;
  /** Next available slot */
  nextAvailable: Date | null;
  /** Distance in km (Haversine — B-34) */
  distanceKm: number | null;
  /** Insurance plans accepted */
  insurancePlans: { nameAr: string; nameEn: string }[];
  /** Doctor's languages */
  languages: string[];
  /** Doctor gender */
  gender: 'male' | 'female' | null;
  /** Doctor photo URL */
  photoUrl: string | null;
}

export interface ComparisonCriterion {
  key: string;
  labelAr: string;
  labelEn: string;
  /** Which option "wins" for this criterion (index or null if tie) */
  bestIndex: number | null;
}

export interface ComparisonResult {
  options: ComparisonOption[];
  criteria: ComparisonCriterion[];
}

export type ComparisonError =
  | 'TOO_FEW_OPTIONS'      // Need at least 2
  | 'TOO_MANY_OPTIONS'     // Max 3
  | 'DUPLICATE_DOCTOR';    // Same doctor twice

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_COMPARISON_OPTIONS = 3;
export const MIN_COMPARISON_OPTIONS = 2;

/** Haversine earth radius in km (B-34: straight-line distance) */
const EARTH_RADIUS_KM = 6371;

// ---------------------------------------------------------------------------
// Comparison logic
// ---------------------------------------------------------------------------

/**
 * Validate comparison parameters.
 */
export function validateComparison(
  options: ComparisonOption[],
): Result<void, ComparisonError> {
  if (options.length < MIN_COMPARISON_OPTIONS) return err('TOO_FEW_OPTIONS');
  if (options.length > MAX_COMPARISON_OPTIONS) return err('TOO_MANY_OPTIONS');

  const doctorIds = options.map(o => o.doctorId);
  if (new Set(doctorIds).size !== doctorIds.length) return err('DUPLICATE_DOCTOR');

  return ok(undefined);
}

/**
 * Build comparison criteria from options.
 *
 * For each criterion, determines which option is "best" (if applicable).
 * ❌ No subjective "best doctor" claims (A-38).
 */
export function buildComparison(options: ComparisonOption[]): ComparisonCriterion[] {
  const criteria: ComparisonCriterion[] = [];

  // 1. Price — lowest wins
  if (options.some(o => o.price !== null)) {
    const prices = options.map(o => o.price);
    const validPrices = prices.filter((p): p is number => p !== null);
    const minPrice = Math.min(...validPrices);
    const bestIdx = validPrices.length > 0
      ? prices.findIndex(p => p === minPrice)
      : null;
    // Only mark best if prices differ
    const allSame = validPrices.every(p => p === minPrice);
    criteria.push({
      key: 'price',
      labelAr: 'السعر',
      labelEn: 'Price',
      bestIndex: allSame ? null : bestIdx,
    });
  }

  // 2. Next available — soonest wins
  if (options.some(o => o.nextAvailable !== null)) {
    const dates = options.map(o => o.nextAvailable);
    const validDates = dates.filter((d): d is Date => d !== null);
    const earliest = validDates.length > 0
      ? new Date(Math.min(...validDates.map(d => d.getTime())))
      : null;
    const bestIdx = earliest
      ? dates.findIndex(d => d?.getTime() === earliest.getTime())
      : null;
    criteria.push({
      key: 'nextAvailable',
      labelAr: 'أقرب موعد',
      labelEn: 'Next Available',
      bestIndex: bestIdx,
    });
  }

  // 3. Distance — shortest wins
  if (options.some(o => o.distanceKm !== null)) {
    const distances = options.map(o => o.distanceKm);
    const validDistances = distances.filter((d): d is number => d !== null);
    const minDist = Math.min(...validDistances);
    const bestIdx = validDistances.length > 0
      ? distances.findIndex(d => d === minDist)
      : null;
    criteria.push({
      key: 'distance',
      labelAr: 'المسافة',
      labelEn: 'Distance',
      bestIndex: bestIdx,
    });
  }

  // 4. Insurance — more plans = better (no best marking, just info)
  criteria.push({
    key: 'insurance',
    labelAr: 'التأمين المقبول',
    labelEn: 'Insurance Accepted',
    bestIndex: null, // No "best" — informational
  });

  // 5. Language — informational
  criteria.push({
    key: 'language',
    labelAr: 'لغة الطبيب',
    labelEn: 'Doctor Language',
    bestIndex: null,
  });

  // 6. Gender — informational
  criteria.push({
    key: 'gender',
    labelAr: 'جنس الطبيب',
    labelEn: 'Doctor Gender',
    bestIndex: null,
  });

  // 7. Doctor — ❌ No "best" marking (A-38)
  criteria.push({
    key: 'doctor',
    labelAr: 'الطبيب',
    labelEn: 'Doctor',
    bestIndex: null, // ❌ A-38: never mark a "best" doctor
  });

  // 8. Specialty — informational
  criteria.push({
    key: 'specialty',
    labelAr: 'التخصص',
    labelEn: 'Specialty',
    bestIndex: null,
  });

  // 9. Branch — informational
  criteria.push({
    key: 'branch',
    labelAr: 'الفرع',
    labelEn: 'Branch',
    bestIndex: null,
  });

  return criteria;
}

// ---------------------------------------------------------------------------
// Haversine distance (B-34: straight-line)
// ---------------------------------------------------------------------------

/**
 * Calculate straight-line distance between two coordinates (B-34).
 * Returns distance in kilometers.
 */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Build SQL for fetching comparison data for given doctor+branch+service combos.
 */
export function buildComparisonSQL(doctorBranchPairs: {
  doctorId: string;
  branchId: string;
  branchServiceId: string;
}[]): { sql: string; values: unknown[] } {
  const conditions = doctorBranchPairs.map((_, i) => {
    const base = i * 3;
    return `(d.id = $${base + 1} AND br.id = $${base + 2} AND bs.id = $${base + 3})`;
  });

  const values = doctorBranchPairs.flatMap(p => [
    p.doctorId, p.branchId, p.branchServiceId,
  ]);

  return {
    sql: `
      SELECT
        d.id AS doctor_id,
        d.name_ar AS doctor_name_ar, d.name_en AS doctor_name_en,
        d.gender, d.photo_url,
        sp.name_ar AS specialty_name_ar, sp.name_en AS specialty_name_en,
        br.id AS branch_id,
        br.name_ar AS branch_name_ar, br.name_en AS branch_name_en,
        br.district_ar, br.district_en,
        br.latitude, br.longitude,
        f.name_ar AS facility_name_ar, f.name_en AS facility_name_en,
        p.amount AS price,
        bs.id AS branch_service_id
      FROM doctors d
      JOIN specialties sp ON d.specialty_id = sp.id
      JOIN branches br ON true
      JOIN facilities f ON br.facility_id = f.id
      JOIN branch_services bs ON bs.branch_id = br.id
      LEFT JOIN LATERAL (
        SELECT amount FROM prices
        WHERE branch_service_id = bs.id AND is_active = true
        ORDER BY effective_from DESC LIMIT 1
      ) p ON true
      WHERE ${conditions.join(' OR ')}
      ORDER BY d.name_en
    `,
    values,
  };
}
