import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from '../../db/client.ts';
import { createTestDb } from '../../db/testing.ts';
import { migrateUp } from '../../db/migrate.ts';
import { createOtpService, maskPhone, isValidPhone, type OtpConfig } from './otp.ts';
import { MemoryNotificationAdapter } from './notification-port.ts';
import { search, AUDIT_ACTIONS } from '../audit/audit.ts';

/**
 * ZAMO-AUTH-007 — patient authentication (phone + OTP) integration tests.
 *
 * Tests run against PGlite (real PostgreSQL), so constraints, triggers
 * and the audit log immutability triggers all fire as they will in production.
 */

let db: Db;
let notifier: MemoryNotificationAdapter;

const TEST_PHONE = '+966512345678';
const PEPPER = 'test-only-pepper-not-a-real-secret-value';

const config: OtpConfig = {
  pepper: PEPPER,
  ttlSeconds: 300,
  maxAttempts: 3, // smaller for tests
  requestWindowSeconds: 3600,
  maxRequestsPerWindow: 50, // high to prevent cross-test rate-limit interference
};

before(async () => {
  db = await createTestDb();
  await migrateUp(db);
});

after(async () => {
  await db.close();
});

async function freshNotifier(): Promise<MemoryNotificationAdapter> {
  notifier = new MemoryNotificationAdapter();
  // Clean up OTP table to avoid cross-test interference
  await db.query('DELETE FROM otp_requests');
  return notifier;
}

/**
 * Extract the 6-digit OTP code from the notification message body.
 */
function extractCode(adapter: MemoryNotificationAdapter, phone: string): string {
  const msgs = adapter.messagesTo(phone);
  assert.ok(msgs.length > 0, 'expected a notification to be sent');
  const match = msgs[msgs.length - 1]!.body.match(/\d{6}/);
  assert.ok(match, 'expected a 6-digit code in the notification');
  return match[0];
}

// ---------------------------------------------------------------------------

describe('ZAMO-AUTH-007 :: phone masking', () => {
  it('masks the middle digits of a Saudi number', () => {
    const masked = maskPhone('+966512345678');
    assert.ok(!masked.includes('123456'), 'middle digits should be masked');
    assert.ok(masked.endsWith('78'), 'last two digits should be visible');
    assert.ok(masked.startsWith('+966'), 'country code should be visible');
  });

  it('handles short numbers gracefully', () => {
    assert.equal(maskPhone('123'), '***');
  });
});

describe('ZAMO-AUTH-007 :: phone validation', () => {
  it('accepts valid Saudi numbers', () => {
    assert.ok(isValidPhone('+966512345678'));
    assert.ok(isValidPhone('+966500000000'));
  });

  it('rejects non-Saudi numbers', () => {
    assert.ok(!isValidPhone('+1234567890'));
    assert.ok(!isValidPhone('0512345678'));
    assert.ok(!isValidPhone(''));
  });
});

// ---------------------------------------------------------------------------

describe('ZAMO-AUTH-007 :: OTP request', () => {
  it('sends an OTP notification to the phone', async () => {
    const adapter = await freshNotifier();
    const svc = createOtpService(db, config, adapter);

    const result = await svc.requestOtp(TEST_PHONE);
    assert.ok(result.ok, 'OTP request should succeed');
    assert.ok(result.value.maskedPhone.includes('***'), 'phone should be masked');

    const msgs = adapter.messagesTo(TEST_PHONE);
    assert.equal(msgs.length, 1);
    assert.ok(msgs[0]!.body.includes('زامو'), 'message should mention Zamo');
  });

  it('rejects invalid phone numbers', async () => {
    const svc = createOtpService(db, config, await freshNotifier());
    const result = await svc.requestOtp('not-a-phone');
    assert.ok(!result.ok);
    assert.equal(result.error, 'INVALID_PHONE');
  });
});

// ---------------------------------------------------------------------------

describe('ZAMO-AUTH-007 :: OTP verification', () => {
  it('OTP صحيح ← دخول ناجح', async () => {
    const adapter = await freshNotifier();
    const svc = createOtpService(db, config, adapter);

    await svc.requestOtp(TEST_PHONE);
    const code = extractCode(adapter, TEST_PHONE);
    const result = await svc.verifyOtp(TEST_PHONE, code);

    assert.ok(result.ok, 'correct OTP should succeed');
    assert.ok(result.value.userId, 'should return a userId');
  });

  it('❗ OTP خاطئ ← فشل', async () => {
    const adapter = await freshNotifier();
    const svc = createOtpService(db, config, adapter);

    await svc.requestOtp(TEST_PHONE);
    const result = await svc.verifyOtp(TEST_PHONE, '000000');

    assert.ok(!result.ok);
    assert.equal(result.error, 'INVALID_OTP');
  });

  it('❗ OTP منتهي الصلاحية ← فشل', async () => {
    const adapter = await freshNotifier();
    const shortTtl: OtpConfig = { ...config, ttlSeconds: 0 }; // expires immediately
    const svc = createOtpService(db, shortTtl, adapter);

    await svc.requestOtp(TEST_PHONE);
    const code = extractCode(adapter, TEST_PHONE);

    // Wait a tick so the OTP is definitely expired
    await new Promise((r) => setTimeout(r, 50));

    const result = await svc.verifyOtp(TEST_PHONE, code);
    assert.ok(!result.ok);
    assert.equal(result.error, 'EXPIRED');
  });

  it('❗ OTP مُعاد استخدامه ← فشل', async () => {
    const adapter = await freshNotifier();
    const svc = createOtpService(db, config, adapter);

    await svc.requestOtp(TEST_PHONE);
    const code = extractCode(adapter, TEST_PHONE);

    // First use — succeeds
    const first = await svc.verifyOtp(TEST_PHONE, code);
    assert.ok(first.ok);

    // Second use — fails
    const second = await svc.verifyOtp(TEST_PHONE, code);
    assert.ok(!second.ok);
    assert.equal(second.error, 'ALREADY_USED');
  });

  it('تجاوز حد المحاولات ← حظر مؤقت', async () => {
    const adapter = await freshNotifier();
    const svc = createOtpService(db, config, adapter);

    await svc.requestOtp(TEST_PHONE);

    // Exhaust attempts with wrong codes
    for (let i = 0; i < config.maxAttempts; i++) {
      await svc.verifyOtp(TEST_PHONE, '999999');
    }

    // Even with the right code, it should fail now
    const code = extractCode(adapter, TEST_PHONE);
    const result = await svc.verifyOtp(TEST_PHONE, code);
    assert.ok(!result.ok);
    assert.equal(result.error, 'MAX_ATTEMPTS');
  });

  it('المحاولة الفاشلة مسجلة في Audit', async () => {
    const adapter = await freshNotifier();
    const svc = createOtpService(db, config, adapter);

    await svc.requestOtp(TEST_PHONE, '203.0.113.1');
    await svc.verifyOtp(TEST_PHONE, '000000', '203.0.113.1');

    const rows = await search(db, { entityType: 'otp', entityId: TEST_PHONE });
    const failedEntries = rows.filter((r) => r.action === AUDIT_ACTIONS.OTP_FAILED);
    assert.ok(failedEntries.length > 0, 'failed OTP attempt should be in audit');
  });

  it('الجوال مخفي جزئياً في الاستجابة', async () => {
    const adapter = await freshNotifier();
    const svc = createOtpService(db, config, adapter);

    const result = await svc.requestOtp(TEST_PHONE);
    assert.ok(result.ok);
    // The masked phone should not contain the full number
    assert.ok(!result.value.maskedPhone.includes('12345678'));
  });

  it('verifyOtp creates a user if not exists', async () => {
    const uniquePhone = '+966599999901';
    const adapter = await freshNotifier();
    const svc = createOtpService(db, { ...config, maxRequestsPerWindow: 10 }, adapter);

    await svc.requestOtp(uniquePhone);
    const code = extractCode(adapter, uniquePhone);
    const result = await svc.verifyOtp(uniquePhone, code);

    assert.ok(result.ok);
    const user = await db.query<{ phone: string }>(
      `SELECT phone FROM users WHERE id = $1`,
      [result.value.userId],
    );
    assert.equal(user.rows[0]!.phone, uniquePhone);
  });
});

// ---------------------------------------------------------------------------

describe('ZAMO-AUTH-007 :: rate limiting', () => {
  it('تجاوز حد طلبات الإرسال ← رفض', async () => {
    const phone = '+966599999902';
    const adapter = await freshNotifier();
    const svc = createOtpService(db, { ...config, maxRequestsPerWindow: 2 }, adapter);

    // First two requests should succeed
    const r1 = await svc.requestOtp(phone);
    assert.ok(r1.ok);
    const r2 = await svc.requestOtp(phone);
    assert.ok(r2.ok);

    // Third request should be rate limited
    const r3 = await svc.requestOtp(phone);
    assert.ok(!r3.ok);
    assert.equal(r3.error, 'RATE_LIMITED');
  });
});
