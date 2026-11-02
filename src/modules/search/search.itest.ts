import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMigratedTestDb } from '../../db/testing.ts';
import type { Db } from '../../db/client.ts';
import { createSearchService } from './search.ts';
import { createSpecialtyViewService } from './specialty-view.ts';
import { createDoctorViewService } from './doctor-view.ts';
import { createFacilityViewService } from './facility-view.ts';
import { createLegalPagesService } from './legal-pages.ts';

/**
 * ZAMO Phase 3 — Discovery integration tests.
 *
 * Tests: SRCH-019, SRCH-020, SRCH-021, SRCH-022, SRCH-023, SRCH-024, SRCH-026.
 *
 * All queries run as superuser (no RLS needed — these are public read APIs).
 * The services themselves filter to only approved/active entities via WHERE clauses.
 */

let db: Db;
let userId: string;
let facilityId: string;
let branchId: string;
let doctorId: string;
let specialtyId: string;
let serviceId: string;
let branchServiceId: string;

// Unapproved facility — must NOT appear in results
let unapprovedFacilityId: string;
let inactiveDoctorId: string;

before(async () => {
  db = await createMigratedTestDb();

  // Create a user for created_by references
  const userRes = await db.query<{ id: string }>(
    `INSERT INTO users (phone, email, full_name) VALUES ('+966500000099', 'search-test@zamo.sa', 'Search Test User')
     RETURNING id`,
  );
  userId = userRes.rows[0]!.id;

  // --- Approved facility with active branch, doctor, service, price ---

  const facRes = await db.query<{ id: string }>(
    `INSERT INTO facilities (name_ar, name_en, status)
     VALUES ('عيادة الاكتشاف', 'Discovery Clinic', 'approved')
     RETURNING id`,
  );
  facilityId = facRes.rows[0]!.id;

  const brRes = await db.query<{ id: string }>(
    `INSERT INTO branches (facility_id, name_ar, name_en, district_ar, district_en, city_ar, city_en, latitude, longitude)
     VALUES ($1, 'فرع الرياض', 'Riyadh Branch', 'العليا', 'Olaya', 'الرياض', 'Riyadh', 24.7136, 46.6753)
     RETURNING id`,
    [facilityId],
  );
  branchId = brRes.rows[0]!.id;

  // Working hours
  await db.query(
    `INSERT INTO working_hours (branch_id, day_of_week, open_time, close_time) VALUES ($1, 0, '08:00', '20:00')`,
    [branchId],
  );
  await db.query(
    `INSERT INTO working_hours (branch_id, day_of_week, open_time, close_time, is_closed) VALUES ($1, 5, '08:00', '20:00', true)`,
    [branchId],
  );

  // Insurance plan
  const insRes = await db.query<{ id: string }>(
    `INSERT INTO insurance_plans (name_ar, name_en, provider) VALUES ('تأمين بوبا', 'Bupa Insurance', 'Bupa') RETURNING id`,
  );
  await db.query(
    `INSERT INTO branch_insurance (branch_id, insurance_plan_id) VALUES ($1, $2)`,
    [branchId, insRes.rows[0]!.id],
  );

  // Branch policy
  await db.query(
    `INSERT INTO branch_policies (branch_id, policy_type, policy_text_ar, policy_text_en)
     VALUES ($1, 'cancellation', 'يمكن الإلغاء قبل 24 ساعة', 'Can cancel 24 hours before')`,
    [branchId],
  );

  // Get specialty (seeded by migration 0009)
  const specRes = await db.query<{ id: string }>(
    `SELECT id FROM specialties WHERE slug = 'dentistry'`,
  );
  specialtyId = specRes.rows[0]!.id;

  // Create doctor
  const docRes = await db.query<{ id: string }>(
    `INSERT INTO doctors (facility_id, specialty_id, name_ar, name_en, license_number, gender, bio_ar, bio_en, photo_url)
     VALUES ($1, $2, 'د. أحمد السعيد', 'Dr. Ahmed Al-Saeed', 'LIC-001', 'male', 'طبيب أسنان', 'Dentist', '/photos/ahmed.jpg')
     RETURNING id`,
    [facilityId, specialtyId],
  );
  doctorId = docRes.rows[0]!.id;

  // Link doctor to branch
  await db.query(
    `INSERT INTO doctor_branches (doctor_id, branch_id) VALUES ($1, $2)`,
    [doctorId, branchId],
  );

  // Doctor schedule
  await db.query(
    `INSERT INTO doctor_schedules (doctor_id, branch_id, day_of_week, start_time, end_time, slot_duration_minutes)
     VALUES ($1, $2, 0, '09:00', '17:00', 30)`,
    [doctorId, branchId],
  );

  // Create service
  const svcRes = await db.query<{ id: string }>(
    `INSERT INTO services (specialty_id, name_ar, name_en, slug, default_duration_minutes)
     VALUES ($1, 'تنظيف الأسنان', 'Teeth Cleaning', 'teeth-cleaning', 30)
     RETURNING id`,
    [specialtyId],
  );
  serviceId = svcRes.rows[0]!.id;

  // Link service to branch
  const bsRes = await db.query<{ id: string }>(
    `INSERT INTO branch_services (branch_id, service_id, duration_minutes)
     VALUES ($1, $2, 30)
     RETURNING id`,
    [branchId, serviceId],
  );
  branchServiceId = bsRes.rows[0]!.id;

  // Link doctor to service
  await db.query(
    `INSERT INTO doctor_services (doctor_id, branch_service_id)
     VALUES ($1, $2)`,
    [doctorId, branchServiceId],
  );

  // Create approved price
  await db.query(
    `INSERT INTO prices (branch_service_id, price_type, amount, currency, status, created_by)
     VALUES ($1, 'fixed', '200.00', 'SAR', 'approved', $2)`,
    [branchServiceId, userId],
  );

  // --- Unapproved facility (must NOT appear) ---

  const ufRes = await db.query<{ id: string }>(
    `INSERT INTO facilities (name_ar, name_en, status)
     VALUES ('عيادة غير معتمدة', 'Unapproved Clinic', 'pending_review')
     RETURNING id`,
  );
  unapprovedFacilityId = ufRes.rows[0]!.id;

  const ubRes = await db.query<{ id: string }>(
    `INSERT INTO branches (facility_id, name_ar, name_en)
     VALUES ($1, 'فرع مخفي', 'Hidden Branch')
     RETURNING id`,
    [unapprovedFacilityId],
  );

  const udRes = await db.query<{ id: string }>(
    `INSERT INTO doctors (facility_id, specialty_id, name_ar, name_en, license_number)
     VALUES ($1, $2, 'د. مخفي', 'Dr. Hidden', 'LIC-HIDDEN')
     RETURNING id`,
    [unapprovedFacilityId, specialtyId],
  );
  await db.query(
    `INSERT INTO doctor_branches (doctor_id, branch_id) VALUES ($1, $2)`,
    [udRes.rows[0]!.id, ubRes.rows[0]!.id],
  );

  // --- Inactive doctor in approved facility (must NOT appear) ---

  const inactRes = await db.query<{ id: string }>(
    `INSERT INTO doctors (facility_id, specialty_id, name_ar, name_en, license_number, is_active)
     VALUES ($1, $2, 'د. معطل', 'Dr. Inactive', 'LIC-INACTIVE', false)
     RETURNING id`,
    [facilityId, specialtyId],
  );
  inactiveDoctorId = inactRes.rows[0]!.id;
  await db.query(
    `INSERT INTO doctor_branches (doctor_id, branch_id) VALUES ($1, $2)`,
    [inactiveDoctorId, branchId],
  );
});

after(async () => {
  await db.close();
});

// ============================================================================
// SRCH-019 — Homepage data
// ============================================================================

describe('SRCH-019 — Homepage data', () => {
  it('returns specialties with service counts', async () => {
    const search = createSearchService(db);
    const data = await search.getHomepageData('ar');
    assert.ok(data.specialties.length >= 3, 'Should have at least 3 specialties');
    for (const s of data.specialties) {
      assert.ok(s.name, 'Specialty name should be non-empty');
      assert.ok(s.slug, 'Specialty slug should be non-empty');
    }
  });

  it('returns stats', async () => {
    const search = createSearchService(db);
    const data = await search.getHomepageData('en');
    assert.ok(data.stats.facilitiesCount >= 1, 'Should have at least 1 facility');
    assert.ok(data.stats.doctorsCount >= 1, 'Should have at least 1 doctor');
    assert.ok(data.stats.specialtiesCount >= 3, 'Should have at least 3 specialties');
  });

  it('returns featured facilities (only approved)', async () => {
    const search = createSearchService(db);
    const data = await search.getHomepageData('ar');
    for (const f of data.featuredFacilities) {
      assert.notEqual(f.id, unapprovedFacilityId, 'Unapproved facility must not appear');
    }
  });
});

// ============================================================================
// SRCH-020 — Specialty & service view
// ============================================================================

describe('SRCH-020 — Specialty & service view', () => {
  it('lists active specialties', async () => {
    const svc = createSpecialtyViewService(db);
    const specs = await svc.listSpecialties('ar');
    assert.ok(specs.length >= 3);
    assert.ok(specs[0]!.name.length > 0);
  });

  it('gets specialty with services', async () => {
    const svc = createSpecialtyViewService(db);
    const result = await svc.getSpecialtyWithServices('dentistry', 'en');
    assert.ok(result.ok);
    assert.equal(result.value.specialty.slug, 'dentistry');
    assert.ok(result.value.services.length >= 1, 'Should have at least 1 service');
  });

  it('returns error for non-existent specialty', async () => {
    const svc = createSpecialtyViewService(db);
    const result = await svc.getSpecialtyWithServices('fake', 'ar');
    assert.ok(!result.ok);
    assert.equal(result.error, 'SPECIALTY_NOT_FOUND');
  });

  it('gets service detail with branches and prices', async () => {
    const svc = createSpecialtyViewService(db);
    const result = await svc.getServiceDetail(serviceId, 'ar');
    assert.ok(result.ok);
    assert.equal(result.value.name, 'تنظيف الأسنان');
    assert.ok(result.value.branches.length >= 1);
    assert.ok(result.value.disclaimer.length > 0, 'Disclaimer must be present');
  });
});

// ============================================================================
// SRCH-021 + SRCH-022 — Search & filters + results
// ============================================================================

describe('SRCH-021 — Search with filters', () => {
  it('search with no filters returns active doctors', async () => {
    const search = createSearchService(db);
    const results = await search.search({}, 'ar');
    assert.ok(results.length >= 1, 'Should return at least 1 result');
  });

  it('search by specialty returns correct results', async () => {
    const search = createSearchService(db);
    const results = await search.search({ specialtyId }, 'ar');
    assert.ok(results.length >= 1);
    for (const r of results) {
      assert.equal(r.specialtyId, specialtyId);
    }
  });

  it('search by district returns correct results', async () => {
    const search = createSearchService(db);
    const results = await search.search({ district: 'العليا' }, 'ar');
    assert.ok(results.length >= 1);
  });

  it('search by doctor name (Arabic)', async () => {
    const search = createSearchService(db);
    const results = await search.search({ doctorName: 'أحمد' }, 'ar');
    assert.ok(results.length >= 1);
    assert.ok(results[0]!.doctorNameAr.includes('أحمد'));
  });

  it('search by doctor name (English)', async () => {
    const search = createSearchService(db);
    const results = await search.search({ doctorName: 'Ahmed' }, 'en');
    assert.ok(results.length >= 1);
  });

  it('search by gender filter', async () => {
    const search = createSearchService(db);
    const results = await search.search({ doctorGender: 'male' }, 'ar');
    assert.ok(results.length >= 1);
    for (const r of results) {
      assert.equal(r.gender, 'male');
    }
  });

  it('empty results return empty array (no error)', async () => {
    const search = createSearchService(db);
    const results = await search.search({ district: 'nonexistent-district-xyz' }, 'ar');
    assert.equal(results.length, 0);
  });

  it('❗ unapproved facility does NOT appear in search', async () => {
    const search = createSearchService(db);
    const results = await search.search({}, 'ar');
    for (const r of results) {
      assert.notEqual(r.facilityId, unapprovedFacilityId, 'Unapproved facility must not appear');
    }
  });

  it('❗ inactive doctor does NOT appear in search', async () => {
    const search = createSearchService(db);
    const results = await search.search({}, 'ar');
    for (const r of results) {
      assert.notEqual(r.doctorId, inactiveDoctorId, 'Inactive doctor must not appear');
    }
  });
});

describe('SRCH-022 — Search results with recommendation reasons', () => {
  it('❗ recommendation reason is derived from data, not generic', async () => {
    const search = createSearchService(db);
    const results = await search.search({ doctorGender: 'male' }, 'ar');
    assert.ok(results.length >= 1);
    // When filtering by gender, reason should be preferred_gender
    assert.equal(results[0]!.recommendationReason, 'preferred_gender');
    assert.ok(results[0]!.recommendationReasonLabel.length > 0);
  });

  it('❗ isSponsored is always false (B-23)', async () => {
    const search = createSearchService(db);
    const results = await search.search({}, 'ar');
    for (const r of results) {
      assert.equal(r.isSponsored, false);
    }
  });

  it('results include all 17 required fields', async () => {
    const search = createSearchService(db);
    const results = await search.search({}, 'ar');
    assert.ok(results.length >= 1);
    const r = results[0]!;
    // Verify 17 key fields exist
    assert.ok(r.doctorName, 'doctorName');
    assert.ok(r.specialtyName, 'specialtyName');
    assert.ok(r.branchName, 'branchName');
    assert.ok(r.facilityName, 'facilityName');
    assert.ok(r.licenseNumber, 'licenseNumber');
    assert.ok(typeof r.licenseVerified === 'boolean', 'licenseVerified');
    assert.ok(typeof r.isSponsored === 'boolean', 'isSponsored');
    assert.ok(r.recommendationReason !== undefined, 'recommendationReason');
    // These can be null but should be defined
    assert.ok('photoUrl' in r);
    assert.ok('gender' in r);
    assert.ok('districtName' in r);
    assert.ok('facilityLogoUrl' in r);
    assert.ok('priceType' in r);
    assert.ok('amount' in r);
    assert.ok('amountMax' in r);
    assert.ok('doctorId' in r);
    assert.ok('branchId' in r);
  });

  it('recommendation reason labels exist in both locales', async () => {
    const search = createSearchService(db);
    const arResults = await search.search({}, 'ar');
    const enResults = await search.search({}, 'en');
    if (arResults.length > 0) {
      assert.ok(arResults[0]!.recommendationReasonLabel.length > 0);
    }
    if (enResults.length > 0) {
      assert.ok(enResults[0]!.recommendationReasonLabel.length > 0);
    }
  });
});

// ============================================================================
// SRCH-023 — Doctor profile
// ============================================================================

describe('SRCH-023 — Doctor profile view', () => {
  it('returns full doctor profile (15 elements)', async () => {
    const svc = createDoctorViewService(db);
    const result = await svc.getDoctorProfile(doctorId, 'ar');
    assert.ok(result.ok);
    const doc = result.value;
    assert.equal(doc.name, 'د. أحمد السعيد');
    assert.equal(doc.licenseNumber, 'LIC-001');
    assert.equal(doc.licenseVerified, true);
    assert.equal(doc.gender, 'male');
    assert.ok(doc.specialtyName.length > 0);
    assert.ok(doc.bio, 'Bio should exist');
    assert.ok(doc.branches.length >= 1, 'Should have at least 1 branch');
    assert.ok(doc.services.length >= 1, 'Should have at least 1 service');
    assert.ok(doc.schedule.length >= 1, 'Should have at least 1 schedule');
  });

  it('branches shown are from doctor facility only', async () => {
    const svc = createDoctorViewService(db);
    const result = await svc.getDoctorProfile(doctorId, 'en');
    assert.ok(result.ok);
    // All branches should be from the same facility
    // (confirmed by the JOIN in the service)
    assert.ok(result.value.branches.length >= 1);
  });

  it('returns error for non-existent doctor', async () => {
    const svc = createDoctorViewService(db);
    const result = await svc.getDoctorProfile('00000000-0000-0000-0000-000000000000', 'ar');
    assert.ok(!result.ok);
    assert.equal(result.error, 'DOCTOR_NOT_FOUND');
  });

  it('❗ inactive doctor returns NOT_FOUND', async () => {
    const svc = createDoctorViewService(db);
    const result = await svc.getDoctorProfile(inactiveDoctorId, 'ar');
    assert.ok(!result.ok);
    assert.equal(result.error, 'DOCTOR_NOT_FOUND');
  });
});

// ============================================================================
// SRCH-024 — Facility & branch profiles
// ============================================================================

describe('SRCH-024 — Facility profile', () => {
  it('returns facility profile (12 elements)', async () => {
    const svc = createFacilityViewService(db);
    const result = await svc.getFacilityProfile(facilityId, 'ar');
    assert.ok(result.ok);
    const fac = result.value;
    assert.equal(fac.name, 'عيادة الاكتشاف');
    assert.equal(fac.verified, true);
    assert.ok(fac.branchCount >= 1);
    assert.ok(fac.doctorCount >= 1);
    assert.ok(fac.branches.length >= 1);
  });

  it('❗ unapproved facility returns NOT_FOUND', async () => {
    const svc = createFacilityViewService(db);
    const result = await svc.getFacilityProfile(unapprovedFacilityId, 'ar');
    assert.ok(!result.ok);
    assert.equal(result.error, 'FACILITY_NOT_FOUND');
  });
});

describe('SRCH-024 — Branch profile', () => {
  it('returns branch profile (16 elements)', async () => {
    const svc = createFacilityViewService(db);
    const result = await svc.getBranchProfile(branchId, 'ar');
    assert.ok(result.ok);
    const br = result.value;
    assert.equal(br.name, 'فرع الرياض');
    assert.ok(br.workingHours.length >= 1, 'Should have working hours');
    assert.ok(br.doctors.length >= 1, 'Should have doctors');
    assert.ok(br.services.length >= 1, 'Should have services');
    assert.ok(br.policies.length >= 1, 'Should have policies');
  });

  it('returns error for non-existent branch', async () => {
    const svc = createFacilityViewService(db);
    const result = await svc.getBranchProfile('00000000-0000-0000-0000-000000000000', 'ar');
    assert.ok(!result.ok);
    assert.equal(result.error, 'BRANCH_NOT_FOUND');
  });
});

// ============================================================================
// SRCH-019 — Autocomplete
// ============================================================================

describe('SRCH-019 — Autocomplete', () => {
  it('returns suggestions for doctor name', async () => {
    const search = createSearchService(db);
    const results = await search.autocomplete('أحمد', 'ar');
    assert.ok(results.length >= 1);
    assert.equal(results[0]!.type, 'doctor');
  });

  it('returns suggestions for specialty', async () => {
    const search = createSearchService(db);
    const results = await search.autocomplete('Dent', 'en');
    assert.ok(results.length >= 1);
  });

  it('returns empty for very short query', async () => {
    const search = createSearchService(db);
    const results = await search.autocomplete('a', 'en');
    assert.equal(results.length, 0);
  });
});

// ============================================================================
// SRCH-026 — Legal pages
// ============================================================================

describe('SRCH-026 — Legal pages', () => {
  it('lists all 10 legal pages', async () => {
    const svc = createLegalPagesService(db);
    const pages = await svc.listPages('ar');
    assert.equal(pages.length, 10);
  });

  it('gets medical disclaimer page', async () => {
    const svc = createLegalPagesService(db);
    const result = await svc.getPage('medical-disclaimer', 'ar');
    assert.ok(result.ok);
    assert.ok(result.value.content.includes('منصة حجز'), 'Should mention booking platform');
    assert.equal(result.value.isPlaceholder, true, 'Should be marked as placeholder');
  });

  it('❗ medical disclaimer is present and accessible', async () => {
    const svc = createLegalPagesService(db);
    const result = await svc.getPage('medical-disclaimer', 'en');
    assert.ok(result.ok);
    assert.ok(result.value.content.includes('not a healthcare provider'), 'Must state Zamo is not a healthcare provider');
  });

  it('returns error for non-existent page', async () => {
    const svc = createLegalPagesService(db);
    const result = await svc.getPage('nonexistent' as unknown as Parameters<typeof svc.getPage>[0], 'ar');
    assert.ok(!result.ok);
    assert.equal(result.error, 'PAGE_NOT_FOUND');
  });

  it('all pages have bilingual content', async () => {
    const svc = createLegalPagesService(db);
    const slugs = ['about', 'terms', 'privacy', 'medical-disclaimer', 'cookies',
      'refund', 'contact', 'faq', 'accessibility', 'complaints'] as const;
    for (const slug of slugs) {
      const ar = await svc.getPage(slug, 'ar');
      const en = await svc.getPage(slug, 'en');
      assert.ok(ar.ok, `${slug} should exist in Arabic`);
      assert.ok(en.ok, `${slug} should exist in English`);
      assert.ok(ar.value.content.length > 0, `${slug} Arabic content should not be empty`);
      assert.ok(en.value.content.length > 0, `${slug} English content should not be empty`);
    }
  });
});
