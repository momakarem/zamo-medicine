#!/usr/bin/env node
/**
 * CLI migration runner for production deployments.
 *
 * Usage:
 *   node --experimental-strip-types scripts/migrate-cli.ts          # apply pending
 *   node --experimental-strip-types scripts/migrate-cli.ts status   # show status
 *   node --experimental-strip-types scripts/migrate-cli.ts down 1   # rollback 1 step
 */

import { PgDb } from '../src/db/pg.ts';
import { migrateUp, migrateDown, migrationStatus } from '../src/db/migrate.ts';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const command = process.argv[2] ?? 'up';

async function main() {
  console.log(`Connecting to database...`);
  const db = await PgDb.connect(DATABASE_URL!);

  try {
    switch (command) {
      case 'up': {
        console.log('Applying pending migrations...');
        const applied = await migrateUp(db);
        if (applied.length === 0) {
          console.log('✓ No pending migrations.');
        } else {
          console.log(`✓ Applied ${applied.length} migration(s):`);
          for (const id of applied) {
            console.log(`  - ${id}`);
          }
        }
        break;
      }
      case 'down': {
        const steps = parseInt(process.argv[3] ?? '1', 10);
        console.log(`Rolling back ${steps} migration(s)...`);
        const reverted = await migrateDown(db, steps);
        if (reverted.length === 0) {
          console.log('✓ Nothing to rollback.');
        } else {
          console.log(`✓ Reverted ${reverted.length} migration(s):`);
          for (const id of reverted) {
            console.log(`  - ${id}`);
          }
        }
        break;
      }
      case 'status': {
        const statuses = await migrationStatus(db);
        console.log('Migration status:');
        for (const s of statuses) {
          const mark = s.applied ? '✓' : '✗';
          console.log(`  ${mark} ${s.id}`);
        }
        break;
      }
      default:
        console.error(`Unknown command: ${command}. Use: up, down, status`);
        process.exit(1);
    }
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
