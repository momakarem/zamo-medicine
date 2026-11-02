/**
 * Production PostgreSQL adapter implementing the Db interface.
 * Uses the `pg` package (node-postgres).
 */

import pg from 'pg';
import type { Db, Queryable, QueryResult } from './client.ts';

const { Pool } = pg;

export class PgDb implements Db {
  private pool: pg.Pool;

  private constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  static async connect(connectionString: string): Promise<PgDb> {
    const pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    // Verify connectivity
    const client = await pool.connect();
    client.release();

    return new PgDb(pool);
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params as unknown[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Queryable = {
        async query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>> {
          const result = await client.query(sql, params as unknown[]);
          return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
        },
        async exec(sql: string): Promise<void> {
          await client.query(sql);
        },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
