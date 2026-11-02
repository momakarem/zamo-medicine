import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { localizedField, getDayName, type Locale } from '../../shared/i18n.ts';

/**
 * ZAMO-SRCH-024 — public facility & branch profile view.
 *
 * Facility page: 12 elements [S1]
 * Branch page: 16 elements [S1] (each branch has its own page)
 *
 * ❗ No internal data exposed (commissions, financial details).
 * ❗ Only approved facilities and active branches appear.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FacilityViewError = 'FACILITY_NOT_FOUND' | 'BRANCH_NOT_FOUND';

export interface FacilityProfileView {
  id: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  verified: boolean;
  joinedAt: string;
  specialties: string[];
  branchCount: number;
  doctorCount: number;
  branches: FacilityBranchSummary[];
  insurancePlans: string[];
}

export interface FacilityBranchSummary {
  branchId: string;
  branchName: string;
  districtName: string | null;
  cityName: string;
}

export interface BranchProfileView {
  id: string;
  name: string;
  facilityId: string;
  facilityName: string;
  facilityLogoUrl: string | null;
  address: string | null;
  districtName: string | null;
  cityName: string;
  phone: string | null;
  latitude: string | null;
  longitude: string | null;
  workingHours: BranchWorkingHoursView[];
  doctors: BranchDoctorSummary[];
  services: BranchServiceSummary[];
  insurancePlans: string[];
  policies: BranchPolicyView[];
}

export interface BranchWorkingHoursView {
  dayOfWeek: number;
  dayName: string;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface BranchDoctorSummary {
  doctorId: string;
  doctorName: string;
  specialtyName: string;
  photoUrl: string | null;
}

export interface BranchServiceSummary {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  price: string | null;
  priceType: string | null;
}

export interface BranchPolicyView {
  type: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface FacilityViewService {
  getFacilityProfile(facilityId: string, locale: Locale): Promise<Result<FacilityProfileView, FacilityViewError>>;
  getBranchProfile(branchId: string, locale: Locale): Promise<Result<BranchProfileView, FacilityViewError>>;
  listApprovedFacilities(locale: Locale): Promise<FacilityBranchSummary[]>;
}

export function createFacilityViewService(db: Queryable): FacilityViewService {
  return {
    async getFacilityProfile(facilityId, locale) {
      const facRes = await db.query<{
        id: string;
        name_ar: string; name_en: string;
        logo_url: string | null;
        description_ar: string | null; description_en: string | null;
        created_at: string;
      }>(
        `SELECT id, name_ar, name_en, logo_url, description_ar, description_en,
                created_at::text
         FROM facilities
         WHERE id = $1 AND status = 'approved'`,
        [facilityId],
      );
      if (facRes.rows.length === 0) return err('FACILITY_NOT_FOUND');

      const fac = facRes.rows[0]!;

      // Branches
      const branchRes = await db.query<{
        id: string;
        name_ar: string; name_en: string;
        district_ar: string | null; district_en: string | null;
        city_ar: string; city_en: string;
      }>(
        `SELECT id, name_ar, name_en, district_ar, district_en, city_ar, city_en
         FROM branches
         WHERE facility_id = $1 AND is_active = true
         ORDER BY name_en`,
        [facilityId],
      );

      // Specialties
      const specRes = await db.query<{ spec_name: string }>(
        `SELECT DISTINCT ${locale === 'ar' ? 's.name_ar' : 's.name_en'} AS spec_name
         FROM doctors d
         JOIN specialties s ON s.id = d.specialty_id AND s.is_active = true
         WHERE d.facility_id = $1 AND d.is_active = true
         ORDER BY spec_name`,
        [facilityId],
      );

      // Doctor count
      const docCountRes = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM doctors
         WHERE facility_id = $1 AND is_active = true`,
        [facilityId],
      );

      // Insurance plans
      const insRes = await db.query<{ plan_name: string }>(
        `SELECT DISTINCT ${locale === 'ar' ? 'ip.name_ar' : 'ip.name_en'} AS plan_name
         FROM branch_insurance bi
         JOIN insurance_plans ip ON ip.id = bi.insurance_plan_id AND ip.is_active = true
         JOIN branches b ON b.id = bi.branch_id AND b.is_active = true
         WHERE b.facility_id = $1
         ORDER BY plan_name`,
        [facilityId],
      );

      return ok({
        id: fac.id,
        name: localizedField(fac, 'name', locale),
        logoUrl: fac.logo_url,
        description: localizedField(fac, 'description', locale) || null,
        verified: true,
        joinedAt: fac.created_at,
        specialties: specRes.rows.map((r) => r.spec_name),
        branchCount: branchRes.rows.length,
        doctorCount: parseInt(docCountRes.rows[0]?.count ?? '0', 10),
        branches: branchRes.rows.map((r) => ({
          branchId: r.id,
          branchName: localizedField(r, 'name', locale),
          districtName: localizedField(
            { name_ar: r.district_ar ?? '', name_en: r.district_en ?? '' },
            'name', locale,
          ) || null,
          cityName: localizedField(
            { name_ar: r.city_ar, name_en: r.city_en },
            'name', locale,
          ),
        })),
        insurancePlans: insRes.rows.map((r) => r.plan_name),
      });
    },

    async getBranchProfile(branchId, locale) {
      const brRes = await db.query<{
        id: string;
        name_ar: string; name_en: string;
        facility_id: string;
        fac_name_ar: string; fac_name_en: string;
        fac_logo_url: string | null;
        address_line: string | null;
        district_ar: string | null; district_en: string | null;
        city_ar: string; city_en: string;
        phone: string | null;
        latitude: string | null; longitude: string | null;
      }>(
        `SELECT b.id, b.name_ar, b.name_en, b.facility_id,
                f.name_ar AS fac_name_ar, f.name_en AS fac_name_en,
                f.logo_url AS fac_logo_url,
                b.address_line, b.district_ar, b.district_en,
                b.city_ar, b.city_en, b.phone,
                b.latitude::text, b.longitude::text
         FROM branches b
         JOIN facilities f ON f.id = b.facility_id AND f.status = 'approved'
         WHERE b.id = $1 AND b.is_active = true`,
        [branchId],
      );
      if (brRes.rows.length === 0) return err('BRANCH_NOT_FOUND');

      const br = brRes.rows[0]!;

      // Working hours
      const whRes = await db.query<{
        day_of_week: number;
        open_time: string; close_time: string;
        is_closed: boolean;
      }>(
        `SELECT day_of_week, open_time::text, close_time::text, is_closed
         FROM working_hours
         WHERE branch_id = $1
         ORDER BY day_of_week`,
        [branchId],
      );

      // Doctors
      const docRes = await db.query<{
        doctor_id: string;
        name_ar: string; name_en: string;
        photo_url: string | null;
        spec_name_ar: string; spec_name_en: string;
      }>(
        `SELECT d.id AS doctor_id, d.name_ar, d.name_en, d.photo_url,
                s.name_ar AS spec_name_ar, s.name_en AS spec_name_en
         FROM doctor_branches db
         JOIN doctors d ON d.id = db.doctor_id AND d.is_active = true
         JOIN specialties s ON s.id = d.specialty_id AND s.is_active = true
         WHERE db.branch_id = $1 AND db.is_active = true
         ORDER BY d.name_en`,
        [branchId],
      );

      // Services + prices
      const svcRes = await db.query<{
        service_id: string;
        service_name_ar: string; service_name_en: string;
        duration_minutes: number;
        price_amount: string | null;
        price_type: string | null;
      }>(
        `SELECT sv.id AS service_id,
                sv.name_ar AS service_name_ar, sv.name_en AS service_name_en,
                bs.duration_minutes,
                p.amount AS price_amount, p.price_type
         FROM branch_services bs
         JOIN services sv ON sv.id = bs.service_id AND sv.is_active = true
         LEFT JOIN prices p ON p.branch_service_id = bs.id
           AND p.status = 'approved' AND p.effective_to IS NULL
         WHERE bs.branch_id = $1 AND bs.is_active = true
         ORDER BY sv.sort_order, sv.name_en`,
        [branchId],
      );

      // Insurance
      const insRes = await db.query<{ plan_name: string }>(
        `SELECT ${locale === 'ar' ? 'ip.name_ar' : 'ip.name_en'} AS plan_name
         FROM branch_insurance bi
         JOIN insurance_plans ip ON ip.id = bi.insurance_plan_id AND ip.is_active = true
         WHERE bi.branch_id = $1
         ORDER BY plan_name`,
        [branchId],
      );

      // Policies
      const polRes = await db.query<{
        policy_type: string;
        policy_text_ar: string; policy_text_en: string;
      }>(
        `SELECT policy_type, policy_text_ar, policy_text_en
         FROM branch_policies
         WHERE branch_id = $1
         ORDER BY policy_type`,
        [branchId],
      );

      return ok({
        id: br.id,
        name: localizedField(br, 'name', locale),
        facilityId: br.facility_id,
        facilityName: localizedField(
          { name_ar: br.fac_name_ar, name_en: br.fac_name_en },
          'name', locale,
        ),
        facilityLogoUrl: br.fac_logo_url,
        address: br.address_line,
        districtName: localizedField(
          { name_ar: br.district_ar ?? '', name_en: br.district_en ?? '' },
          'name', locale,
        ) || null,
        cityName: localizedField(
          { name_ar: br.city_ar, name_en: br.city_en },
          'name', locale,
        ),
        phone: br.phone,
        latitude: br.latitude,
        longitude: br.longitude,
        workingHours: whRes.rows.map((r) => ({
          dayOfWeek: r.day_of_week,
          dayName: getDayName(r.day_of_week, locale),
          openTime: r.open_time,
          closeTime: r.close_time,
          isClosed: r.is_closed,
        })),
        doctors: docRes.rows.map((r) => ({
          doctorId: r.doctor_id,
          doctorName: localizedField(r, 'name', locale),
          specialtyName: localizedField(
            { name_ar: r.spec_name_ar, name_en: r.spec_name_en },
            'name', locale,
          ),
          photoUrl: r.photo_url,
        })),
        services: svcRes.rows.map((r) => ({
          serviceId: r.service_id,
          serviceName: localizedField(
            { name_ar: r.service_name_ar, name_en: r.service_name_en },
            'name', locale,
          ),
          durationMinutes: r.duration_minutes,
          price: r.price_amount,
          priceType: r.price_type,
        })),
        insurancePlans: insRes.rows.map((r) => r.plan_name),
        policies: polRes.rows.map((r) => ({
          type: r.policy_type,
          text: localizedField(r, 'policy_text', locale),
        })),
      });
    },

    async listApprovedFacilities(locale) {
      const res = await db.query<{
        id: string;
        name_ar: string; name_en: string;
      }>(
        `SELECT id, name_ar, name_en
         FROM facilities
         WHERE status = 'approved'
         ORDER BY name_en`,
      );
      return res.rows.map((r) => ({
        branchId: r.id,
        branchName: localizedField(r, 'name', locale),
        districtName: null,
        cityName: '',
      }));
    },
  };
}
