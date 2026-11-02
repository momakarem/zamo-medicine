/**
 * ZAMO API Server — Fastify HTTP layer.
 *
 * Bridges the modular-monolith services to REST endpoints.
 * Entry point: `npx tsx src/api/server.ts`
 *
 * Architecture:
 *   server.ts (this file) → registers route plugins
 *   routes/*.ts            → each file = one domain of endpoints
 *   middleware/auth.ts     → session validation + RLS injection
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type AppConfig } from '../config/env.ts';
import { PgDb } from '../db/pg.ts';
import { migrateUp } from '../db/migrate.ts';
import type { Db } from '../db/client.ts';

// Route plugins
import { authRoutes } from './routes/auth.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { bookingRoutes } from './routes/booking.ts';
import { searchRoutes } from './routes/search.ts';
import { healthRoutes } from './routes/health.ts';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function buildApp(config?: AppConfig) {
  const cfg = config ?? loadConfig();
  const db: Db = await PgDb.connect(cfg.DATABASE_URL);

  // Auto-migration: apply pending migrations on startup (production-safe)
  if (cfg.AUTO_MIGRATE === 'true') {
    try {
      const applied = await migrateUp(db);
      if (applied.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`✓ Migrations applied: ${applied.join(', ')}`);
      } else {
        // eslint-disable-next-line no-console
        console.log('✓ No pending migrations.');
      }
    } catch (migrationError) {
      // eslint-disable-next-line no-console
      console.error('❌ Migration failed:', migrationError);
      // eslint-disable-next-line no-console
      console.error('Fix the migration and redeploy. Exiting...');
      await db.close();
      process.exit(1);
    }
  }

  const loggerConfig = cfg.NODE_ENV === 'production'
    ? { level: 'info' as const }
    : {
        level: 'debug' as const,
        transport: { target: 'pino-pretty', options: { colorize: true } },
      };

  const app = Fastify({ logger: loggerConfig });

  // --- Plugins ---
  await app.register(cors, {
    origin: cfg.NODE_ENV === 'production'
      ? [cfg.APP_BASE_URL]
      : true,
    credentials: true,
  });

  await app.register(cookie);

  // --- Decorate with shared deps ---
  app.decorate('db', db);
  app.decorate('config', cfg);

  // --- Routes ---
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(catalogRoutes, { prefix: '/api' });
  await app.register(bookingRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });

  // --- Serve static landing page ---
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(__dirname, '..', '..', 'public');
  let cachedIndexHtml: string | null = null;

  app.get('/', async (_req, reply) => {
    try {
      if (!cachedIndexHtml) {
        cachedIndexHtml = await readFile(join(publicDir, 'index.html'), 'utf8');
      }
      return reply.type('text/html').send(cachedIndexHtml);
    } catch {
      return reply.redirect('/api/health');
    }
  });

  // --- Graceful shutdown ---
  const shutdown = () => {
    app.log.info('Shutting down...');
    void app.close().then(() => db.close()).then(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return app;
}

// --- Direct execution ---
const isMainModule = process.argv[1]?.includes('server');

if (isMainModule) {
  try {
    const app = await buildApp();
    const port = parseInt(process.env['PORT'] ?? '3000', 10);

    await app.listen({ port, host: '0.0.0.0' });
    app.log.info(`🚀 Zamo API running on http://0.0.0.0:${port}`);
  } catch (startupError) {
    // eslint-disable-next-line no-console
    console.error('❌ Failed to start server:', startupError);
    process.exit(1);
  }
}

// Keep process alive — catch unhandled rejections
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled rejection:', reason);
});
