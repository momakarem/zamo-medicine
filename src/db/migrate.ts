import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db, Queryable } from './client.ts';

/**
 * ZAMO-DB-003 — migration runner.
 *
 * Deliberately small and explicit: migrations are plain SQL files applied in
 * filename order inside a transaction, and each one has a matching `.down.sql`.
 * Financial correctness later depends on migrations being reviewable, so there
 * is no code generation and no implicit schema diffing here.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface Migration {
  id: string;
  upSql: string;
  downSql: string;
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.up.sql'));
  return files.sort().map((f) => {
    const id = f.replace(/\.up\.sql$/, '');
    return {
      id,
      upSql: readFileSync(join(dir, f), 'utf8'),
      downSql: readFileSync(join(dir, `${id}.down.sql`), 'utf8'),
    };
  });
}

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  );
`;

async function appliedIds(db: Queryable): Promise<Set<string>> {
  const res = await db.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
  return new Set(res.rows.map((r) => r.id));
}

/** Applies every migration that has not run yet. Returns the ids applied. */
export async function migrateUp(db: Db, migrations = loadMigrations()): Promise<string[]> {
  await db.exec(MIGRATIONS_TABLE);
  const done = await appliedIds(db);
  const applied: string[] = [];

  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.upSql);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
    });
    applied.push(m.id);
  }
  return applied;
}

/** Rolls back the most recent `steps` migrations. Returns the ids reverted. */
export async function migrateDown(
  db: Db,
  steps = 1,
  migrations = loadMigrations(),
): Promise<string[]> {
  await db.exec(MIGRATIONS_TABLE);
  const done = await appliedIds(db);
  const reverted: string[] = [];

  const toRevert = migrations
    .filter((m) => done.has(m.id))
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, steps);

  for (const m of toRevert) {
    await db.transaction(async (tx) => {
      await tx.exec(m.downSql);
      await tx.query('DELETE FROM schema_migrations WHERE id = $1', [m.id]);
    });
    reverted.push(m.id);
  }
  return reverted;
}

export async function migrationStatus(db: Db): Promise<{ id: string; applied: boolean }[]> {
  await db.exec(MIGRATIONS_TABLE);
  const done = await appliedIds(db);
  return loadMigrations().map((m) => ({ id: m.id, applied: done.has(m.id) }));
}
