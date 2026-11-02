/**
 * ZAMO-NOTIF-056 — channel dispatcher.
 *
 * Dispatches rendered notifications to one or more channels in parallel.
 *
 * Implements:
 *   B-33: Abstracted channel adapters (WhatsApp, SMS, Email, InApp)
 *   - Failure on one channel does NOT block others
 *   - Idempotency via unique keys (retry-safe)
 *   - Memory adapters for testing
 *
 * Each adapter implements `ChannelAdapter` which extends the basic
 * notification port pattern established in auth/notification-port.ts.
 */

import type {
  NotificationChannel,
  ChannelMessage,
  NotificationLogEntry,
} from './notification-types.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Channel adapter interface
// ---------------------------------------------------------------------------

export type ChannelError =
  | 'DELIVERY_FAILED'
  | 'INVALID_RECIPIENT'
  | 'DUPLICATE_MESSAGE';  // idempotency

export interface ChannelAdapter {
  /** Which channel this adapter handles */
  readonly channel: NotificationChannel;

  /** Send a single message. Must be idempotent for the same idempotencyKey. */
  send(msg: ChannelMessage): Promise<Result<void, ChannelError>>;
}

// ---------------------------------------------------------------------------
// Dispatch result
// ---------------------------------------------------------------------------

export interface DispatchAttempt {
  channel: NotificationChannel;
  success: boolean;
  error?: ChannelError;
}

export interface DispatchResult {
  /** The idempotency key */
  idempotencyKey: string;
  /** Results per channel */
  attempts: DispatchAttempt[];
  /** True if at least one channel succeeded */
  anySuccess: boolean;
}

// ---------------------------------------------------------------------------
// ChannelDispatcher — orchestrates multi-channel sending
// ---------------------------------------------------------------------------

export class ChannelDispatcher {
  private readonly adapters: Map<NotificationChannel, ChannelAdapter> = new Map();

  /**
   * Register a channel adapter. Overwrites any existing adapter for that channel.
   */
  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter);
  }

  /**
   * Dispatch a message to multiple channels in parallel.
   *
   * - Tries all requested channels concurrently.
   * - ❗ Failure on one channel does NOT stop the others.
   * - Returns per-channel results for logging.
   */
  async dispatch(
    channels: readonly NotificationChannel[],
    msg: Omit<ChannelMessage, 'channel'>,
  ): Promise<DispatchResult> {
    const attempts: DispatchAttempt[] = [];

    // Run all channels in parallel
    const promises = channels.map(async (channel) => {
      const adapter = this.adapters.get(channel);

      if (!adapter) {
        attempts.push({
          channel,
          success: false,
          error: 'DELIVERY_FAILED',
        });
        return;
      }

      const channelMsg: ChannelMessage = { ...msg, channel };
      const result = await adapter.send(channelMsg);

      if (result.ok) {
        attempts.push({ channel, success: true });
      } else {
        attempts.push({
          channel,
          success: false,
          error: result.error,
        });
      }
    });

    await Promise.all(promises);

    return {
      idempotencyKey: msg.idempotencyKey,
      attempts,
      anySuccess: attempts.some((a) => a.success),
    };
  }

  /**
   * Check if an adapter is registered for a channel.
   */
  hasAdapter(channel: NotificationChannel): boolean {
    return this.adapters.has(channel);
  }
}

// ---------------------------------------------------------------------------
// Memory adapters (for testing)
// ---------------------------------------------------------------------------

/** Base memory adapter — stores sent messages and tracks idempotency. */
class BaseMemoryAdapter implements ChannelAdapter {
  readonly channel: NotificationChannel;
  readonly sent: ChannelMessage[] = [];
  private readonly seenKeys = new Set<string>();

  /** If true, the next send() will fail */
  shouldFail = false;

  constructor(channel: NotificationChannel) {
    this.channel = channel;
  }

  async send(msg: ChannelMessage): Promise<Result<void, ChannelError>> {
    // Idempotency check
    if (this.seenKeys.has(msg.idempotencyKey)) {
      return err('DUPLICATE_MESSAGE');
    }

    if (this.shouldFail) {
      return err('DELIVERY_FAILED');
    }

    this.seenKeys.add(msg.idempotencyKey);
    this.sent.push(msg);
    return ok(undefined);
  }

  /** Get messages sent to a specific recipient */
  messagesTo(to: string): ChannelMessage[] {
    return this.sent.filter((m) => m.to === to);
  }

  /** Clear all state */
  clear(): void {
    this.sent.length = 0;
    this.seenKeys.clear();
    this.shouldFail = false;
  }

  /** Get the last message sent */
  lastMessage(): ChannelMessage | undefined {
    return this.sent[this.sent.length - 1];
  }
}

export class MemoryWhatsAppAdapter extends BaseMemoryAdapter {
  constructor() { super('whatsapp'); }
}

export class MemorySmsAdapter extends BaseMemoryAdapter {
  constructor() { super('sms'); }
}

export class MemoryEmailAdapter extends BaseMemoryAdapter {
  constructor() { super('email'); }
}

export class MemoryInAppAdapter extends BaseMemoryAdapter {
  constructor() { super('in_app'); }
}

// ---------------------------------------------------------------------------
// Notification log builder (SQL)
// ---------------------------------------------------------------------------

/**
 * Build SQL to insert a notification log entry.
 */
export function buildNotificationLogSQL(entry: NotificationLogEntry): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      INSERT INTO notification_log (
        notification_type, recipient_user_id, channel,
        idempotency_key, body, status, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (idempotency_key, channel) DO NOTHING
      RETURNING id
    `,
    values: [
      entry.notificationType,
      entry.recipientUserId,
      entry.channel,
      entry.idempotencyKey,
      entry.body,
      entry.status,
      entry.errorMessage ?? null,
    ],
  };
}

/**
 * Generate an idempotency key for a notification.
 *
 * Format: `notif:{type}:{recipientId}:{bookingId}:{timestamp}`
 */
export function generateIdempotencyKey(
  type: string,
  recipientId: string,
  entityId: string,
  timestamp?: Date,
): string {
  const ts = (timestamp ?? new Date()).toISOString().slice(0, 16); // minute precision
  return `notif:${type}:${recipientId}:${entityId}:${ts}`;
}
