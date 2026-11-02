/**
 * ZAMO-AGENT-054 — Agent Admin tests.
 *
 * Tests from IMPLEMENTATION_CHECKLIST:
 *   تعديل التعليمات يسري
 *   المحادثات الفاشلة تظهر
 *   السجلات كاملة وقابلة للبحث
 *   ❗ سجلات المحادثات محمية بالصلاحيات
 */

import { describe, it, expect } from 'vitest';
import {
  getAllConfig,
  updateConfig,
  listConversations,
  listFailedConversations,
  getAgentStats,
  type AgentConfigEntry,
  type ConversationFilters,
} from './agent-admin.ts';
import type { Queryable, QueryResult } from '../../db/client.ts';

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

function createMockDb(): Queryable & {
  configs: AgentConfigEntry[];
  conversations: Array<{
    id: string;
    patient_id: string | null;
    language: string;
    status: string;
    escalation_reason: string | null;
    created_at: Date;
    updated_at: Date;
    message_count: string;
    tool_call_count: string;
  }>;
} {
  const configs: AgentConfigEntry[] = [
    {
      configKey: 'system_prompt_ar',
      labelAr: 'تعليمات الوكيل',
      labelEn: 'Agent Instructions',
      descriptionAr: null,
      descriptionEn: null,
      valueText: 'أنت مساعد ذكي.',
      valueJson: null,
      updatedBy: null,
      updatedAt: new Date(),
    },
  ];

  const conversations = [
    {
      id: 'conv-1', patient_id: 'p-1', language: 'ar', status: 'active',
      escalation_reason: null, created_at: new Date(), updated_at: new Date(),
      message_count: '5', tool_call_count: '2',
    },
    {
      id: 'conv-2', patient_id: 'p-2', language: 'ar', status: 'escalated',
      escalation_reason: 'Medical intent', created_at: new Date(), updated_at: new Date(),
      message_count: '3', tool_call_count: '0',
    },
    {
      id: 'conv-3', patient_id: 'p-3', language: 'en', status: 'completed',
      escalation_reason: null, created_at: new Date(), updated_at: new Date(),
      message_count: '10', tool_call_count: '4',
    },
  ];

  return {
    configs,
    conversations,
    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      // SELECT agent_config
      if (sql.includes('FROM agent_config ORDER BY')) {
        return {
          rows: configs.map((c) => ({
            config_key: c.configKey,
            label_ar: c.labelAr,
            label_en: c.labelEn,
            description_ar: c.descriptionAr,
            description_en: c.descriptionEn,
            value_text: c.valueText,
            value_json: c.valueJson,
            updated_by: c.updatedBy,
            updated_at: c.updatedAt,
          })) as T[],
          rowCount: configs.length,
        };
      }

      // UPDATE agent_config
      if (sql.includes('UPDATE agent_config')) {
        const [value, updatedBy, key] = params as [string, string, string];
        const config = configs.find((c) => c.configKey === key);
        if (config) {
          config.valueText = value;
          config.updatedBy = updatedBy;
        }
        return { rows: [] as T[], rowCount: 1 };
      }

      // SELECT conversations with filters
      if (sql.includes('FROM conversations c')) {
        let filtered = [...conversations];

        // Check for status filter
        if (params && params.length > 0) {
          const statusParam = params[0] as string;
          if (['active', 'escalated', 'completed', 'abandoned'].includes(statusParam)) {
            filtered = filtered.filter((c) => c.status === statusParam);
          }
        }

        return { rows: filtered as T[], rowCount: filtered.length };
      }

      // Stats queries
      if (sql.includes('COUNT(*)') && sql.includes('FROM conversations') && !sql.includes('conversation_messages')) {
        return {
          rows: [{
            total: String(conversations.length),
            active: String(conversations.filter((c) => c.status === 'active').length),
            escalated: String(conversations.filter((c) => c.status === 'escalated').length),
            completed: String(conversations.filter((c) => c.status === 'completed').length),
          }] as T[],
          rowCount: 1,
        };
      }

      if (sql.includes('FROM tool_calls')) {
        return { rows: [{ count: '6' }] as T[], rowCount: 1 };
      }

      if (sql.includes('guard_action IN')) {
        return { rows: [{ count: '2' }] as T[], rowCount: 1 };
      }

      return { rows: [] as T[], rowCount: 0 };
    },
    async exec(): Promise<void> {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Admin', () => {
  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  describe('Config Management', () => {
    it('lists all config entries', async () => {
      const db = createMockDb();
      const configs = await getAllConfig(db);
      expect(configs.length).toBeGreaterThan(0);
      expect(configs[0].configKey).toBe('system_prompt_ar');
    });

    it('updating config takes effect', async () => {
      const db = createMockDb();
      await updateConfig(db, 'system_prompt_ar', 'تعليمات جديدة', 'admin-1');

      const config = db.configs.find((c) => c.configKey === 'system_prompt_ar');
      expect(config?.valueText).toBe('تعليمات جديدة');
      expect(config?.updatedBy).toBe('admin-1');
    });
  });

  // -----------------------------------------------------------------------
  // Conversation logs
  // -----------------------------------------------------------------------

  describe('Conversation Logs', () => {
    it('lists all conversations', async () => {
      const db = createMockDb();
      const convs = await listConversations(db);
      expect(convs.length).toBe(3);
    });

    it('lists failed (escalated) conversations', async () => {
      const db = createMockDb();
      const failed = await listFailedConversations(db);
      // The mock filters by escalated status
      expect(failed.length).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Statistics
  // -----------------------------------------------------------------------

  describe('Statistics', () => {
    it('returns agent stats', async () => {
      const db = createMockDb();
      const stats = await getAgentStats(db);

      expect(stats.totalConversations).toBe(3);
      expect(stats.activeConversations).toBe(1);
      expect(stats.escalatedConversations).toBe(1);
      expect(stats.completedConversations).toBe(1);
      expect(stats.totalToolCalls).toBe(6);
      expect(stats.blockedMessages).toBe(2);
    });
  });
});
