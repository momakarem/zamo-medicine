import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMigratedTestDb, asAppUser } from '../../db/testing.ts';
import type { Db } from '../../db/client.ts';
import { createCatalogService } from './catalog.ts';
import { createBranchServiceService } from './branch-service.ts';
import { createPricingService } from './pricing.ts';

/**
 * ZAMO-CAT-014/015/016 integration tests — catalog, branch services, pricing.
 *
 * Tests the full chain: specialties → services → branch_services → pricing.
 */

let db: Db;
let adminUserId: string;
let facilityId: string;
let branchId: string;

before(async () => {
  db = await createMigratedTestDb();

  // Create admin user
  const userRes = await db.query<{ id: string }>(
    `INSERT INTO users (phone, email, full_name) VALUES ('+966500000010', 'cat-admin@zamo.sa', 'Admin')
     RETURNING id`,
  );
  adminUserId = userRes.rows[0]!.id;
  await db.query(
    `INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'zamo_admin')`,
    [adminUserId],
  );

  // Create facility + branch for branch_services/pricing tests
  const facRes = await db.query<{ id: string }>(
    `INSERT INTO facilities (name_ar, name_en, status) VALUES ('عيادة القطالوج', 'Catalog Clinic', 'approved')
     RETURNING id`,
  );
  facilityId = facRes.rows[0]!.id;

  const brRes = await db.query<{ id: string }>(
    `INSERT INTO branches (facility_id, name_ar, name_en)
     VALUES ($1, 'فرع الرئيسي', 'Main Branch')
     RETURNING id`,
    [facilityId],
  );
  branchId = brRes.rows[0]!.id;

  // Create a facility_manager user
  const mgrRes = await db.query<{ id: string }>(
    `INSERT INTO users (phone, full_name) VALUES ('+966500000011', 'Manager')
     RETURNING id`,
  );
  await db.query(
    `INSERT INTO user_roles (user_id, role_code, facility_id) VALUES ($1, 'facility_manager', $2)`,
    [mgrRes.rows[0]!.id, facilityId],
  );
});

after(async () => {
  await db.close();
});

describe('ZAMO-CAT-014 — catalog (specialties & services)', () => {
  it('lists the 3 seeded specialties', async () => {
    const catalog = createCatalogService(db);
    const specs = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.listSpecialties(),
    );
    assert.equal(specs.length, 3);
    const slugs = specs.map((s) => s.slug).sort();
    assert.deepEqual(slugs, ['cosmetics', 'dentistry', 'dermatology']);
  });

  it('gets specialty by slug', async () => {
    const catalog = createCatalogService(db);
    const result = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.getSpecialty('dentistry'),
    );
    assert.ok(result.ok);
    assert.equal(result.value.name_ar, 'أسنان');
    assert.equal(result.value.name_en, 'Dentistry');
  });

  it('returns error for non-existent specialty', async () => {
    const catalog = createCatalogService(db);
    const result = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.getSpecialty('nonexistent'),
    );
    assert.ok(!result.ok);
    assert.equal(result.error, 'SPECIALTY_NOT_FOUND');
  });

  let dentistryId: string;

  it('creates a service under a specialty', async () => {
    const catalog = createCatalogService(db);

    // Get dentistry ID
    const spec = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.getSpecialty('dentistry'),
    );
    assert.ok(spec.ok);
    dentistryId = spec.value.id;

    const result = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.createService({
        specialtyId: dentistryId,
        nameAr: 'تنظيف أسنان',
        nameEn: 'Teeth Cleaning',
        slug: 'teeth-cleaning',
        defaultDurationMinutes: 45,
      }),
    );
    assert.ok(result.ok);
    assert.ok(result.value, 'service ID should be returned');
  });

  it('❗ duplicate slug fails', async () => {
    const catalog = createCatalogService(db);
    const result = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.createService({
        specialtyId: dentistryId,
        nameAr: 'تنظيف مكرر',
        nameEn: 'Duplicate Cleaning',
        slug: 'teeth-cleaning',  // Same slug
      }),
    );
    assert.ok(!result.ok);
    assert.equal(result.error, 'DUPLICATE_SLUG');
  });

  it('lists services by specialty', async () => {
    const catalog = createCatalogService(db);
    const services = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.listServices(dentistryId),
    );
    assert.ok(services.length >= 1);
    assert.ok(services.some((s) => s.slug === 'teeth-cleaning'));
  });

  it('requires bilingual names', async () => {
    const catalog = createCatalogService(db);
    // Empty name_ar should fail (CHECK constraint)
    await assert.rejects(
      () => asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
        catalog.createService({
          specialtyId: dentistryId,
          nameAr: '  ',  // Whitespace only
          nameEn: 'Valid',
          slug: 'empty-ar',
        }),
      ),
      /check/i,
    );
  });
});

describe('ZAMO-CAT-015 — branch services', () => {
  it('links a service to a branch', async () => {
    const catalog = createCatalogService(db);

    // Create a service first
    const spec = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.getSpecialty('dentistry'),
    );
    assert.ok(spec.ok);

    const svcResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.createService({
        specialtyId: spec.value.id,
        nameAr: 'حشو أسنان',
        nameEn: 'Dental Filling',
        slug: 'dental-filling',
        defaultDurationMinutes: 60,
      }),
    );
    assert.ok(svcResult.ok);

    const bsSvc = createBranchServiceService(db);
    const result = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      bsSvc.addServiceToBranch(
        { branchId, serviceId: svcResult.value, durationMinutes: 45 },
        adminUserId,
        facilityId,
      ),
    );
    assert.ok(result.ok);
    assert.ok(result.value, 'branch service ID should be returned');
  });

  it('❗ duplicate branch+service fails', async () => {
    const bsSvc = createBranchServiceService(db);
    // Get any existing branch service
    const list = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      bsSvc.listBranchServices(branchId),
    );
    assert.ok(list.length > 0);
    const existing = list[0]!;

    const result = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      bsSvc.addServiceToBranch(
        { branchId, serviceId: existing.service_id },
        adminUserId,
        facilityId,
      ),
    );
    assert.ok(!result.ok);
    assert.equal(result.error, 'DUPLICATE_ASSIGNMENT');
  });
});

describe('ZAMO-CAT-016 — pricing', () => {
  let branchServiceId: string;

  before(async () => {
    // Create a fresh branch service for pricing tests
    const catalog = createCatalogService(db);
    const spec = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.getSpecialty('dermatology'),
    );
    assert.ok(spec.ok);

    const svcResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      catalog.createService({
        specialtyId: spec.value.id,
        nameAr: 'فحص جلدية',
        nameEn: 'Skin Check',
        slug: 'skin-check',
      }),
    );
    assert.ok(svcResult.ok);

    const bsSvc = createBranchServiceService(db);
    const bsResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      bsSvc.addServiceToBranch(
        { branchId, serviceId: svcResult.value },
        adminUserId,
        facilityId,
      ),
    );
    assert.ok(bsResult.ok);
    branchServiceId = bsResult.value;
  });

  it('proposes a price → pending_approval', async () => {
    const pricing = createPricingService(db);
    const result = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.proposePrice(
        { branchServiceId, priceType: 'fixed', amount: '150.00' },
        adminUserId,
        facilityId,
      ),
    );
    assert.ok(result.ok);

    // Verify status
    const history = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.getPriceHistory(branchServiceId),
    );
    assert.ok(history.length > 0);
    assert.equal(history[0]!.status, 'pending_approval');
  });

  it('approves a price → closes previous active price', async () => {
    const pricing = createPricingService(db);

    // Propose a price
    const p1 = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.proposePrice(
        { branchServiceId, priceType: 'fixed', amount: '200.00' },
        adminUserId,
        facilityId,
      ),
    );
    assert.ok(p1.ok);

    // Approve it
    const approveResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.approvePrice(p1.value, adminUserId, facilityId),
    );
    assert.ok(approveResult.ok);

    // Verify current price
    const current = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.getCurrentPrice(branchServiceId),
    );
    assert.ok(current.ok);
    assert.equal(current.value.amount, '200.00');
    assert.equal(current.value.status, 'approved');
  });

  it('rejects a price with reason', async () => {
    const pricing = createPricingService(db);

    const p = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.proposePrice(
        { branchServiceId, priceType: 'fixed', amount: '999.00' },
        adminUserId,
        facilityId,
      ),
    );
    assert.ok(p.ok);

    const rejectResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.rejectPrice(p.value, adminUserId, 'Too expensive', facilityId),
    );
    assert.ok(rejectResult.ok);
  });

  it('❗ reject without reason fails', async () => {
    const pricing = createPricingService(db);

    const p = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.proposePrice(
        { branchServiceId, priceType: 'fixed', amount: '50.00' },
        adminUserId,
        facilityId,
      ),
    );
    assert.ok(p.ok);

    const rejectResult = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.rejectPrice(p.value, adminUserId, '', facilityId),
    );
    assert.ok(!rejectResult.ok);
    assert.equal(rejectResult.error, 'REASON_REQUIRED');
  });

  it('uses numeric precision for amounts (not float)', async () => {
    const pricing = createPricingService(db);

    const p = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.proposePrice(
        { branchServiceId, priceType: 'fixed', amount: '99.99' },
        adminUserId,
        facilityId,
      ),
    );
    assert.ok(p.ok);

    await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.approvePrice(p.value, adminUserId, facilityId),
    );

    const current = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.getCurrentPrice(branchServiceId),
    );
    assert.ok(current.ok);
    // numeric returns exact string — no floating-point drift
    assert.equal(current.value.amount, '99.99');
  });

  it('range price requires amount_max', async () => {
    const pricing = createPricingService(db);

    const result = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.proposePrice(
        { branchServiceId, priceType: 'range', amount: '100.00' /* no amountMax */ },
        adminUserId,
        facilityId,
      ),
    );
    assert.ok(!result.ok);
    assert.equal(result.error, 'INVALID_PRICE_TYPE');
  });

  it('price history is ordered by created_at DESC', async () => {
    const pricing = createPricingService(db);
    const history = await asAppUser(db, { userId: adminUserId, roleCode: 'zamo_admin' }, () =>
      pricing.getPriceHistory(branchServiceId),
    );
    assert.ok(history.length >= 2, 'should have multiple price records');
    // Verify descending order
    for (let i = 1; i < history.length; i++) {
      assert.ok(history[i - 1]!.created_at >= history[i]!.created_at);
    }
  });
});
