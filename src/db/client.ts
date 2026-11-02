/**
 * ZAMO-DB-003 — database access seam.
 *
 * Both production (node-postgres against PostgreSQL) and tests (PGlite, which
 * is real PostgreSQL compiled to WASM) implement this one interface, so the
 * behaviour under test is genuine PostgreSQL behaviour — including
 * Row-Level Security, constraints and triggers.
 */

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Multi-statement DDL. Not parameterised — never build this from user input. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Session variables that carry the caller's identity into the database so
 * RLS policies can enforce tenant and branch scope (DEC-004).
 * `set_config(..., true)` makes them transaction-local.
 */
export const SESSION_VARS = {
  userId: 'zamo.user_id',
  facilityId: 'zamo.facility_id',
  branchIds: 'zamo.branch_ids',
  roleCode: 'zamo.role_code',
} as const;
