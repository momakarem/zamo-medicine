/**
 * ZAMO-NOTIF-056 — channel dispatcher tests.
 *
 * Validates:
 *   - Each channel works via memory adapter
 *   - Failure on one channel does NOT block others
 *   - Idempotency: retry does not send duplicate
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ChannelDispatcher,
  MemoryWhatsAppAdapter,
  MemorySmsAdapter,
  MemoryEmailAdapter,
  MemoryInAppAdapter,
  generateIdempotencyKey,
} from './channel-dispatcher.js';
import type { ChannelMessage } from './notification-types.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let dispatcher: ChannelDispatcher;
let whatsapp: MemoryWhatsAppAdapter;
let sms: MemorySmsAdapter;
let email: MemoryEmailAdapter;
let inApp: MemoryInAppAdapter;

const baseMsg: Omit<ChannelMessage, 'channel'> = {
  idempotencyKey: 'test-key-001',
  to: '+966512345678',
  body: 'Test notification body',
  notificationType: 'BOOKING_CONFIRMED',
};

beforeEach(() => {
  dispatcher = new ChannelDispatcher();
  whatsapp = new MemoryWhatsAppAdapter();
  sms = new MemorySmsAdapter();
  email = new MemoryEmailAdapter();
  inApp = new MemoryInAppAdapter();

  dispatcher.registerAdapter(whatsapp);
  dispatcher.registerAdapter(sms);
  dispatcher.registerAdapter(email);
  dispatcher.registerAdapter(inApp);
});

// ---------------------------------------------------------------------------
// Per-channel tests
// ---------------------------------------------------------------------------

describe('ChannelDispatcher — individual channels', () => {
  it('sends via WhatsApp adapter', async () => {
    const result = await dispatcher.dispatch(['whatsapp'], baseMsg);

    expect(result.anySuccess).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.channel).toBe('whatsapp');
    expect(result.attempts[0]?.success).toBe(true);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.lastMessage()?.body).toBe('Test notification body');
  });

  it('sends via SMS adapter', async () => {
    const result = await dispatcher.dispatch(['sms'], baseMsg);

    expect(result.anySuccess).toBe(true);
    expect(sms.sent).toHaveLength(1);
  });

  it('sends via Email adapter', async () => {
    const result = await dispatcher.dispatch(['email'], {
      ...baseMsg,
      to: 'test@example.com',
      subject: 'Test Subject',
    });

    expect(result.anySuccess).toBe(true);
    expect(email.sent).toHaveLength(1);
  });

  it('sends via InApp adapter', async () => {
    const result = await dispatcher.dispatch(['in_app'], {
      ...baseMsg,
      to: 'user-123',
    });

    expect(result.anySuccess).toBe(true);
    expect(inApp.sent).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Multi-channel
// ---------------------------------------------------------------------------

describe('ChannelDispatcher — multi-channel', () => {
  it('sends to multiple channels in parallel', async () => {
    const result = await dispatcher.dispatch(
      ['whatsapp', 'in_app'],
      baseMsg,
    );

    expect(result.anySuccess).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(whatsapp.sent).toHaveLength(1);
    expect(inApp.sent).toHaveLength(1);
  });

  it('failure on one channel does NOT block others', async () => {
    // Make WhatsApp fail
    whatsapp.shouldFail = true;

    const result = await dispatcher.dispatch(
      ['whatsapp', 'in_app', 'sms'],
      baseMsg,
    );

    // WhatsApp failed, but others succeeded
    expect(result.anySuccess).toBe(true);
    expect(whatsapp.sent).toHaveLength(0);
    expect(inApp.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);

    // Check per-channel results
    const waResult = result.attempts.find((a) => a.channel === 'whatsapp');
    expect(waResult?.success).toBe(false);
    expect(waResult?.error).toBe('DELIVERY_FAILED');

    const inAppResult = result.attempts.find((a) => a.channel === 'in_app');
    expect(inAppResult?.success).toBe(true);
  });

  it('reports anySuccess=false when ALL channels fail', async () => {
    whatsapp.shouldFail = true;
    sms.shouldFail = true;

    const result = await dispatcher.dispatch(
      ['whatsapp', 'sms'],
      baseMsg,
    );

    expect(result.anySuccess).toBe(false);
    expect(result.attempts.every((a) => !a.success)).toBe(true);
  });

  it('handles unregistered channel gracefully', async () => {
    const emptyDispatcher = new ChannelDispatcher();
    const result = await emptyDispatcher.dispatch(['whatsapp'], baseMsg);

    expect(result.anySuccess).toBe(false);
    expect(result.attempts[0]?.error).toBe('DELIVERY_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('ChannelDispatcher — idempotency', () => {
  it('retry with same key returns DUPLICATE_MESSAGE, not double-send', async () => {
    // First send succeeds
    await dispatcher.dispatch(['whatsapp'], baseMsg);
    expect(whatsapp.sent).toHaveLength(1);

    // Retry with same key
    const retry = await dispatcher.dispatch(['whatsapp'], baseMsg);

    // Should NOT double-send
    expect(whatsapp.sent).toHaveLength(1);
    // Should report duplicate
    const attempt = retry.attempts.find((a) => a.channel === 'whatsapp');
    expect(attempt?.success).toBe(false);
    expect(attempt?.error).toBe('DUPLICATE_MESSAGE');
  });

  it('different keys send separate messages', async () => {
    await dispatcher.dispatch(['whatsapp'], baseMsg);
    await dispatcher.dispatch(['whatsapp'], {
      ...baseMsg,
      idempotencyKey: 'test-key-002',
    });

    expect(whatsapp.sent).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Idempotency key generation
// ---------------------------------------------------------------------------

describe('generateIdempotencyKey', () => {
  it('generates deterministic key for same inputs at same minute', () => {
    const ts = new Date('2026-09-20T10:30:00Z');
    const key1 = generateIdempotencyKey('BOOKING_CONFIRMED', 'user-1', 'booking-1', ts);
    const key2 = generateIdempotencyKey('BOOKING_CONFIRMED', 'user-1', 'booking-1', ts);
    expect(key1).toBe(key2);
  });

  it('generates different keys for different types', () => {
    const ts = new Date('2026-09-20T10:30:00Z');
    const key1 = generateIdempotencyKey('BOOKING_CONFIRMED', 'user-1', 'booking-1', ts);
    const key2 = generateIdempotencyKey('BOOKING_CANCELLED', 'user-1', 'booking-1', ts);
    expect(key1).not.toBe(key2);
  });

  it('includes type, recipient, entity, and timestamp', () => {
    const ts = new Date('2026-09-20T10:30:00Z');
    const key = generateIdempotencyKey('BOOKING_CONFIRMED', 'user-1', 'booking-1', ts);
    expect(key).toContain('BOOKING_CONFIRMED');
    expect(key).toContain('user-1');
    expect(key).toContain('booking-1');
    expect(key).toContain('2026-09-20T10:30');
  });
});
