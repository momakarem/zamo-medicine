import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from './client.ts';
import { createTestDb } from './testing.ts';
import { migrateUp, migrateDown, migrationStatus, loadMigrations } from './migrate.ts';

/**
 * ZAMO-DB-003 — database integration tests.
 *
 * Runs on the built-in node:test runner rather than Vitest (DEC-021): PGlite
 * boots a real PostgreSQL in WASM, and Vitest's worker pool plus transform
 * pipeline pushes total memory past what this machine has free. node:test is
 * light enough to host it. The tests below therefore exercise genuine
 * PostgreSQL constraints, triggers and RLS — not a mock.
 *
 * One PGlite instance per file; state is reset between tests.
 */

let db: Db;

before(async () => {
  db = await createTestDb();
});

after(async () => {
  await db.close();
});

/** Ensure the schema exists, then clear mutable data. */
async function resetToMigrated(): Promise<void> {
  await migrateUp(db);
  await db.exec(`
    TRUNCATE TABLE user_roles, role_permissions, branches, facilities, users
      RESTART IDENTITY CASCADE;
  `);
}

/** Drop everything and leave the database empty. */
async function resetToEmpty(): Promise<void> {
  await migrateDown(db, 99);
}

/** Assert that a database statement is rejected. */
async function rejects(fn: () => Promise<unknown>, what: string): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert.equal(threw, true, `expected the database to REJECT: ${what}`);
}

const newFacility = async (nameEn = 'Test Facility'): Promise<string> => {
  const r = await db.query<{ id: string }>(
    `INSERT INTO facilities (name_ar, name_en) VALUES ($1, $2) RETURNING id`,
    ['منشأة اختبار', nameEn],
  );
  return r.rows[0]!.id;
};

// ---------------------------------------------------------------------------

describe('ZAMO-DB-003 :: migrations', () => {
  beforeEach(resetToEmpty);

  it('applies migrations on a clean database', async () => {
    const applied = await migrateUp(db);
    assert.ok(applied.includes('0001_core_identity'));

    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = tables.rows.map((r) => r.table_name);
    for (const expected of [
      'facilities',
      'branches',
      'users',
      'roles',
      'permissions',
      'role_permissions',
      'user_roles',
    ]) {
      assert.ok(names.includes(expected), `missing table: ${expected}`);
    }
  });

  it('is idempotent — running up twice applies nothing the second time', async () => {
    await migrateUp(db);
    const second = await migrateUp(db);
    assert.deepEqual(second, []);
  });

  it('rolls back and re-applies cleanly (down → up)', async () => {
    await migrateUp(db);

    // Revert ALL migrations so the schema is completely torn down.
    const reverted = await migrateDown(db, 99);
    assert.ok(reverted.includes('0001_core_identity'));

    const gone = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name='facilities'`,
    );
    assert.equal(gone.rowCount, 0, 'down migration must drop facilities');

    // Re-applying proves the down migration left no debris behind.
    const reapplied = await migrateUp(db);
    assert.ok(reapplied.includes('0001_core_identity'));

    const back = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name='facilities'`,
    );
    assert.equal(back.rowCount, 1);
  });

  it('reports migration status', async () => {
    const before_ = await migrationStatus(db);
    assert.ok(before_.every((m) => !m.applied));

    await migrateUp(db);

    const after_ = await migrationStatus(db);
    assert.ok(after_.every((m) => m.applied));
  });

  it('every up migration has a matching non-empty down migration', () => {
    const migrations = loadMigrations();
    assert.ok(migrations.length > 0);
    for (const m of migrations) {
      assert.ok(m.downSql.trim().length > 0, `${m.id} down migration is empty`);
    }
  });
});

// ---------------------------------------------------------------------------

describe('ZAMO-DB-003 :: schema constraints', () => {
  beforeEach(resetToMigrated);

  it('creates a facility with the approved default status (A-32: pending review)', async () => {
    const id = await newFacility();
    const r = await db.query<{ status: string }>('SELECT status FROM facilities WHERE id = $1', [
      id,
    ]);
    assert.equal(r.rows[0]!.status, 'pending_review');
  });

  it('REJECTS an unknown facility status', async () => {
    await rejects(
      () => db.query(`INSERT INTO facilities (name_ar,name_en,status) VALUES ('أ','A','live')`),
      'facility status outside the approved set',
    );
  });

  it('REJECTS a blank facility name', async () => {
    await rejects(
      () => db.query(`INSERT INTO facilities (name_ar, name_en) VALUES ('   ', 'A')`),
      'blank facility name',
    );
  });

  // --- Foreign keys prevent orphans ---------------------------------------

  it('REJECTS a branch pointing at a non-existent facility', async () => {
    await rejects(
      () =>
        db.query(
          `INSERT INTO branches (facility_id, name_ar, name_en)
           VALUES ('00000000-0000-0000-0000-000000000000','فرع','Branch')`,
        ),
      'orphan branch',
    );
  });

  it('REJECTS deleting a facility that still has branches', async () => {
    const fid = await newFacility();
    await db.query(`INSERT INTO branches (facility_id,name_ar,name_en) VALUES ($1,'فرع','Br')`, [
      fid,
    ]);
    await rejects(
      () => db.query('DELETE FROM facilities WHERE id = $1', [fid]),
      'deleting a facility that still has branches',
    );
  });

  // --- Uniqueness ----------------------------------------------------------

  it('allows the same branch name in two different facilities', async () => {
    const a = await newFacility('Facility A');
    const b = await newFacility('Facility B');
    await db.query(
      `INSERT INTO branches (facility_id,name_ar,name_en) VALUES ($1,'الملقا','Malqa')`,
      [a],
    );
    await db.query(
      `INSERT INTO branches (facility_id,name_ar,name_en) VALUES ($1,'الملقا','Malqa')`,
      [b],
    );
    const r = await db.query(`SELECT 1 FROM branches WHERE name_en='Malqa'`);
    assert.equal(r.rowCount, 2);
  });

  it('REJECTS a duplicate branch name inside one facility', async () => {
    const a = await newFacility();
    await db.query(
      `INSERT INTO branches (facility_id,name_ar,name_en) VALUES ($1,'الملقا','Malqa')`,
      [a],
    );
    await rejects(
      () =>
        db.query(
          `INSERT INTO branches (facility_id,name_ar,name_en) VALUES ($1,'الملقا','Malqa')`,
          [a],
        ),
      'duplicate branch name within one facility',
    );
  });

  it('REJECTS a duplicate user phone', async () => {
    await db.query(`INSERT INTO users (phone) VALUES ('+966500000001')`);
    await rejects(
      () => db.query(`INSERT INTO users (phone) VALUES ('+966500000001')`),
      'duplicate phone number',
    );
  });

  it('REJECTS a user with neither phone nor email', async () => {
    await rejects(
      () => db.query(`INSERT INTO users (full_name) VALUES ('No Contact')`),
      'user with no identifier',
    );
  });

  // --- Approved decision A-33: patients have no password -------------------

  it('allows a patient user with no password (A-33)', async () => {
    const r = await db.query<{ password_hash: string | null }>(
      `INSERT INTO users (phone) VALUES ('+966500000002') RETURNING password_hash`,
    );
    assert.equal(r.rows[0]!.password_hash, null);
  });

  // --- Role scoping --------------------------------------------------------

  it('seeds the approved role set', async () => {
    const r = await db.query<{ code: string }>('SELECT code FROM roles ORDER BY code');
    const codes = r.rows.map((x) => x.code);
    for (const expected of [
      'zamo_admin',
      'facility_manager',
      'branch_manager',
      'receptionist',
      'doctor',
      'accountant',
      'patient',
    ]) {
      assert.ok(codes.includes(expected), `missing seeded role: ${expected}`);
    }
  });

  it('REJECTS a branch-scoped role assignment with no facility', async () => {
    const u = await db.query<{ id: string }>(
      `INSERT INTO users (phone) VALUES ('+966500000003') RETURNING id`,
    );
    const fid = await newFacility();
    const b = await db.query<{ id: string }>(
      `INSERT INTO branches (facility_id,name_ar,name_en) VALUES ($1,'فرع','Br') RETURNING id`,
      [fid],
    );
    await rejects(
      () =>
        db.query(
          `INSERT INTO user_roles (user_id, role_code, branch_id) VALUES ($1,'receptionist',$2)`,
          [u.rows[0]!.id, b.rows[0]!.id],
        ),
      'branch-scoped role with no facility',
    );
  });

  it('REJECTS an unknown role code', async () => {
    const u = await db.query<{ id: string }>(
      `INSERT INTO users (phone) VALUES ('+966500000004') RETURNING id`,
    );
    await rejects(
      () =>
        db.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1,'superuser')`, [
          u.rows[0]!.id,
        ]),
      'role code outside the approved set',
    );
  });

  // --- updated_at trigger --------------------------------------------------

  it('advances updated_at on update', async () => {
    const id = await newFacility();
    const before_ = await db.query<{ updated_at: string }>(
      'SELECT updated_at FROM facilities WHERE id=$1',
      [id],
    );
    await db.query(`UPDATE facilities SET name_en='Renamed' WHERE id=$1`, [id]);
    const after_ = await db.query<{ updated_at: string }>(
      'SELECT updated_at FROM facilities WHERE id=$1',
      [id],
    );
    assert.ok(
      new Date(after_.rows[0]!.updated_at).getTime() >=
        new Date(before_.rows[0]!.updated_at).getTime(),
    );
  });
});

// ---------------------------------------------------------------------------

describe('ZAMO-DB-003 :: data-minimisation guards (A-48 / A-49 / DEC-014)', () => {
  beforeEach(resetToMigrated);

  const FORBIDDEN = [
    'diagnosis',
    'diagnostic',
    'symptom',
    'prescription',
    'medication',
    'dosage',
    'clinical',
    'medical_record',
    'medical_history',
    'allergy',
    'blood_type',
    'lab_result',
    'icd',
    'chief_complaint',
    'vitals',
  ];

  it('the live schema contains NO clinical column', async () => {
    const cols = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );
    const offenders = cols.rows
      .filter((c) => FORBIDDEN.some((f) => c.column_name.toLowerCase().includes(f)))
      .map((o) => `${o.table_name}.${o.column_name}`);
    assert.deepEqual(
      offenders,
      [],
      'clinical columns are forbidden by approved decisions A-48 / A-49',
    );
  });

  it('the live schema contains NO clinical table', async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`,
    );
    const offenders = tables.rows
      .filter((t) => FORBIDDEN.some((f) => t.table_name.toLowerCase().includes(f)))
      .map((o) => o.table_name);
    assert.deepEqual(offenders, []);
  });

  it('no money-like column uses a floating-point type', async () => {
    // Currently vacuous (financial tables are blocked on OQ-007..OQ-012), but
    // this is a standing regression guard for when they land.
    const cols = await db.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema='public'`,
    );
    const wrong = cols.rows
      .filter((c) =>
        /(amount|price|total|commission|fee|balance|collected|vat|tax|discount)/i.test(
          c.column_name,
        ),
      )
      .filter((c) => /double precision|real|float/i.test(c.data_type))
      .map((c) => `${c.table_name}.${c.column_name}:${c.data_type}`);
    assert.deepEqual(wrong, [], 'money must use numeric, never floating point');
  });
});
