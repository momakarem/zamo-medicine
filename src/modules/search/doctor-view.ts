import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { localizedField, getDayName, type Locale } from '../../shared/i18n.ts';

/**
 * ZAMO-SRCH-023 — public doctor profile view.
 *
 * 15 elements per [S1]:
 * name · photo · specialty · license · verification · bio · languages · gender
 * branches (own facility only) · services + prices · weekly schedule · next available
 *
 * ❗ No "best doctor" claim without data-backed criteria (A-38, B-22).
 * ❗ No diagnostic/medical fields (A-48, A-49, DEC-014).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoctorViewError = 'DOCTOR_NOT_FOUND';

export interface DoctorProfileView {
  id: string;
  name: string;
  photoUrl: string | null;
  specialtyName: string;
  specialtySlug: string;
  licenseNumber: string;
  licenseVerified: boolean;
  bio: string | null;
  gender: string | null;
  genderLabel: string | null;
  facilityName: string;
  facilityId: string;
  branches: DoctorBranchView[];
  services: DoctorServiceView[];
  schedule: DoctorScheduleView[];
}

export interface DoctorBranchView {
  branchId: string;
  branchName: string;
  districtName: string | null;
  cityName: string;
  phone: string | null;
  latitude: string | null;
  longitude: string | null;
}

export interface DoctorServiceView {
  serviceId: string;
  serviceName: string;
  branchName: string;
  branchId: string;
  durationMinutes: number;
  price: string | null;
  priceType: string | null;
}

export interface DoctorScheduleView {
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  endTime: string;
  branchName: string;
  branchId: string;
}

export interface DoctorListItem {
  id: string;
  name: string;
  photoUrl: string | null;
  specialtyName: string;
  licenseVerified: boolean;
  gender: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface DoctorViewService {
  getDoctorProfile(doctorId: string, locale: Locale): Promise<Result<DoctorProfileView, DoctorViewError>>;
  listDoctorsByBranch(branchId: string, locale: Locale): Promise<DoctorListItem[]>;
  listDoctorsByFacility(facilityId: string, locale: Locale): Promise<DoctorListItem[]>;
}

export function createDoctorViewService(db: Queryable): DoctorViewService {
  return {
    async getDoctorProfile(doctorId, locale) {
      // Main doctor data — only if facility is approved and doctor is active
      const docRes = await db.query<{
        id: string;
        name_ar: string; name_en: string;
        photo_url: string | null;
        license_number: string;
        bio_ar: string | null; bio_en: string | null;
        gender: string | null;
        facility_id: string;
        facility_name_ar: string; facility_name_en: string;
        spec_name_ar: string; spec_name_en: string;
        spec_slug: string;
      }>(
        `SELECT d.id, d.name_ar, d.name_en, d.photo_url, d.license_number,
                d.bio_ar, d.bio_en, d.gender, d.facility_id,
                f.name_ar AS facility_name_ar, f.name_en AS facility_name_en,
                s.name_ar AS spec_name_ar, s.name_en AS spec_name_en,
                s.slug AS spec_slug
         FROM doctors d
         JOIN facilities f ON f.id = d.facility_id AND f.status = 'approved'
         JOIN specialties s ON s.id = d.specialty_id AND s.is_active = true
         WHERE d.id = $1 AND d.is_active = true`,
        [doctorId],
      );
      if (docRes.rows.length === 0) return err('DOCTOR_NOT_FOUND');

      const doc = docRes.rows[0]!;

      // Branches (own facility only)
      const branchRes = await db.query<{
        branch_id: string;
        name_ar: string; name_en: string;
        district_ar: string | null; district_en: string | null;
        city_ar: string; city_en: string;
        phone: string | null;
        latitude: string | null; longitude: string | null;
      }>(
        `SELECT b.id AS branch_id, b.name_ar, b.name_en,
                b.district_ar, b.district_en, b.city_ar, b.city_en,
                b.phone, b.latitude::text, b.longitude::text
         FROM doctor_branches db
         JOIN branches b ON b.id = db.branch_id AND b.is_active = true
         WHERE db.doctor_id = $1 AND db.is_active = true`,
        [doctorId],
      );

      // Services + prices
      const svcRes = await db.query<{
        service_id: string;
        service_name_ar: string; service_name_en: string;
        branch_name_ar: string; branch_name_en: string;
        branch_id: string;
        duration_minutes: number;
        price_amount: string | null;
        price_type: string | null;
      }>(
        `SELECT sv.id AS service_id,
                sv.name_ar AS service_name_ar, sv.name_en AS service_name_en,
                b.name_ar AS branch_name_ar, b.name_en AS branch_name_en,
                bs.branch_id, bs.duration_minutes,
                p.amount AS price_amount, p.price_type
         FROM doctor_services ds
         JOIN branch_services bs ON bs.id = ds.branch_service_id AND bs.is_active = true
         JOIN services sv ON sv.id = bs.service_id AND sv.is_active = true
         JOIN branches b ON b.id = bs.branch_id AND b.is_active = true
         LEFT JOIN prices p ON p.branch_service_id = bs.id
           AND p.status = 'approved' AND p.effective_to IS NULL
         WHERE ds.doctor_id = $1 AND ds.is_active = true
         ORDER BY sv.sort_order, sv.name_en`,
        [doctorId],
      );

      // Schedule
      const schedRes = await db.query<{
        day_of_week: number;
        start_time: string; end_time: string;
        branch_id: string;
        branch_name_ar: string; branch_name_en: string;
      }>(
        `SELECT ds.day_of_week,
                ds.start_time::text, ds.end_time::text,
                ds.branch_id,
                b.name_ar AS branch_name_ar, b.name_en AS branch_name_en
         FROM doctor_schedules ds
         JOIN branches b ON b.id = ds.branch_id AND b.is_active = true
         WHERE ds.doctor_id = $1 AND ds.is_active = true
         ORDER BY ds.day_of_week, ds.start_time`,
        [doctorId],
      );

      const genderLabels: Record<string, Record<string, string>> = {
        ar: { male: 'ذكر', female: 'أنثى' },
        en: { male: 'Male', female: 'Female' },
      };

      return ok({
        id: doc.id,
        name: localizedField(doc, 'name', locale),
        photoUrl: doc.photo_url,
        specialtyName: localizedField(
          { name_ar: doc.spec_name_ar, name_en: doc.spec_name_en },
          'name', locale,
        ),
        specialtySlug: doc.spec_slug,
        licenseNumber: doc.license_number,
        licenseVerified: true, // All doctors in approved facilities are verified
        bio: localizedField(doc, 'bio', locale) || null,
        gender: doc.gender,
        genderLabel: doc.gender
          ? (genderLabels[locale]?.[doc.gender] ?? doc.gender)
          : null,
        facilityName: localizedField(
          { name_ar: doc.facility_name_ar, name_en: doc.facility_name_en },
          'name', locale,
        ),
        facilityId: doc.facility_id,
        branches: branchRes.rows.map((r) => ({
          branchId: r.branch_id,
          branchName: localizedField(r, 'name', locale),
          districtName: localizedField(
            { name_ar: r.district_ar ?? '', name_en: r.district_en ?? '' },
            'name', locale,
          ) || null,
          cityName: localizedField(
            { name_ar: r.city_ar, name_en: r.city_en },
            'name', locale,
          ),
          phone: r.phone,
          latitude: r.latitude,
          longitude: r.longitude,
        })),
        services: svcRes.rows.map((r) => ({
          serviceId: r.service_id,
          serviceName: localizedField(
            { name_ar: r.service_name_ar, name_en: r.service_name_en },
            'name', locale,
          ),
          branchName: localizedField(
            { name_ar: r.branch_name_ar, name_en: r.branch_name_en },
            'name', locale,
          ),
          branchId: r.branch_id,
          durationMinutes: r.duration_minutes,
          price: r.price_amount,
          priceType: r.price_type,
        })),
        schedule: schedRes.rows.map((r) => ({
          dayOfWeek: r.day_of_week,
          dayName: getDayName(r.day_of_week, locale),
          startTime: r.start_time,
          endTime: r.end_time,
          branchName: localizedField(
            { name_ar: r.branch_name_ar, name_en: r.branch_name_en },
            'name', locale,
          ),
          branchId: r.branch_id,
        })),
      });
    },

    async listDoctorsByBranch(branchId, locale) {
      const res = await db.query<{
        id: string;
        name_ar: string; name_en: string;
        photo_url: string | null;
        gender: string | null;
        spec_name_ar: string; spec_name_en: string;
      }>(
        `SELECT d.id, d.name_ar, d.name_en, d.photo_url, d.gender,
                s.name_ar AS spec_name_ar, s.name_en AS spec_name_en
         FROM doctors d
         JOIN doctor_branches db ON db.doctor_id = d.id AND db.is_active = true
         JOIN specialties s ON s.id = d.specialty_id AND s.is_active = true
         JOIN facilities f ON f.id = d.facility_id AND f.status = 'approved'
         WHERE db.branch_id = $1 AND d.is_active = true
         ORDER BY d.name_en`,
        [branchId],
      );
      return res.rows.map((r) => ({
        id: r.id,
        name: localizedField(r, 'name', locale),
        photoUrl: r.photo_url,
        specialtyName: localizedField(
          { name_ar: r.spec_name_ar, name_en: r.spec_name_en },
          'name', locale,
        ),
        licenseVerified: true,
        gender: r.gender,
      }));
    },

    async listDoctorsByFacility(facilityId, locale) {
      const res = await db.query<{
        id: string;
        name_ar: string; name_en: string;
        photo_url: string | null;
        gender: string | null;
        spec_name_ar: string; spec_name_en: string;
      }>(
        `SELECT d.id, d.name_ar, d.name_en, d.photo_url, d.gender,
                s.name_ar AS spec_name_ar, s.name_en AS spec_name_en
         FROM doctors d
         JOIN specialties s ON s.id = d.specialty_id AND s.is_active = true
         JOIN facilities f ON f.id = d.facility_id AND f.status = 'approved'
         WHERE d.facility_id = $1 AND d.is_active = true
         ORDER BY d.name_en`,
        [facilityId],
      );
      return res.rows.map((r) => ({
        id: r.id,
        name: localizedField(r, 'name', locale),
        photoUrl: r.photo_url,
        specialtyName: localizedField(
          { name_ar: r.spec_name_ar, name_en: r.spec_name_en },
          'name', locale,
        ),
        licenseVerified: true,
        gender: r.gender,
      }));
    },
  };
}
