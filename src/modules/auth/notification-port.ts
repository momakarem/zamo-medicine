/**
 * ZAMO-AUTH-007 — notification port.
 *
 * Implements DEC-009: the notification channel (SMS/WhatsApp) is abstracted
 * behind a port interface so the provider decision (OQ-032) does not block
 * development. The real provider adapter is swapped in when a vendor is chosen.
 *
 * The MemoryAdapter stores sent messages in an array for test assertions.
 * The ConsoleAdapter logs to stdout for local development.
 */

export interface NotificationMessage {
  to: string;          // E.164 phone number
  body: string;
  channel: 'sms' | 'whatsapp';
  sentAt: Date;
}

export interface NotificationPort {
  send(to: string, body: string, channel?: 'sms' | 'whatsapp'): Promise<void>;
}

// ---------------------------------------------------------------------------
// Memory adapter (tests)
// ---------------------------------------------------------------------------

export class MemoryNotificationAdapter implements NotificationPort {
  readonly sent: NotificationMessage[] = [];

  send(to: string, body: string, channel: 'sms' | 'whatsapp' = 'sms'): Promise<void> {
    this.sent.push({ to, body, channel, sentAt: new Date() });
    return Promise.resolve();
  }

  /** Get messages sent to a specific phone number. */
  messagesTo(phone: string): NotificationMessage[] {
    return this.sent.filter((m) => m.to === phone);
  }

  /** Get the last message sent. */
  lastMessage(): NotificationMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  /** Clear all recorded messages. */
  clear(): void {
    this.sent.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Console adapter (development)
// ---------------------------------------------------------------------------

export class ConsoleNotificationAdapter implements NotificationPort {
  send(to: string, body: string, channel: 'sms' | 'whatsapp' = 'sms'): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[NOTIFICATION] [${channel.toUpperCase()}] → ${to}: ${body}`);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Factory (DEC-009)
// ---------------------------------------------------------------------------

/**
 * Create a notification adapter based on the configured adapter type.
 * 'memory' — stores messages in-memory (tests).
 * 'console' — logs to stdout (dev/staging).
 * 'provider' — real SMS/WhatsApp provider (production — not yet implemented).
 */
export function createNotificationAdapter(adapter: 'memory' | 'console' | 'provider'): NotificationPort {
  switch (adapter) {
    case 'console':
    case 'provider': // provider falls back to console until a real vendor is chosen (OQ-032)
      return new ConsoleNotificationAdapter();
    case 'memory':
    default:
      return new MemoryNotificationAdapter();
  }
}
