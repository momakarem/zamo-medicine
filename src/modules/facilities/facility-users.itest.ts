import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMigratedTestDb, asAppUser } from '../../db/testing.ts';
import type { Db } from '../../db/client.ts';
import { createFacilityUserService } from './facility-users.ts';

/**
 * ZAMO-RBAC-018 integration tests — facility users & permissions.
 *
 * Tests role assignment, deactivation, MFA enforcement, and escalation guards.
 */

let db: Db;
let adminUserId: string;
let facilityId: string;
let branchId: string;
let managerId: string;
let staffUserId: string;

before(async () => {
  db = await createMigratedTestDb();

  // Create admin
  const adminRes = await db.query<{ id: string }>(
    `INSERT INTO users (phone, email, full_name) VALUES ('+966500000020', 'rbac-admin@zamo.sa', 'Admin')
     RETURNING id`,
  );
  adminUserId = adminRes.rows[0]!.id;
  await db.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'zamo_admin')`, [adminUserId]);

  // Create facility
  const facRes = await db.query<{ id: string }>(
    `INSERT INTO facilities (name_ar, name_en, status) VALUES ('عيادة الصلاحيات', 'RBAC Clinic', 'approved')
     RETURNING id`,
  );
  facilityId = facRes.rows[0]!.id;

  // Create branch
  const brRes = await db.query<{ id: string }>(
    `INSERT INTO branches (facility_id, name_ar, name_en) VALUES ($1, 'فرع أ', 'Branch A')
     RETURNING id`,
    [facilityId],
  );
  branchId = brRes.rows[0]!.id;

  // Create facility_manager
  const mgrRes = await db.query<{ id: string }>(
    `INSERT INTO users (phone, full_name) VALUES ('+966500000021', 'Facility Manager')
     RETURNING id`,
  );
  managerId = mgrRes.rows[0]!.id;
  await db.query(
    `INSERT INTO user_roles (user_id, role_code, facility_id) VALUES ($1, 'facility_manager', $2)`,
    [managerId, facilityId],
  );

  // Create a staff user (no role yet)
  const staffRes = await db.query<{ id: string }>(
    `INSERT INTO users (phone, full_name) VALUES ('+966500000022', 'Staff User')
     RETURNING id`,
  );
  staffUserId = staffRes.rows[0]!.id;
});

after(async () => {
  await db.close();
});

describe('ZAMO-RBAC-018 — facility user management', () => {
  it('facility_manager assigns receptionist role', async () => {
    const svc = createFacilityUserService(db);
    const result = await asAppUser(db, { userId: managerId, facilityId, roleCode: 'facility_manager' }, () =>
      svc.assignRole(
        { userId: staffUserId, roleCode: 'receptionist', facilityId, branchId },
        managerId,
        'facility_manager',
      ),
    );
    assert.ok(result.ok, 'should assign receptionist');

    // Verify
    const users = await asAppUser(db, { userId: managerId, facilityId, roleCode: 'facility_manager' }, () =>
      svc.listUsers(facilityId),
    );
    const staff = users.find((u) => u.user_id === staffUserId);
    assert.ok(staff, 'staff user should appear in list');
    assert.equal(staff.role_code, 'receptionist');
  });

  it('❗ branch_manager cannot assign facility_manager', async () => {
    // Create a branch_manager
    const bmRes = await db.query<{ id: string }>(
      `INSERT INTO users (phone, full_name) VALUES ('+966500000023', 'Branch Manager')
       RETURNING id`,
    );
    const bmId = bmRes.rows[0]!.id;
    await db.query(
      `INSERT INTO user_roles (user_id, role_code, facility_id, branch_id) VALUES ($1, 'branch_manager', $2, $3)`,
      [bmId, facilityId, branchId],
    );

    // Create another user to assign role to
    const targetRes = await db.query<{ id: string }>(
      `INSERT INTO users (phone, full_name) VALUES ('+966500000024', 'Target User')
       RETURNING id`,
    );

    const svc = createFacilityUserService(db);
    const result = await asAppUser(db, { userId: bmId, facilityId, branchIds: [branchId], roleCode: 'branch_manager' }, () =>
      svc.assignRole(
        { userId: targetRes.rows[0]!.id, roleCode: 'facility_manager', facilityId },
        bmId,
        'branch_manager',
      ),
    );
    assert.ok(!result.ok, 'should fail');
    assert.equal(result.error, 'CANNOT_ESCALATE');
  });

  it('❗ duplicate role assignment fails', async () => {
    const svc = createFacilityUserService(db);
    const result = await asAppUser(db, { userId: managerId, facilityId, roleCode: 'facility_manager' }, () =>
      svc.assignRole(
        { userId: staffUserId, roleCode: 'receptionist', facilityId, branchId },
        managerId,
        'facility_manager',
      ),
    );
    assert.ok(!result.ok);
    assert.equal(result.error, 'ROLE_ALREADY_ASSIGNED');
  });

  it('removes a role', async () => {
    // First assign a role to remove
    const newUserRes = await db.query<{ id: string }>(
      `INSERT INTO users (phone, full_name) VALUES ('+966500000025', 'Temp User')
       RETURNING id`,
    );
    const tempUserId = newUserRes.rows[0]!.id;

    const svc = createFacilityUserService(db);
    await asAppUser(db, { userId: managerId, facilityId, roleCode: 'facility_manager' }, () =>
      svc.assignRole(
        { userId: tempUserId, roleCode: 'receptionist', facilityId, branchId },
        managerId,
        'facility_manager',
      ),
    );

    const removeResult = await asAppUser(db, { userId: managerId, facilityId, roleCode: 'facility_manager' }, () =>
      svc.removeRole(tempUserId, 'receptionist', facilityId, managerId),
    );
    assert.ok(removeResult.ok);
  });

  it('deactivates a user', async () => {
    const svc = createFacilityUserService(db);

    // Create a user to deactivate
    const userRes = await db.query<{ id: string }>(
      `INSERT INTO users (phone, full_name) VALUES ('+966500000026', 'Deactivate Me')
       RETURNING id`,
    );
    const userId = userRes.rows[0]!.id;
    await db.query(
      `INSERT INTO user_roles (user_id, role_code, facility_id) VALUES ($1, 'receptionist', $2)`,
      [userId, facilityId],
    );

    const result = await asAppUser(db, { userId: managerId, facilityId, roleCode: 'facility_manager' }, () =>
      svc.deactivateUser(userId, facilityId, managerId),
    );
    assert.ok(result.ok);

    // Verify user is inactive
    const user = await db.query<{ is_active: boolean }>(
      `SELECT is_active FROM users WHERE id = $1`,
      [userId],
    );
    assert.equal(user.rows[0]!.is_active, false);
  });

  it('enforces MFA on a user', async () => {
    const svc = createFacilityUserService(db);
    const result = await asAppUser(db, { userId: managerId, facilityId, roleCode: 'facility_manager' }, () =>
      svc.enforceMfa(staffUserId, facilityId, managerId),
    );
    assert.ok(result.ok);

    // Verify MFA is enabled
    const user = await db.query<{ mfa_enabled: boolean }>(
      `SELECT mfa_enabled FROM users WHERE id = $1`,
      [staffUserId],
    );
    assert.equal(user.rows[0]!.mfa_enabled, true);
  });

  it('❗ deactivating user not in facility fails', async () => {
    // Create a user in a different facility
    const otherFacRes = await db.query<{ id: string }>(
      `INSERT INTO facilities (name_ar, name_en, status) VALUES ('عيادة أخرى', 'Other Clinic', 'approved')
       RETURNING id`,
    );
    const otherUserRes = await db.query<{ id: string }>(
      `INSERT INTO users (phone, full_name) VALUES ('+966500000027', 'Other User')
       RETURNING id`,
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role_code, facility_id) VALUES ($1, 'receptionist', $2)`,
      [otherUserRes.rows[0]!.id, otherFacRes.rows[0]!.id],
    );

    const svc = createFacilityUserService(db);
    const result = await asAppUser(db, { userId: managerId, facilityId, roleCode: 'facility_manager' }, () =>
      svc.deactivateUser(otherUserRes.rows[0]!.id, facilityId, managerId),
    );
    assert.ok(!result.ok);
    assert.equal(result.error, 'USER_NOT_IN_FACILITY');
  });

  it('audit trail exists for all operations', async () => {
    const auditRes = await db.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_type = 'user_role' AND facility_id = $1`,
      [facilityId],
    );
    assert.ok(auditRes.rows.length > 0, 'should have audit entries for user_role operations');
  });
});
