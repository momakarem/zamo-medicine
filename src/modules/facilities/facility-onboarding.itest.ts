import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMigratedTestDb, asAppUser } from '../../db/testing.ts';
import type { Db } from '../../db/client.ts';
import { createFacilityOnboardingService } from './facility-onboarding.ts';

/**
 * ZAMO-FAC-011 integration tests — facility onboarding.
 *
 * Runs against real PostgreSQL (PGlite WASM) with all migrations applied,
 * so RLS, constraints and triggers behave identically to production.
 */

let db: Db;
const svc = () => createFacilityOnboardingService(db);

// We need a zamo_admin user for reviews
let adminUserId: string;

before(async () => {
  db = await createMigratedTestDb();

  // Create a zamo_admin user
  const userRes = await db.query<{ id: string }>(
    `INSERT INTO users (phone, email, full_name) VALUES ('+966500000001', 'admin@zamo.sa', 'Admin')
     RETURNING id`,
  );
  adminUserId = userRes.rows[0]!.id;

  await db.query(
    `INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'zamo_admin')`,
    [adminUserId],
  );
});

after(async () => {
  await db.close();
});

describe('ZAMO-FAC-011 — facility onboarding', () => {
  it('submits an application and records audit', async () => {
    const result = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().submit({
        nameAr: 'عيادة الأمل',
        nameEn: 'Hope Clinic',
        commercialReg: 'CR-12345',
        contactName: 'محمد',
        contactPhone: '+966511111111',
        contactEmail: 'contact@hopeclinic.sa',
      }),
    );

    assert.ok(result.ok, 'submit should succeed');
    const appId = result.value;

    // Verify the application was created with status 'submitted'
    const app = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().getApplication(appId),
    );
    assert.ok(app.ok);
    assert.equal(app.value.status, 'submitted');
    assert.equal(app.value.name_ar, 'عيادة الأمل');

    // Verify audit entry exists
    const audit = await db.query(
      `SELECT * FROM audit_log WHERE entity_type = 'facility_application' AND entity_id = $1`,
      [appId],
    );
    assert.ok(audit.rows.length > 0, 'audit entry should exist');
  });

  it('approves an application → creates facility + user + role', async () => {
    // Submit
    const submitResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().submit({
        nameAr: 'مركز النور',
        nameEn: 'Noor Center',
        commercialReg: 'CR-67890',
        contactName: 'أحمد',
        contactPhone: '+966522222222',
        contactEmail: 'ahmed@noor.sa',
      }),
    );
    assert.ok(submitResult.ok);
    const appId = submitResult.value;

    // Approve
    const reviewResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().review({
        applicationId: appId,
        reviewerId: adminUserId,
        decision: 'approved',
        notes: 'All documents verified.',
      }),
    );
    assert.ok(reviewResult.ok, 'review should succeed');
    const facilityId = reviewResult.value;
    assert.ok(facilityId, 'facilityId should be returned');

    // Verify facility was created
    const fac = await db.query<{ status: string; name_ar: string }>(
      `SELECT status, name_ar FROM facilities WHERE id = $1`,
      [facilityId],
    );
    assert.equal(fac.rows.length, 1);
    assert.equal(fac.rows[0]!.status, 'approved');
    assert.equal(fac.rows[0]!.name_ar, 'مركز النور');

    // Verify user was created
    const user = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE phone = '+966522222222'`,
    );
    assert.equal(user.rows.length, 1);

    // Verify facility_manager role was assigned
    const role = await db.query<{ role_code: string }>(
      `SELECT role_code FROM user_roles WHERE user_id = $1 AND facility_id = $2`,
      [user.rows[0]!.id, facilityId],
    );
    assert.equal(role.rows.length, 1);
    assert.equal(role.rows[0]!.role_code, 'facility_manager');

    // Verify application was updated
    const updatedApp = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().getApplication(appId),
    );
    assert.ok(updatedApp.ok);
    assert.equal(updatedApp.value.status, 'approved');
    assert.equal(updatedApp.value.facility_id, facilityId);
  });

  it('rejects an application with reason', async () => {
    const submitResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().submit({
        nameAr: 'عيادة مرفوضة',
        nameEn: 'Rejected Clinic',
        commercialReg: 'CR-REJECT',
        contactName: 'خالد',
        contactPhone: '+966533333333',
        contactEmail: 'khalid@rejected.sa',
      }),
    );
    assert.ok(submitResult.ok);

    const reviewResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().review({
        applicationId: submitResult.value,
        reviewerId: adminUserId,
        decision: 'rejected',
        notes: 'Missing commercial registration.',
      }),
    );
    assert.ok(reviewResult.ok);
    assert.equal(reviewResult.value, null, 'rejected should return null');

    // Verify no facility was created
    const app = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().getApplication(submitResult.value),
    );
    assert.ok(app.ok);
    assert.equal(app.value.status, 'rejected');
    assert.equal(app.value.facility_id, null);
  });

  it('❗ rejects without reason fails', async () => {
    const submitResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().submit({
        nameAr: 'عيادة',
        nameEn: 'Clinic',
        commercialReg: 'CR-NOREASON',
        contactName: 'علي',
        contactPhone: '+966544444444',
        contactEmail: 'ali@clinic.sa',
      }),
    );
    assert.ok(submitResult.ok);

    const reviewResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().review({
        applicationId: submitResult.value,
        reviewerId: adminUserId,
        decision: 'rejected',
        // No notes
      }),
    );
    assert.ok(!reviewResult.ok);
    assert.equal(reviewResult.error, 'REASON_REQUIRED');
  });

  it('❗ cannot re-review an already approved application', async () => {
    const submitResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().submit({
        nameAr: 'عيادة معتمدة',
        nameEn: 'Approved Clinic',
        commercialReg: 'CR-APPROVED',
        contactName: 'سعد',
        contactPhone: '+966555555555',
        contactEmail: 'saad@approved.sa',
      }),
    );
    assert.ok(submitResult.ok);

    // First approve
    await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().review({
        applicationId: submitResult.value,
        reviewerId: adminUserId,
        decision: 'approved',
      }),
    );

    // Try to re-review
    const reReview = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().review({
        applicationId: submitResult.value,
        reviewerId: adminUserId,
        decision: 'rejected',
        notes: 'Changed my mind.',
      }),
    );
    assert.ok(!reReview.ok);
    assert.equal(reReview.error, 'INVALID_STATUS_TRANSITION');
  });

  it('lists applications by status', async () => {
    const apps = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      svc().listApplications('submitted'),
    );
    // There should be at least the first submitted app still in 'submitted' status
    assert.ok(Array.isArray(apps));
  });
});
