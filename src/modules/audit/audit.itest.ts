import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from '../../db/client.ts';
import { createTestDb } from '../../db/testing.ts';
import { migrateUp } from '../../db/migrate.ts';
import { record, search, AUDIT_ACTIONS, AuditReasonRequiredError } from './audit.ts';

/**
 * ZAMO-AUDIT-004 — the immutability tests.
 *
 * The whole point of A-46 is that a financial record cannot be altered after
 * the fact. These tests attempt the alteration and require the database to
 * refuse; a passing suite here is the evidence that the guarantee is real.
 */

let db: Db;

before(async () => {
  db = await createTestDb();
  await migrateUp(db);
});

after(async () => {
  await db.close();
});

/** audit_log cannot be truncated by design, so tests use distinct entities. */
let seq = 0;
const nextEntity = (): string => `entity-${++seq}`;

beforeEach(() => {
  // no-op: entries accumulate, which is exactly what an append-only log does.
});

async function rejects(fn: () => Promise<unknown>, what: string): Promise<string> {
  let message = '';
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    message = e instanceof Error ? e.message : String(e);
  }
  assert.equal(threw, true, `expected REJECTION: ${what}`);
  return message;
}

describe('ZAMO-AUDIT-004 :: append', () => {
  it('writes an entry and reads it back', async () => {
    const entityId = nextEntity();
    const id = await record(db, {
      action: AUDIT_ACTIONS.FACILITY_APPROVED,
      entityType: 'facility',
      entityId,
      actorUserId: null,
      actorRole: 'zamo_admin',
    });
    assert.ok(id);

    const rows = await search(db, { entityType: 'facility', entityId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.action, 'facility.approved');
    assert.equal(rows[0]!.actor_role, 'zamo_admin');
  });

  it('records the value before and after a change', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.PRICE_CHANGED,
      entityType: 'price',
      entityId,
      before: { amount: '300.00' },
      after: { amount: '350.00' },
      reason: 'Seasonal adjustment approved by facility manager',
    });

    const rows = await search(db, { entityType: 'price', entityId });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.before_state, { amount: '300.00' });
    assert.deepEqual(rows[0]!.after_state, { amount: '350.00' });
  });

  it('flags financial actions automatically (A-46)', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.VALUE_APPROVED,
      entityType: 'collection',
      entityId,
      actorRole: 'facility_manager',
    });
    const rows = await search(db, { entityType: 'collection', entityId });
    assert.equal(rows[0]!.is_financial, true);
  });

  it('does not flag non-financial actions', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      entityType: 'user',
      entityId,
    });
    const rows = await search(db, { entityType: 'user', entityId });
    assert.equal(rows[0]!.is_financial, false);
  });

  it('REJECTS a reason-required action with no reason (A-21)', async () => {
    let threw = false;
    try {
      await record(db, {
        action: AUDIT_ACTIONS.COMMISSION_RULE_CHANGED,
        entityType: 'commission_rule',
        entityId: nextEntity(),
      });
    } catch (e) {
      threw = true;
      assert.ok(e instanceof AuditReasonRequiredError);
    }
    assert.equal(threw, true, 'commission change without a reason must be refused');
  });

  it('REJECTS a reason-required action with a blank reason', async () => {
    await rejects(
      () =>
        record(db, {
          action: AUDIT_ACTIONS.PRICE_CHANGED,
          entityType: 'price',
          entityId: nextEntity(),
          reason: '    ',
        }),
      'blank reason on a price change',
    );
  });

  it('REJECTS an entry with a blank action', async () => {
    await rejects(
      () => db.query(`INSERT INTO audit_log (action, entity_type) VALUES ('   ', 'facility')`),
      'blank action',
    );
  });
});

describe('ZAMO-AUDIT-004 :: immutability (A-46)', () => {
  it('REJECTS UPDATE of an audit entry', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.VALUE_APPROVED,
      entityType: 'collection',
      entityId,
    });

    const msg = await rejects(
      () => db.query(`UPDATE audit_log SET reason = 'tampered' WHERE entity_id = $1`, [entityId]),
      'UPDATE on audit_log',
    );
    assert.match(msg, /append-only/i);
  });

  it('REJECTS UPDATE even when it changes nothing', async () => {
    const entityId = nextEntity();
    await record(db, { action: AUDIT_ACTIONS.LOGOUT, entityType: 'user', entityId });
    await rejects(
      () => db.query(`UPDATE audit_log SET action = action WHERE entity_id = $1`, [entityId]),
      'no-op UPDATE on audit_log',
    );
  });

  it('REJECTS DELETE of an audit entry', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.INVOICE_ISSUED,
      entityType: 'invoice',
      entityId,
    });

    const msg = await rejects(
      () => db.query(`DELETE FROM audit_log WHERE entity_id = $1`, [entityId]),
      'DELETE on audit_log',
    );
    assert.match(msg, /append-only/i);
  });

  it('REJECTS a blanket DELETE', async () => {
    await rejects(() => db.query(`DELETE FROM audit_log`), 'DELETE ALL on audit_log');
  });

  it('REJECTS TRUNCATE of audit_log', async () => {
    await rejects(() => db.query(`TRUNCATE TABLE audit_log`), 'TRUNCATE on audit_log');
  });

  it('the entry survives every tampering attempt', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.VALUE_APPROVED,
      entityType: 'collection',
      entityId,
      after: { collected: '1500.00' },
    });

    await rejects(() => db.query(`UPDATE audit_log SET after_state = '{}'::jsonb`), 'update');
    await rejects(() => db.query(`DELETE FROM audit_log`), 'delete');

    const rows = await search(db, { entityType: 'collection', entityId });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.after_state, { collected: '1500.00' });
  });
});

describe('ZAMO-AUDIT-004 :: the ten required operations [S1]', () => {
  it('records a successful sign-in', async () => {
    const entityId = nextEntity();
    await record(db, { action: AUDIT_ACTIONS.LOGIN_SUCCEEDED, entityType: 'user', entityId });
    assert.equal((await search(db, { entityType: 'user', entityId })).length, 1);
  });

  it('records a FAILED sign-in attempt', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'user',
      entityId,
      actorIp: '203.0.113.9',
    });
    const rows = await search(db, { entityType: 'user', entityId });
    assert.equal(rows[0]!.action, 'login.failed');
  });

  it('records a permission change', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.ROLE_GRANTED,
      entityType: 'user_role',
      entityId,
      before: { role: null },
      after: { role: 'receptionist' },
    });
    assert.equal((await search(db, { entityType: 'user_role', entityId })).length, 1);
  });

  it('records a facility approval', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.FACILITY_APPROVED,
      entityType: 'facility',
      entityId,
      facilityId: '00000000-0000-0000-0000-000000000001',
    });
    assert.equal((await search(db, { entityType: 'facility', entityId })).length, 1);
  });

  it('records a booking status change', async () => {
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.BOOKING_STATUS_CHANGED,
      entityType: 'booking',
      entityId,
      before: { status: 'PENDING_CONFIRMATION' },
      after: { status: 'CONFIRMED' },
    });
    const rows = await search(db, { entityType: 'booking', entityId });
    assert.deepEqual(rows[0]!.after_state, { status: 'CONFIRMED' });
  });

  it('records a data export', async () => {
    const entityId = nextEntity();
    await record(db, { action: AUDIT_ACTIONS.DATA_EXPORTED, entityType: 'report', entityId });
    assert.equal((await search(db, { entityType: 'report', entityId })).length, 1);
  });

  it('can list financial entries only', async () => {
    const rows = await search(db, { financialOnly: true, limit: 500 });
    assert.ok(rows.length > 0, 'expected some financial entries from earlier tests');
    assert.ok(
      rows.every((r) => r.is_financial),
      'financialOnly must not return non-financial entries',
    );
  });

  it('scopes a search to one facility', async () => {
    const facilityId = '00000000-0000-0000-0000-0000000000aa';
    const entityId = nextEntity();
    await record(db, {
      action: AUDIT_ACTIONS.FACILITY_APPROVED,
      entityType: 'facility',
      entityId,
      facilityId,
    });
    const rows = await search(db, { facilityId });
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.facility_id === facilityId));
  });
});
