/**
 * ZAMO-AGENT-053 — Escalation tests.
 *
 * Tests from IMPLEMENTATION_CHECKLIST:
 *   ❗ التصعيد اليدوي يعمل
 *   ❗ التصعيد التلقائي عند النية الطبية
 *   التصعيد يحفظ سياق المحادثة
 *   ❗ التصعيد متاح في كل مرحلة
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  escalateConversation,
  getEscalationMessage,
  shouldAutoEscalate,
  _ESCALATION_MESSAGES,
  type EscalationRequest,
} from './escalation.ts';
import type { Queryable, QueryResult } from '../../db/client.ts';

// ---------------------------------------------------------------------------
// In-memory DB mock
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  status: string;
  escalated_at: Date | null;
  escalation_reason: string | null;
}

function createMockDb(): Queryable & { conversations: ConversationRow[] } {
  const conversations: ConversationRow[] = [
    { id: 'conv-1', status: 'active', escalated_at: null, escalation_reason: null },
    { id: 'conv-2', status: 'escalated', escalated_at: new Date(), escalation_reason: 'test' },
  ];

  return {
    conversations,
    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      if (sql.includes('SELECT status FROM conversations WHERE id')) {
        const id = params?.[0] as string;
        const row = conversations.find((c) => c.id === id);
        return {
          rows: row ? [{ status: row.status }] as T[] : [] as T[],
          rowCount: row ? 1 : 0,
        };
      }

      if (sql.includes('UPDATE conversations')) {
        const [reason, id] = params as [string, string];
        const conv = conversations.find((c) => c.id === id);
        if (conv) {
          conv.status = 'escalated';
          conv.escalated_at = new Date();
          conv.escalation_reason = reason;
        }
        return { rows: [] as T[], rowCount: 1 };
      }

      return { rows: [] as T[], rowCount: 0 };
    },
    async exec(): Promise<void> {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Escalation', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  // -----------------------------------------------------------------------
  // Manual escalation — ❗ always works
  // -----------------------------------------------------------------------

  describe('Manual Escalation', () => {
    it('❗ manual escalation works on active conversation', async () => {
      const result = await escalateConversation(db, {
        conversationId: 'conv-1',
        trigger: 'manual',
        locale: 'ar',
      });

      expect(result.success).toBe(true);
      expect(result.alreadyEscalated).toBe(false);
      expect(result.messageAr).toContain('تم تحويلك');
    });

    it('preserves conversation context (status updated)', async () => {
      await escalateConversation(db, {
        conversationId: 'conv-1',
        trigger: 'manual',
        locale: 'ar',
      });

      const conv = db.conversations.find((c) => c.id === 'conv-1');
      expect(conv?.status).toBe('escalated');
      expect(conv?.escalated_at).toBeTruthy();
      expect(conv?.escalation_reason).toContain('Patient requested');
    });

    it('handles already escalated conversation', async () => {
      const result = await escalateConversation(db, {
        conversationId: 'conv-2',
        trigger: 'manual',
        locale: 'ar',
      });

      expect(result.success).toBe(true);
      expect(result.alreadyEscalated).toBe(true);
    });

    it('handles non-existent conversation', async () => {
      const result = await escalateConversation(db, {
        conversationId: 'conv-999',
        trigger: 'manual',
        locale: 'ar',
      });

      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Automatic escalation — medical intent
  // -----------------------------------------------------------------------

  describe('Auto Escalation — Medical Intent', () => {
    it('❗ auto-escalates on medical intent', async () => {
      const result = await escalateConversation(db, {
        conversationId: 'conv-1',
        trigger: 'medical_intent',
        locale: 'ar',
      });

      expect(result.success).toBe(true);
      const conv = db.conversations.find((c) => c.id === 'conv-1');
      expect(conv?.escalation_reason).toContain('Medical intent');
    });
  });

  // -----------------------------------------------------------------------
  // Emergency escalation
  // -----------------------------------------------------------------------

  describe('Emergency Escalation', () => {
    it('emergency escalation includes 997', async () => {
      const result = await escalateConversation(db, {
        conversationId: 'conv-1',
        trigger: 'emergency',
        locale: 'ar',
      });

      expect(result.messageAr).toContain('997');
      expect(result.messageEn).toContain('997');
    });
  });

  // -----------------------------------------------------------------------
  // shouldAutoEscalate
  // -----------------------------------------------------------------------

  describe('shouldAutoEscalate', () => {
    it('returns false for 0 failures', () => {
      expect(shouldAutoEscalate(0)).toBe(false);
    });

    it('returns false for 2 failures', () => {
      expect(shouldAutoEscalate(2)).toBe(false);
    });

    it('returns true for 3 failures (default threshold)', () => {
      expect(shouldAutoEscalate(3)).toBe(true);
    });

    it('respects custom threshold', () => {
      expect(shouldAutoEscalate(4, 5)).toBe(false);
      expect(shouldAutoEscalate(5, 5)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Localized messages
  // -----------------------------------------------------------------------

  describe('Localized Messages', () => {
    it('all trigger types have AR and EN messages', () => {
      const triggers = [
        'manual', 'medical_intent', 'emergency',
        'repeated_failure', 'prompt_injection', 'system',
      ] as const;

      for (const trigger of triggers) {
        expect(_ESCALATION_MESSAGES[trigger].ar).toBeTruthy();
        expect(_ESCALATION_MESSAGES[trigger].en).toBeTruthy();
      }
    });

    it('getEscalationMessage returns correct locale', async () => {
      const result = await escalateConversation(db, {
        conversationId: 'conv-1',
        trigger: 'manual',
        locale: 'ar',
      });

      expect(getEscalationMessage(result, 'ar')).toContain('تم تحويلك');
      expect(getEscalationMessage(result, 'en')).toContain('transferred');
    });
  });
});
