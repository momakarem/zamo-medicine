/**
 * ZAMO-NOTIF-058 — notification service (orchestrator).
 *
 * The central notification service that ties together:
 *   - Template engine (NOTIF-055)
 *   - Channel dispatcher (NOTIF-056)
 *   - Consent manager (NOTIF-057)
 *
 * Sends the right notification through the right channels to the right
 * people, respecting their consent preferences.
 *
 * Rules:
 *   - ❗ No confirmation notification before actual reception confirmation
 *   - Reminder is sent before the appointment, not after
 *   - Each notification is logged for audit
 *   - Transition-triggered notifications match state-machine T2..T16
 */

import type {
  NotificationType,
  NotificationRecipient,
  TemplateVariables,
  NotificationChannel,
  NotificationLogEntry,
} from './notification-types.js';
import { NOTIFICATION_TYPE_META, getDefaultChannels } from './notification-types.js';
import { renderTemplate } from './template-engine.js';
import type { ChannelDispatcher, DispatchResult } from './channel-dispatcher.js';
import {
  generateIdempotencyKey,
  buildNotificationLogSQL,
} from './channel-dispatcher.js';
import { checkConsent, type ConsentRecord } from './consent-manager.js';
import type { Locale } from '../../shared/i18n.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationError =
  | 'CONSENT_DENIED'
  | 'TEMPLATE_ERROR'
  | 'ALL_CHANNELS_FAILED'
  | 'NO_RECIPIENTS';

export interface SendNotificationParams {
  /** Notification type */
  type: NotificationType;
  /** Recipients to notify */
  recipients: NotificationRecipient[];
  /** Template variables */
  variables: TemplateVariables;
  /** Entity ID for idempotency (usually bookingId) */
  entityId: string;
  /** Override default channels (optional) */
  channels?: NotificationChannel[];
  /** Timestamp override (for testing) */
  timestamp?: Date;
}

export interface NotificationResult {
  /** Per-recipient results */
  sent: RecipientResult[];
  /** Number of recipients successfully notified (at least one channel) */
  successCount: number;
  /** Number of recipients skipped due to consent */
  skippedCount: number;
  /** Number of recipients where all channels failed */
  failedCount: number;
}

export interface RecipientResult {
  userId: string;
  status: 'sent' | 'skipped_consent' | 'failed' | 'template_error';
  dispatch?: DispatchResult;
}

// ---------------------------------------------------------------------------
// Notification Service
// ---------------------------------------------------------------------------

export class NotificationService {
  private readonly dispatcher: ChannelDispatcher;
  private readonly consentProvider: ConsentProvider;
  private readonly logEntries: NotificationLogEntry[] = []; // in-memory log for tests

  constructor(
    dispatcher: ChannelDispatcher,
    consentProvider: ConsentProvider,
  ) {
    this.dispatcher = dispatcher;
    this.consentProvider = consentProvider;
  }

  /**
   * Send a notification to one or more recipients.
   *
   * For each recipient:
   *   1. Check consent
   *   2. Render template in recipient's locale
   *   3. Dispatch via appropriate channels
   *   4. Log result
   */
  async notify(params: SendNotificationParams): Promise<Result<NotificationResult, NotificationError>> {
    const { type, recipients, variables, entityId, timestamp } = params;

    if (recipients.length === 0) {
      return err('NO_RECIPIENTS');
    }

    const channels = params.channels ?? [...getDefaultChannels(type)];
    const results: RecipientResult[] = [];

    for (const recipient of recipients) {
      const result = await this.notifyOne(
        type, recipient, variables, entityId, channels, timestamp,
      );
      results.push(result);
    }

    const successCount = results.filter((r) => r.status === 'sent').length;
    const skippedCount = results.filter((r) => r.status === 'skipped_consent').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    return ok({ sent: results, successCount, skippedCount, failedCount });
  }

  /**
   * Notify a single recipient.
   */
  private async notifyOne(
    type: NotificationType,
    recipient: NotificationRecipient,
    variables: TemplateVariables,
    entityId: string,
    channels: NotificationChannel[],
    timestamp?: Date,
  ): Promise<RecipientResult> {
    // 1. Check consent
    const consents = await this.consentProvider.getConsents(recipient.userId);
    const consentResult = checkConsent(type, consents);

    if (consentResult !== 'ALLOWED') {
      this.logEntry({
        notificationType: type,
        recipientUserId: recipient.userId,
        channel: channels[0] ?? 'in_app',
        idempotencyKey: generateIdempotencyKey(type, recipient.userId, entityId, timestamp),
        body: '',
        status: 'skipped_consent',
      });
      return { userId: recipient.userId, status: 'skipped_consent' };
    }

    // 2. Render template
    const rendered = renderTemplate(type, recipient.locale, variables);
    if (!rendered.ok) {
      return { userId: recipient.userId, status: 'template_error' };
    }

    // 3. Determine recipient address per channel
    const idempotencyKey = generateIdempotencyKey(type, recipient.userId, entityId, timestamp);
    const resolvedChannels = channels.filter((ch) => {
      if (ch === 'whatsapp' || ch === 'sms') return !!recipient.phone;
      if (ch === 'email') return !!recipient.email;
      if (ch === 'in_app') return true;
      return false;
    });

    if (resolvedChannels.length === 0) {
      return { userId: recipient.userId, status: 'failed' };
    }

    // 4. Dispatch
    const dispatch = await this.dispatcher.dispatch(resolvedChannels, {
      idempotencyKey,
      to: this.resolveAddress(recipient, resolvedChannels[0]!),
      subject: rendered.value.subject,
      body: rendered.value.body,
      notificationType: type,
    });

    // 5. Log
    for (const attempt of dispatch.attempts) {
      this.logEntry({
        notificationType: type,
        recipientUserId: recipient.userId,
        channel: attempt.channel,
        idempotencyKey,
        body: rendered.value.body,
        status: attempt.success ? 'sent' : 'failed',
        errorMessage: attempt.error,
      });
    }

    return {
      userId: recipient.userId,
      status: dispatch.anySuccess ? 'sent' : 'failed',
      dispatch,
    };
  }

  /**
   * Resolve the recipient address for a given channel.
   */
  private resolveAddress(
    recipient: NotificationRecipient,
    channel: NotificationChannel,
  ): string {
    switch (channel) {
      case 'whatsapp':
      case 'sms':
        return recipient.phone ?? '';
      case 'email':
        return recipient.email ?? '';
      case 'in_app':
        return recipient.userId;
    }
  }

  /**
   * Record a log entry (in-memory for tests; DB in production).
   */
  private logEntry(entry: NotificationLogEntry): void {
    this.logEntries.push(entry);
  }

  /**
   * Get all log entries (for testing).
   */
  getLogEntries(): NotificationLogEntry[] {
    return [...this.logEntries];
  }

  /**
   * Build SQL for all pending log entries.
   */
  buildLogSQL(): Array<{ sql: string; values: unknown[] }> {
    return this.logEntries.map(buildNotificationLogSQL);
  }
}

// ---------------------------------------------------------------------------
// Consent provider interface (injected dependency)
// ---------------------------------------------------------------------------

export interface ConsentProvider {
  getConsents(userId: string): Promise<ConsentRecord[]>;
}

// ---------------------------------------------------------------------------
// Memory consent provider (for testing)
// ---------------------------------------------------------------------------

export class MemoryConsentProvider implements ConsentProvider {
  private readonly consents = new Map<string, ConsentRecord[]>();

  setConsents(userId: string, records: ConsentRecord[]): void {
    this.consents.set(userId, records);
  }

  async getConsents(userId: string): Promise<ConsentRecord[]> {
    return this.consents.get(userId) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Mapping: transition ID → notification type
// ---------------------------------------------------------------------------

/**
 * Maps state-machine transition IDs to notification types.
 *
 * Used by booking-service to determine which notification to send
 * after a successful transition.
 */
export const TRANSITION_TO_NOTIFICATION: Partial<Record<string, NotificationType>> = {
  T2: 'BOOKING_SUBMITTED',
  T3: 'BOOKING_CONFIRMED',
  T4: 'BOOKING_REJECTED',
  T5: 'ALTERNATIVE_SUGGESTED',
  T6: 'BOOKING_CANCELLED',
  T7: 'SLA_WARNING',
  T8: 'BOOKING_RESCHEDULED',
  T9: 'BOOKING_CANCELLED',
  T10: 'APPOINTMENT_REMINDER',
  T12: 'NO_SHOW_RECORDED',
  T14: 'VALUE_SUBMITTED',
  T15: 'VALUE_APPROVED',
  T16: 'VALUE_REJECTED',
} as const;
