import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable, QueryResult } from './client.ts';
import { migrateUp } from './migrate.ts';

/**
 * ZAMO test database.
 *
 * PGlite is real PostgreSQL (18.x) compiled to WASM, so constraints, triggers,
 * roles and Row-Level Security behave exactly as they will in production. That
 * matters: the tenant-isolation tests in ZAMO-RBAC-010 are only meaningful if
 * RLS is genuinely being exercised.
 */
class PgliteDb implements Db {
  // Explicit field rather than a TS parameter property: Node's type-stripping
  // loader (used by the integration test runner) does not support those.
  private readonly pg: PGlite;

  constructor(pg: PGlite) {
    this.pg = pg;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const res = await this.pg.query<T>(sql, params);
    return { rows: res.rows, rowCount: res.rows.length };
  }

  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    // PGlite serialises access, so a simple explicit transaction is correct.
    await this.pg.exec('BEGIN');
    try {
      const out = await fn(this);
      await this.pg.exec('COMMIT');
      return out;
    } catch (e) {
      await this.pg.exec('ROLLBACK');
      throw e;
    }
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

/** A fresh, empty in-memory PostgreSQL. */
export async function createTestDb(): Promise<Db> {
  // PGlite.create() is the typed async factory; `new PGlite()` is thenable at
  // runtime but not typed as such.
  const pg = await PGlite.create();
  return new PgliteDb(pg);
}

/** A fresh in-memory PostgreSQL with all migrations applied. */
export async function createMigratedTestDb(): Promise<Db> {
  const db = await createTestDb();
  await migrateUp(db);
  return db;
}

/**
 * Runs `fn` as the non-superuser application role, with the caller's identity
 * published as session variables so RLS policies can see it.
 *
 * Superusers bypass RLS, so every authorization test MUST go through here —
 * otherwise it would pass regardless of whether the policies are correct.
 */
export async function asAppUser<T>(
  db: Db,
  ctx: { userId?: string; facilityId?: string | null; branchIds?: string[]; roleCode?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const lit = (v: string | null | undefined): string =>
    v === null || v === undefined ? `''` : `'${v.replaceAll("'", "''")}'`;

  await db.exec(`
    SET ROLE zamo_app;
    SELECT set_config('zamo.user_id',     ${lit(ctx.userId)}, false);
    SELECT set_config('zamo.facility_id', ${lit(ctx.facilityId)}, false);
    SELECT set_config('zamo.branch_ids',  ${lit((ctx.branchIds ?? []).join(','))}, false);
    SELECT set_config('zamo.role_code',   ${lit(ctx.roleCode)}, false);
  `);
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE');
  }
}
