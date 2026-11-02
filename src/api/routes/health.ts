/**
 * Health check routes — /api/health
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';
import type { AppConfig } from '../../config/env.ts';

// eslint-disable-next-line @typescript-eslint/require-await
export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    // @ts-expect-error — decorated
    const db = app.db as Db;
    // @ts-expect-error — decorated
    const config = app.config as AppConfig;

    try {
      const result = await db.query<{ now: string }>('SELECT now()::text AS now');
      return {
        status: 'healthy',
        timestamp: result.rows[0]?.now,
        version: '0.1.0',
        environment: config.NODE_ENV,
        checks: {
          database: 'connected',
        },
      };
    } catch {
      reply.status(503);
      return {
        status: 'unhealthy',
        checks: { database: 'disconnected' },
      };
    }
  });
}
