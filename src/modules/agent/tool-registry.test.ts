/**
 * ZAMO-AGENT-047 — Tool Registry tests.
 *
 * Tests from IMPLEMENTATION_CHECKLIST:
 *   كل أداة تعمل منفردة
 *   ❗ إيقاف أداة يسري فورًا بلا إعادة نشر
 *   كل استدعاء مسجّل بمدخلاته ومخرجاته
 *   ❗ الأداة تخضع لنفس صلاحيات الواجهة
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ToolRegistry,
  TOOL_DEFINITIONS,
  ALL_TOOL_NAMES,
  type AgentToolName,
} from './tool-registry.ts';
import type { Queryable, QueryResult } from '../../db/client.ts';

// ---------------------------------------------------------------------------
// In-memory DB mock
// ---------------------------------------------------------------------------

interface ToolRow {
  tool_name: string;
  enabled: boolean;
  label_ar: string;
  label_en: string;
  updated_by: string | null;
  created_at: Date;
}

interface ToolCallRow {
  id: string;
  conversation_id: string;
  tool_name: string;
  input_params: Record<string, unknown>;
  output_result: Record<string, unknown> | null;
  output_error: string | null;
  started_at: Date;
  completed_at: Date | null;
  duration_ms: number | null;
  tool_was_enabled: boolean;
}

function createMockDb(): Queryable & {
  tools: ToolRow[];
  toolCalls: ToolCallRow[];
} {
  const tools: ToolRow[] = ALL_TOOL_NAMES.map((name) => ({
    tool_name: name,
    enabled: true,
    label_ar: name,
    label_en: name,
    updated_by: null,
    created_at: new Date(),
  }));

  const toolCalls: ToolCallRow[] = [];

  const db = {
    tools,
    toolCalls,

    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      // SELECT tool_name, enabled FROM agent_tools
      if (sql.includes('SELECT tool_name, enabled FROM agent_tools')) {
        return { rows: tools.map((t) => ({ tool_name: t.tool_name, enabled: t.enabled })) as T[], rowCount: tools.length };
      }

      // SELECT * FROM agent_tools ORDER BY created_at
      if (sql.includes('FROM agent_tools ORDER BY')) {
        return { rows: tools as T[], rowCount: tools.length };
      }

      // UPDATE agent_tools
      if (sql.includes('UPDATE agent_tools')) {
        const [enabled, updatedBy, toolName] = params as [boolean, string, string];
        const tool = tools.find((t) => t.tool_name === toolName);
        if (tool) {
          tool.enabled = enabled;
          tool.updated_by = updatedBy;
        }
        return { rows: [] as T[], rowCount: 1 };
      }

      // INSERT INTO tool_calls
      if (sql.includes('INSERT INTO tool_calls')) {
        const id = `tc_${toolCalls.length + 1}`;
        const [convId, toolName, inputStr, outputStr, outputError, startedAt, completedAt, durationMs, toolWasEnabled] = params as [string, string, string, string | null, string | null, Date, Date, number, boolean];
        toolCalls.push({
          id,
          conversation_id: convId,
          tool_name: toolName,
          input_params: JSON.parse(inputStr),
          output_result: outputStr ? JSON.parse(outputStr) : null,
          output_error: outputError,
          started_at: startedAt,
          completed_at: completedAt,
          duration_ms: durationMs,
          tool_was_enabled: toolWasEnabled,
        });
        return { rows: [{ id }] as T[], rowCount: 1 };
      }

      // SELECT * FROM tool_calls WHERE conversation_id
      if (sql.includes('FROM tool_calls WHERE conversation_id')) {
        const convId = params?.[0] as string;
        const rows = toolCalls.filter((tc) => tc.conversation_id === convId);
        return { rows: rows as T[], rowCount: rows.length };
      }

      return { rows: [] as T[], rowCount: 0 };
    },

    async exec(): Promise<void> {},
  };

  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tool Registry', () => {
  let registry: ToolRegistry;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    registry = new ToolRegistry();
    db = createMockDb();
  });

  // -----------------------------------------------------------------------
  // Tool definitions
  // -----------------------------------------------------------------------

  describe('Tool Definitions', () => {
    it('has definitions for all 8 tools', () => {
      expect(Object.keys(TOOL_DEFINITIONS)).toHaveLength(8);
      for (const name of ALL_TOOL_NAMES) {
        expect(TOOL_DEFINITIONS[name]).toBeDefined();
        expect(TOOL_DEFINITIONS[name].name).toBe(name);
      }
    });

    it('each definition has name, description, and parameters', () => {
      for (const def of Object.values(TOOL_DEFINITIONS)) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.parameters).toBeDefined();
      }
    });

    it('create_booking_req description mentions PENDING_CONFIRMATION', () => {
      expect(TOOL_DEFINITIONS.create_booking_req.description).toContain('PENDING_CONFIRMATION');
    });

    it('escalate_to_human description mentions always available', () => {
      expect(TOOL_DEFINITIONS.escalate_to_human.description).toContain('any time');
    });
  });

  // -----------------------------------------------------------------------
  // getEnabledTools
  // -----------------------------------------------------------------------

  describe('getEnabledTools', () => {
    it('returns all tools when all are enabled', async () => {
      const tools = await registry.getEnabledTools(db);
      expect(tools).toHaveLength(8);
    });

    it('excludes disabled tools', async () => {
      db.tools.find((t) => t.tool_name === 'search_services')!.enabled = false;
      const tools = await registry.getEnabledTools(db);
      expect(tools).toHaveLength(7);
      expect(tools.find((t) => t.name === 'search_services')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // setToolEnabled — ❗ immediate effect (rule 5)
  // -----------------------------------------------------------------------

  describe('setToolEnabled (rule 5: immediate effect)', () => {
    it('disabling a tool takes effect on next getEnabledTools call', async () => {
      // Initially enabled
      expect(await registry.isToolEnabled(db, 'search_doctors')).toBe(true);

      // Disable
      await registry.setToolEnabled(db, 'search_doctors', false, 'admin-1');

      // ❗ Next call must reflect the change immediately
      expect(await registry.isToolEnabled(db, 'search_doctors')).toBe(false);

      const tools = await registry.getEnabledTools(db);
      expect(tools.find((t) => t.name === 'search_doctors')).toBeUndefined();
    });

    it('re-enabling a tool takes effect immediately', async () => {
      await registry.setToolEnabled(db, 'cancel', false, 'admin-1');
      expect(await registry.isToolEnabled(db, 'cancel')).toBe(false);

      await registry.setToolEnabled(db, 'cancel', true, 'admin-1');
      expect(await registry.isToolEnabled(db, 'cancel')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // logToolCall — rule 3: every call logged
  // -----------------------------------------------------------------------

  describe('logToolCall (rule 3)', () => {
    it('logs a tool call with input and output', async () => {
      const start = new Date();
      const end = new Date(start.getTime() + 150);

      const id = await registry.logToolCall(db, {
        conversationId: 'conv-1',
        toolName: 'search_doctors',
        inputParams: { specialtySlug: 'dental', district: 'الملقا' },
        outputResult: { doctors: [{ name: 'أحمد' }] },
        startedAt: start,
        completedAt: end,
        toolWasEnabled: true,
      });

      expect(id).toBeTruthy();
      expect(db.toolCalls).toHaveLength(1);
      expect(db.toolCalls[0].tool_name).toBe('search_doctors');
      expect(db.toolCalls[0].input_params).toEqual({ specialtySlug: 'dental', district: 'الملقا' });
      expect(db.toolCalls[0].duration_ms).toBe(150);
    });

    it('logs a failed tool call with error', async () => {
      const start = new Date();
      const end = new Date(start.getTime() + 50);

      await registry.logToolCall(db, {
        conversationId: 'conv-1',
        toolName: 'create_booking_req',
        inputParams: { patientId: 'p-1' },
        outputError: 'MAX_PENDING_BOOKINGS',
        startedAt: start,
        completedAt: end,
        toolWasEnabled: true,
      });

      expect(db.toolCalls[0].output_error).toBe('MAX_PENDING_BOOKINGS');
      expect(db.toolCalls[0].output_result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getToolCallHistory
  // -----------------------------------------------------------------------

  describe('getToolCallHistory', () => {
    it('returns calls for a specific conversation', async () => {
      const now = new Date();
      await registry.logToolCall(db, {
        conversationId: 'conv-1',
        toolName: 'search_services',
        inputParams: {},
        startedAt: now,
        completedAt: now,
        toolWasEnabled: true,
      });
      await registry.logToolCall(db, {
        conversationId: 'conv-2',
        toolName: 'cancel',
        inputParams: {},
        startedAt: now,
        completedAt: now,
        toolWasEnabled: true,
      });

      const history = await registry.getToolCallHistory(db, 'conv-1');
      expect(history).toHaveLength(1);
      expect(history[0].toolName).toBe('search_services');
    });
  });

  // -----------------------------------------------------------------------
  // getAllStatuses
  // -----------------------------------------------------------------------

  describe('getAllStatuses', () => {
    it('returns all 8 tools with their statuses', async () => {
      const statuses = await registry.getAllStatuses(db);
      expect(statuses).toHaveLength(8);
    });
  });
});
