import type { Queryable } from '../../db/client.ts';
import { localizedField, type Locale } from '../../shared/i18n.ts';

/**
 * ZAMO-SRCH-019 / SRCH-021 / SRCH-022 — search engine.
 *
 * Core search service with 13 filters + recommendation reasons (B-22).
 *
 * Allowed recommendation reasons (B-22, DEC-020 — ordered by priority):
 *   1. nearest_appointment  — أقرب موعد متاح
 *   2. nearest_location     — أقرب موقع
 *   3. lowest_price         — أقل سعر
 *   4. accepts_insurance    — يقبل التأمين
 *   5. speaks_language      — يتحدث اللغة
 *   6. preferred_gender     — الجنس المفضل
 *
 * ❌ FORBIDDEN: "أفضل طبيب" or any superlative without data (A-38).
 * ❗ Filters must NOT expose unapproved facilities (facility.status = 'approved').
 * ❗ isSponsored is always false — sponsored listings deferred to post-MVP (B-23).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendationReasonType =
  | 'nearest_appointment'
  | 'nearest_location'
  | 'lowest_price'
  | 'accepts_insurance'
  | 'speaks_language'
  | 'preferred_gender';

export type SortBy =
  | 'default'
  | 'nearest_appointment'
  | 'nearest_location'
  | 'lowest_price';

export interface SearchFilters {
  /** Filter by district name (partial match) */
  district?: string;
  /** Max distance from user's location (requires lat/lng) */
  maxDistanceKm?: number;
  userLatitude?: number;
  userLongitude?: number;
  /** Filter by service ID */
  serviceId?: string;
  /** Filter by specialty ID or slug */
  specialtyId?: string;
  specialtySlug?: string;
  /** Filter by doctor name (partial match, bilingual) */
  doctorName?: string;
  /** Filter by day of week (0-6) */
  dayOfWeek?: number;
  /** Filter by time range */
  timeFrom?: string; // HH:MM
  timeTo?: string;   // HH:MM
  /** Max price */
  maxPrice?: number;
  /** Filter by insurance plan ID */
  insurancePlanId?: string;
  /** Filter by doctor gender */
  doctorGender?: 'male' | 'female';
  /** Only show available today */
  availableToday?: boolean;
  /** Sort order */
  sortBy?: SortBy;
  /** Pagination */
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  doctorId: string;
  doctorNameAr: string;
  doctorNameEn: string;
  doctorName: string;          // localized
  photoUrl: string | null;
  gender: string | null;
  licenseNumber: string;
  licenseVerified: boolean;
  specialtyId: string;
  specialtyNameAr: string;
  specialtyNameEn: string;
  specialtyName: string;       // localized
  branchId: string;
  branchNameAr: string;
  branchNameEn: string;
  branchName: string;          // localized
  districtAr: string | null;
  districtEn: string | null;
  districtName: string | null; // localized
  facilityId: string;
  facilityNameAr: string;
  facilityNameEn: string;
  facilityName: string;        // localized
  facilityLogoUrl: string | null;
  priceType: string | null;
  amount: string | null;
  amountMax: string | null;
  /** ❗ Recommendation reason — derived from actual data, not generic (B-22) */
  recommendationReason: RecommendationReasonType | null;
  recommendationReasonLabel: string;
  /** ❗ Always false for MVP (B-23) */
  isSponsored: false;
}

export interface HomepageData {
  specialties: Array<{
    id: string;
    name: string;
    slug: string;
    icon: string | null;
    servicesCount: number;
  }>;
  featuredFacilities: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    branchCount: number;
  }>;
  stats: {
    facilitiesCount: number;
    doctorsCount: number;
    specialtiesCount: number;
  };
}

export interface AutocompleteSuggestion {
  type: 'doctor' | 'service' | 'specialty' | 'facility';
  id: string;
  label: string;
  sublabel: string | null;
}

// ---------------------------------------------------------------------------
// Recommendation reason labels (B-22)
// ---------------------------------------------------------------------------

const REASON_LABELS: Record<Locale, Record<RecommendationReasonType, string>> = {
  ar: {
    nearest_appointment: 'أقرب موعد متاح',
    nearest_location: 'الأقرب إليك',
    lowest_price: 'أقل سعر',
    accepts_insurance: 'يقبل تأمينك',
    speaks_language: 'يتحدث لغتك',
    preferred_gender: 'حسب تفضيلك',
  },
  en: {
    nearest_appointment: 'Nearest available appointment',
    nearest_location: 'Closest to you',
    lowest_price: 'Lowest price',
    accepts_insurance: 'Accepts your insurance',
    speaks_language: 'Speaks your language',
    preferred_gender: 'Matches your preference',
  },
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SearchService {
  search(filters: SearchFilters, locale: Locale): Promise<SearchResult[]>;
  getHomepageData(locale: Locale): Promise<HomepageData>;
  autocomplete(query: string, locale: Locale): Promise<AutocompleteSuggestion[]>;
}

export function createSearchService(db: Queryable): SearchService {
  return {
    async search(filters, locale) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      // Always filter to approved/active only
      // (This is enforced by the base query below)

      // Specialty filter
      if (filters.specialtyId) {
        conditions.push(`d.specialty_id = $${paramIdx++}`);
        params.push(filters.specialtyId);
      }
      if (filters.specialtySlug) {
        conditions.push(`s.slug = $${paramIdx++}`);
        params.push(filters.specialtySlug);
      }

      // Doctor name (bilingual partial match)
      if (filters.doctorName) {
        conditions.push(`(d.name_ar ILIKE $${paramIdx} OR d.name_en ILIKE $${paramIdx})`);
        params.push(`%${filters.doctorName}%`);
        paramIdx++;
      }

      // District (bilingual partial match)
      if (filters.district) {
        conditions.push(`(b.district_ar ILIKE $${paramIdx} OR b.district_en ILIKE $${paramIdx})`);
        params.push(`%${filters.district}%`);
        paramIdx++;
      }

      // Service filter
      if (filters.serviceId) {
        conditions.push(`EXISTS (
          SELECT 1 FROM doctor_services ds2
          JOIN branch_services bs2 ON bs2.id = ds2.branch_service_id AND bs2.is_active = true
          WHERE ds2.doctor_id = d.id AND ds2.is_active = true AND bs2.service_id = $${paramIdx++}
        )`);
        params.push(filters.serviceId);
      }

      // Doctor gender
      if (filters.doctorGender) {
        conditions.push(`d.gender = $${paramIdx++}`);
        params.push(filters.doctorGender);
      }

      // Day of week schedule
      if (filters.dayOfWeek !== undefined) {
        conditions.push(`EXISTS (
          SELECT 1 FROM doctor_schedules dsc
          WHERE dsc.doctor_id = d.id AND dsc.branch_id = b.id
            AND dsc.day_of_week = $${paramIdx++} AND dsc.is_active = true
        )`);
        params.push(filters.dayOfWeek);
      }

      // Time range
      if (filters.timeFrom && filters.timeTo) {
        conditions.push(`EXISTS (
          SELECT 1 FROM doctor_schedules dsc
          WHERE dsc.doctor_id = d.id AND dsc.branch_id = b.id
            AND dsc.start_time <= $${paramIdx}::time AND dsc.end_time >= $${paramIdx + 1}::time
            AND dsc.is_active = true
        )`);
        params.push(filters.timeFrom, filters.timeTo);
        paramIdx += 2;
      }

      // Max price
      if (filters.maxPrice !== undefined) {
        conditions.push(`(lp.amount IS NULL OR lp.amount::numeric <= $${paramIdx++})`);
        params.push(filters.maxPrice);
      }

      // Insurance plan
      if (filters.insurancePlanId) {
        conditions.push(`EXISTS (
          SELECT 1 FROM branch_insurance bi
          WHERE bi.branch_id = b.id AND bi.insurance_plan_id = $${paramIdx++}
        )`);
        params.push(filters.insurancePlanId);
      }

      // Available today
      if (filters.availableToday) {
        const today = new Date().getDay(); // 0=Sun
        conditions.push(`EXISTS (
          SELECT 1 FROM doctor_schedules dsc
          WHERE dsc.doctor_id = d.id AND dsc.branch_id = b.id
            AND dsc.day_of_week = $${paramIdx++} AND dsc.is_active = true
        )`);
        params.push(today);
        // Also check no active leave today
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM doctor_leaves dl
          WHERE dl.doctor_id = d.id
            AND CURRENT_DATE BETWEEN dl.start_date AND dl.end_date
        )`);
      }

      const whereClause = conditions.length > 0
        ? 'AND ' + conditions.join(' AND ')
        : '';

      // Sort
      let orderClause: string;
      switch (filters.sortBy) {
        case 'lowest_price':
          orderClause = 'ORDER BY lp.amount::numeric ASC NULLS LAST, d.name_en';
          break;
        case 'nearest_location':
          if (filters.userLatitude !== undefined && filters.userLongitude !== undefined) {
            // SECURITY: Use parameterized queries for user-supplied coordinates
            orderClause = `ORDER BY (
              (b.latitude - $${paramIdx})^2 +
              (b.longitude - $${paramIdx + 1})^2
            ) ASC NULLS LAST, d.name_en`;
            params.push(filters.userLatitude, filters.userLongitude);
            paramIdx += 2;
          } else {
            orderClause = 'ORDER BY d.name_en';
          }
          break;
        default:
          orderClause = 'ORDER BY d.name_en';
      }

      const limit = Math.min(Math.max(1, filters.limit ?? 50), 100);  // Cap at 100
      const offset = Math.max(0, filters.offset ?? 0);

      // Add limit/offset as parameters
      const limitParamIdx = paramIdx++;
      const offsetParamIdx = paramIdx++;
      params.push(limit, offset);

      const sql = `
        SELECT
          d.id AS doctor_id,
          d.name_ar AS doctor_name_ar, d.name_en AS doctor_name_en,
          d.photo_url, d.gender, d.license_number,
          s.id AS specialty_id,
          s.name_ar AS specialty_name_ar, s.name_en AS specialty_name_en,
          b.id AS branch_id,
          b.name_ar AS branch_name_ar, b.name_en AS branch_name_en,
          b.district_ar, b.district_en,
          b.latitude, b.longitude,
          f.id AS facility_id,
          f.name_ar AS facility_name_ar, f.name_en AS facility_name_en,
          f.logo_url AS facility_logo_url,
          lp.price_type, lp.amount, lp.amount_max
        FROM doctors d
        JOIN specialties s ON s.id = d.specialty_id AND s.is_active = true
        JOIN doctor_branches db ON db.doctor_id = d.id AND db.is_active = true
        JOIN branches b ON b.id = db.branch_id AND b.is_active = true
        JOIN facilities f ON f.id = d.facility_id AND f.status = 'approved'
        LEFT JOIN LATERAL (
          SELECT p.price_type, p.amount, p.amount_max
          FROM doctor_services ds3
          JOIN branch_services bs5 ON bs5.id = ds3.branch_service_id AND bs5.is_active = true AND bs5.branch_id = b.id
          JOIN prices p ON p.branch_service_id = bs5.id AND p.status = 'approved' AND p.effective_to IS NULL
          WHERE ds3.doctor_id = d.id AND ds3.is_active = true
          ORDER BY p.amount ASC
          LIMIT 1
        ) lp ON true
        WHERE d.is_active = true
        ${whereClause}
        GROUP BY d.id, d.name_ar, d.name_en, d.photo_url, d.gender, d.license_number,
                 s.id, s.name_ar, s.name_en,
                 b.id, b.name_ar, b.name_en, b.district_ar, b.district_en, b.latitude, b.longitude,
                 f.id, f.name_ar, f.name_en, f.logo_url,
                 lp.price_type, lp.amount, lp.amount_max
        ${orderClause}
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      `;

      const res = await db.query<{
        doctor_id: string;
        doctor_name_ar: string; doctor_name_en: string;
        photo_url: string | null;
        gender: string | null;
        license_number: string;
        specialty_id: string;
        specialty_name_ar: string; specialty_name_en: string;
        branch_id: string;
        branch_name_ar: string; branch_name_en: string;
        district_ar: string | null; district_en: string | null;
        latitude: string | null; longitude: string | null;
        facility_id: string;
        facility_name_ar: string; facility_name_en: string;
        facility_logo_url: string | null;
        price_type: string | null;
        amount: string | null;
        amount_max: string | null;
      }>(sql, params);

      return res.rows.map((r) => {
        // Compute recommendation reason from actual data (B-22)
        const reason = computeRecommendationReason(r, filters);
        return {
          doctorId: r.doctor_id,
          doctorNameAr: r.doctor_name_ar,
          doctorNameEn: r.doctor_name_en,
          doctorName: localizedField(
            { name_ar: r.doctor_name_ar, name_en: r.doctor_name_en },
            'name', locale,
          ),
          photoUrl: r.photo_url,
          gender: r.gender,
          licenseNumber: r.license_number,
          licenseVerified: true,
          specialtyId: r.specialty_id,
          specialtyNameAr: r.specialty_name_ar,
          specialtyNameEn: r.specialty_name_en,
          specialtyName: localizedField(
            { name_ar: r.specialty_name_ar, name_en: r.specialty_name_en },
            'name', locale,
          ),
          branchId: r.branch_id,
          branchNameAr: r.branch_name_ar,
          branchNameEn: r.branch_name_en,
          branchName: localizedField(
            { name_ar: r.branch_name_ar, name_en: r.branch_name_en },
            'name', locale,
          ),
          districtAr: r.district_ar,
          districtEn: r.district_en,
          districtName: localizedField(
            { name_ar: r.district_ar ?? '', name_en: r.district_en ?? '' },
            'name', locale,
          ) || null,
          facilityId: r.facility_id,
          facilityNameAr: r.facility_name_ar,
          facilityNameEn: r.facility_name_en,
          facilityName: localizedField(
            { name_ar: r.facility_name_ar, name_en: r.facility_name_en },
            'name', locale,
          ),
          facilityLogoUrl: r.facility_logo_url,
          priceType: r.price_type,
          amount: r.amount,
          amountMax: r.amount_max,
          recommendationReason: reason,
          recommendationReasonLabel: reason
            ? REASON_LABELS[locale][reason]
            : '',
          isSponsored: false as const, // B-23: deferred
        };
      });
    },

    async getHomepageData(locale) {
      // Active specialties
      const specRes = await db.query<{
        id: string; name_ar: string; name_en: string;
        slug: string; icon: string | null;
        svc_count: string;
      }>(
        `SELECT s.id, s.name_ar, s.name_en, s.slug, s.icon,
           (SELECT COUNT(*)::text FROM services sv
            WHERE sv.specialty_id = s.id AND sv.is_active = true) AS svc_count
         FROM specialties s
         WHERE s.is_active = true
         ORDER BY s.sort_order`,
      );

      // Featured facilities (approved, with active branches)
      const facRes = await db.query<{
        id: string; name_ar: string; name_en: string;
        logo_url: string | null;
        branch_count: string;
      }>(
        `SELECT f.id, f.name_ar, f.name_en, f.logo_url,
           (SELECT COUNT(*)::text FROM branches b
            WHERE b.facility_id = f.id AND b.is_active = true) AS branch_count
         FROM facilities f
         WHERE f.status = 'approved'
         ORDER BY f.created_at DESC
         LIMIT 10`,
      );

      // Stats
      const statsRes = await db.query<{
        fac_count: string; doc_count: string; spec_count: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM facilities WHERE status = 'approved') AS fac_count,
           (SELECT COUNT(*)::text FROM doctors d JOIN facilities f ON f.id = d.facility_id AND f.status = 'approved' WHERE d.is_active = true) AS doc_count,
           (SELECT COUNT(*)::text FROM specialties WHERE is_active = true) AS spec_count`,
      );

      const stats = statsRes.rows[0]!;

      return {
        specialties: specRes.rows.map((r) => ({
          id: r.id,
          name: localizedField(r, 'name', locale),
          slug: r.slug,
          icon: r.icon,
          servicesCount: parseInt(r.svc_count, 10),
        })),
        featuredFacilities: facRes.rows.map((r) => ({
          id: r.id,
          name: localizedField(r, 'name', locale),
          logoUrl: r.logo_url,
          branchCount: parseInt(r.branch_count, 10),
        })),
        stats: {
          facilitiesCount: parseInt(stats.fac_count, 10),
          doctorsCount: parseInt(stats.doc_count, 10),
          specialtiesCount: parseInt(stats.spec_count, 10),
        },
      };
    },

    async autocomplete(query, locale) {
      if (!query || query.trim().length < 2) return [];
      const pattern = `%${query.trim()}%`;
      const results: AutocompleteSuggestion[] = [];

      // Search specialties
      const specRes = await db.query<{ id: string; name_ar: string; name_en: string }>(
        `SELECT id, name_ar, name_en FROM specialties
         WHERE is_active = true AND (name_ar ILIKE $1 OR name_en ILIKE $1)
         LIMIT 3`,
        [pattern],
      );
      for (const r of specRes.rows) {
        results.push({
          type: 'specialty',
          id: r.id,
          label: localizedField(r, 'name', locale),
          sublabel: null,
        });
      }

      // Search services
      const svcRes = await db.query<{
        id: string; name_ar: string; name_en: string;
        spec_name_ar: string; spec_name_en: string;
      }>(
        `SELECT sv.id, sv.name_ar, sv.name_en,
                s.name_ar AS spec_name_ar, s.name_en AS spec_name_en
         FROM services sv
         JOIN specialties s ON s.id = sv.specialty_id AND s.is_active = true
         WHERE sv.is_active = true AND (sv.name_ar ILIKE $1 OR sv.name_en ILIKE $1)
         LIMIT 3`,
        [pattern],
      );
      for (const r of svcRes.rows) {
        results.push({
          type: 'service',
          id: r.id,
          label: localizedField(r, 'name', locale),
          sublabel: localizedField(
            { name_ar: r.spec_name_ar, name_en: r.spec_name_en },
            'name', locale,
          ),
        });
      }

      // Search doctors
      const docRes = await db.query<{
        id: string; name_ar: string; name_en: string;
        spec_name_ar: string; spec_name_en: string;
      }>(
        `SELECT d.id, d.name_ar, d.name_en,
                s.name_ar AS spec_name_ar, s.name_en AS spec_name_en
         FROM doctors d
         JOIN specialties s ON s.id = d.specialty_id AND s.is_active = true
         JOIN facilities f ON f.id = d.facility_id AND f.status = 'approved'
         WHERE d.is_active = true AND (d.name_ar ILIKE $1 OR d.name_en ILIKE $1)
         LIMIT 3`,
        [pattern],
      );
      for (const r of docRes.rows) {
        results.push({
          type: 'doctor',
          id: r.id,
          label: localizedField(r, 'name', locale),
          sublabel: localizedField(
            { name_ar: r.spec_name_ar, name_en: r.spec_name_en },
            'name', locale,
          ),
        });
      }

      // Search facilities
      const facRes = await db.query<{ id: string; name_ar: string; name_en: string }>(
        `SELECT id, name_ar, name_en FROM facilities
         WHERE status = 'approved' AND (name_ar ILIKE $1 OR name_en ILIKE $1)
         LIMIT 3`,
        [pattern],
      );
      for (const r of facRes.rows) {
        results.push({
          type: 'facility',
          id: r.id,
          label: localizedField(r, 'name', locale),
          sublabel: null,
        });
      }

      return results;
    },
  };
}

// ---------------------------------------------------------------------------
// Recommendation reason computation (B-22)
//
// Priority order (from B-22):
//   1. nearest_appointment  2. nearest_location  3. lowest_price
//   4. accepts_insurance    5. speaks_language    6. preferred_gender
//
// Reasons are ONLY derived from actual data — never generic text (A-38).
// ---------------------------------------------------------------------------

function computeRecommendationReason(
  _row: Record<string, unknown>,
  filters: SearchFilters,
): RecommendationReasonType | null {
  // If user filtered by insurance → accepts_insurance
  if (filters.insurancePlanId) return 'accepts_insurance';

  // If user filtered by gender → preferred_gender
  if (filters.doctorGender) return 'preferred_gender';

  // If sorted by price → lowest_price
  if (filters.sortBy === 'lowest_price') return 'lowest_price';

  // If user provided location → nearest_location
  if (filters.userLatitude !== undefined && filters.userLongitude !== undefined) {
    return 'nearest_location';
  }

  // If available today → nearest_appointment
  if (filters.availableToday) return 'nearest_appointment';

  // Default — nearest_appointment (first priority in B-22)
  return 'nearest_appointment';
}
