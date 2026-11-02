import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { localizedField, type Locale } from '../../shared/i18n.ts';

/**
 * ZAMO-SRCH-020 — public specialty & service view.
 *
 * Read-only public API for patients to browse specialties and services.
 * ❗ No diagnostic or medical promise in any field (A-48, A-49, DEC-014).
 * Only approved facilities / active branches / active doctors appear.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpecialtyViewError = 'SPECIALTY_NOT_FOUND' | 'SERVICE_NOT_FOUND';

export interface SpecialtyView {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  servicesCount: number;
}

export interface ServiceView {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  defaultDurationMinutes: number;
  specialtyName: string;
  /** How many active branches offer this service */
  clinicsCount: number;
  /** Price range across active branches */
  priceRange: { min: string | null; max: string | null; type: string | null };
}

export interface ServiceDetailView extends ServiceView {
  specialtySlug: string;
  /** Branches that offer this service with their prices */
  branches: Array<{
    branchId: string;
    branchName: string;
    facilityName: string;
    districtName: string | null;
    price: string | null;
    priceType: string | null;
    durationMinutes: number;
  }>;
  /** Medical disclaimer — always present (A-48) */
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SpecialtyViewService {
  listSpecialties(locale: Locale): Promise<SpecialtyView[]>;
  getSpecialtyWithServices(slug: string, locale: Locale): Promise<Result<
    { specialty: SpecialtyView; services: ServiceView[] },
    SpecialtyViewError
  >>;
  getServiceDetail(serviceId: string, locale: Locale): Promise<Result<ServiceDetailView, SpecialtyViewError>>;
}

export function createSpecialtyViewService(db: Queryable): SpecialtyViewService {
  return {
    async listSpecialties(locale) {
      const res = await db.query<{
        id: string;
        name_ar: string; name_en: string;
        slug: string; icon: string | null;
        description_ar: string | null; description_en: string | null;
        services_count: string;
      }>(
        `SELECT s.*, (
           SELECT COUNT(*)::text FROM services sv WHERE sv.specialty_id = s.id AND sv.is_active = true
         ) AS services_count
         FROM specialties s
         WHERE s.is_active = true
         ORDER BY s.sort_order, s.name_en`,
      );
      return res.rows.map((r) => ({
        id: r.id,
        name: localizedField(r, 'name', locale),
        slug: r.slug,
        icon: r.icon,
        description: localizedField(r, 'description', locale) || null,
        servicesCount: parseInt(r.services_count, 10),
      }));
    },

    async getSpecialtyWithServices(slug, locale) {
      const specRes = await db.query<{
        id: string;
        name_ar: string; name_en: string;
        slug: string; icon: string | null;
        description_ar: string | null; description_en: string | null;
      }>(
        `SELECT * FROM specialties WHERE slug = $1 AND is_active = true`,
        [slug],
      );
      if (specRes.rows.length === 0) return err('SPECIALTY_NOT_FOUND');

      const spec = specRes.rows[0]!;
      const svcRes = await db.query<{
        id: string;
        name_ar: string; name_en: string;
        slug: string;
        description_ar: string | null; description_en: string | null;
        default_duration_minutes: number;
        clinics_count: string;
        price_min: string | null; price_max: string | null; price_type: string | null;
      }>(
        `SELECT sv.*,
           (SELECT COUNT(DISTINCT bs.branch_id)::text
            FROM branch_services bs
            JOIN branches br ON br.id = bs.branch_id AND br.is_active = true
            JOIN facilities f ON f.id = br.facility_id AND f.status = 'approved'
            WHERE bs.service_id = sv.id AND bs.is_active = true
           ) AS clinics_count,
           (SELECT MIN(p.amount)
            FROM prices p
            JOIN branch_services bs2 ON bs2.id = p.branch_service_id AND bs2.is_active = true
            WHERE bs2.service_id = sv.id AND p.status = 'approved' AND p.effective_to IS NULL
           ) AS price_min,
           (SELECT MAX(COALESCE(p.amount_max, p.amount))
            FROM prices p
            JOIN branch_services bs3 ON bs3.id = p.branch_service_id AND bs3.is_active = true
            WHERE bs3.service_id = sv.id AND p.status = 'approved' AND p.effective_to IS NULL
           ) AS price_max,
           (SELECT p.price_type
            FROM prices p
            JOIN branch_services bs4 ON bs4.id = p.branch_service_id AND bs4.is_active = true
            WHERE bs4.service_id = sv.id AND p.status = 'approved' AND p.effective_to IS NULL
            LIMIT 1
           ) AS price_type
         FROM services sv
         WHERE sv.specialty_id = $1 AND sv.is_active = true
         ORDER BY sv.sort_order, sv.name_en`,
        [spec.id],
      );

      return ok({
        specialty: {
          id: spec.id,
          name: localizedField(spec, 'name', locale),
          slug: spec.slug,
          icon: spec.icon,
          description: localizedField(spec, 'description', locale) || null,
          servicesCount: svcRes.rows.length,
        },
        services: svcRes.rows.map((r) => ({
          id: r.id,
          name: localizedField(r, 'name', locale),
          description: localizedField(r, 'description', locale) || null,
          slug: r.slug,
          defaultDurationMinutes: r.default_duration_minutes,
          specialtyName: localizedField(spec, 'name', locale),
          clinicsCount: parseInt(r.clinics_count, 10),
          priceRange: {
            min: r.price_min,
            max: r.price_max,
            type: r.price_type,
          },
        })),
      });
    },

    async getServiceDetail(serviceId, locale) {
      const svcRes = await db.query<{
        id: string;
        specialty_id: string;
        name_ar: string; name_en: string;
        slug: string;
        description_ar: string | null; description_en: string | null;
        default_duration_minutes: number;
        spec_name_ar: string; spec_name_en: string;
        spec_slug: string;
      }>(
        `SELECT sv.*,
           sp.name_ar AS spec_name_ar, sp.name_en AS spec_name_en, sp.slug AS spec_slug
         FROM services sv
         JOIN specialties sp ON sp.id = sv.specialty_id
         WHERE sv.id = $1 AND sv.is_active = true`,
        [serviceId],
      );
      if (svcRes.rows.length === 0) return err('SERVICE_NOT_FOUND');

      const svc = svcRes.rows[0]!;

      // Get branches offering this service with prices
      const branchRes = await db.query<{
        branch_id: string;
        branch_name_ar: string; branch_name_en: string;
        facility_name_ar: string; facility_name_en: string;
        district_ar: string | null; district_en: string | null;
        price_amount: string | null; price_type: string | null;
        duration_minutes: number;
      }>(
        `SELECT
           b.id AS branch_id,
           b.name_ar AS branch_name_ar, b.name_en AS branch_name_en,
           f.name_ar AS facility_name_ar, f.name_en AS facility_name_en,
           b.district_ar, b.district_en,
           p.amount AS price_amount, p.price_type,
           bs.duration_minutes
         FROM branch_services bs
         JOIN branches b ON b.id = bs.branch_id AND b.is_active = true
         JOIN facilities f ON f.id = b.facility_id AND f.status = 'approved'
         LEFT JOIN prices p ON p.branch_service_id = bs.id
           AND p.status = 'approved' AND p.effective_to IS NULL
         WHERE bs.service_id = $1 AND bs.is_active = true
         ORDER BY p.amount ASC NULLS LAST`,
        [serviceId],
      );

      const clinicsCount = branchRes.rows.length;
      const prices = branchRes.rows
        .filter((r) => r.price_amount !== null)
        .map((r) => r.price_amount!);

      return ok({
        id: svc.id,
        name: localizedField(svc, 'name', locale),
        description: localizedField(svc, 'description', locale) || null,
        slug: svc.slug,
        defaultDurationMinutes: svc.default_duration_minutes,
        specialtyName: localizedField(
          { name_ar: svc.spec_name_ar, name_en: svc.spec_name_en },
          'name',
          locale,
        ),
        specialtySlug: svc.spec_slug,
        clinicsCount,
        priceRange: {
          min: prices.length > 0 ? prices[0]! : null,
          max: prices.length > 0 ? prices[prices.length - 1]! : null,
          type: branchRes.rows[0]?.price_type ?? null,
        },
        branches: branchRes.rows.map((r) => ({
          branchId: r.branch_id,
          branchName: localizedField(
            { name_ar: r.branch_name_ar, name_en: r.branch_name_en },
            'name',
            locale,
          ),
          facilityName: localizedField(
            { name_ar: r.facility_name_ar, name_en: r.facility_name_en },
            'name',
            locale,
          ),
          districtName: localizedField(
            { name_ar: r.district_ar ?? '', name_en: r.district_en ?? '' },
            'name',
            locale,
          ) || null,
          price: r.price_amount,
          priceType: r.price_type,
          durationMinutes: r.duration_minutes,
        })),
        // ❗ Always present — A-48: no medical promises
        disclaimer: locale === 'ar'
          ? 'النتائج تختلف من شخص لآخر. استشر طبيبك.'
          : 'Results vary from person to person. Consult your doctor.',
      });
    },
  };
}
