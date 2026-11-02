/**
 * ZAMO-AGENT-054 — Agent Admin (إدارة الوكيل والسجلات).
 *
 * From the Zamo admin dashboard:
 *   - Edit agent instructions (system prompt) → takes effect immediately
 *   - Edit question templates
 *   - View conversation logs (searchable)
 *   - View failed conversations (escalated/blocked)
 *   - ❗ Logs are protected by permissions (zamo_admin only)
 */

import type { Queryable } from '../../db/client.ts';
import type { Locale } from '../../shared/i18n.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentConfigEntry {
  configKey: string;
  labelAr: string;
  labelEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  valueText: string | null;
  valueJson: unknown | null;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface ConversationSummary {
  id: string;
  patientId: string | null;
  language: string;
  status: string;
  messageCount: number;
  toolCallCount: number;
  escalationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: MessageEntry[];
  toolCalls: ToolCallEntry[];
}

export interface MessageEntry {
  id: string;
  sequence: number;
  role: string;
  content: string;
  guardAction: string | null;
  createdAt: Date;
}

export interface ToolCallEntry {
  id: string;
  toolName: string;
  inputParams: Record<string, unknown>;
  outputResult: unknown;
  outputError: string | null;
  durationMs: number | null;
  toolWasEnabled: boolean;
  createdAt: Date;
}

export interface ConversationFilters {
  status?: string;
  fromDate?: Date;
  toDate?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Config management
// ---------------------------------------------------------------------------

/**
 * Get all agent config entries.
 * ❗ zamo_admin only (enforced by RLS).
 */
export async function getAllConfig(db: Queryable): Promise<AgentConfigEntry[]> {
  const { rows } = await db.query<{
    config_key: string;
    label_ar: string;
    label_en: string;
    description_ar: string | null;
    description_en: string | null;
    value_text: string | null;
    value_json: unknown | null;
    updated_by: string | null;
    updated_at: Date;
  }>(`SELECT * FROM agent_config ORDER BY config_key`);

  return rows.map((r) => ({
    configKey: r.config_key,
    labelAr: r.label_ar,
    labelEn: r.label_en,
    descriptionAr: r.description_ar,
    descriptionEn: r.description_en,
    valueText: r.value_text,
    valueJson: r.value_json,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  }));
}

/**
 * Update an agent config value.
 * Takes effect immediately (loaded per-conversation).
 *
 * ❗ zamo_admin only (enforced by RLS).
 */
export async function updateConfig(
  db: Queryable,
  configKey: string,
  value: string,
  updatedBy: string,
): Promise<void> {
  await db.query(
    `UPDATE agent_config
     SET value_text = $1, updated_by = $2
     WHERE config_key = $3`,
    [value, updatedBy, configKey],
  );
}

// ---------------------------------------------------------------------------
// Conversation logs
// ---------------------------------------------------------------------------

/**
 * List conversations with filters.
 * ❗ zamo_admin only (enforced by RLS).
 */
export async function listConversations(
  db: Queryable,
  filters: ConversationFilters = {},
): Promise<ConversationSummary[]> {
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];
  let paramIdx = 0;

  if (filters.status) {
    conditions.push(`c.status = $${++paramIdx}`);
    params.push(filters.status);
  }

  if (filters.fromDate) {
    conditions.push(`c.created_at >= $${++paramIdx}`);
    params.push(filters.fromDate);
  }

  if (filters.toDate) {
    conditions.push(`c.created_at <= $${++paramIdx}`);
    params.push(filters.toDate);
  }

  if (filters.search) {
    conditions.push(`EXISTS (
      SELECT 1 FROM conversation_messages cm
      WHERE cm.conversation_id = c.id AND cm.content ILIKE $${++paramIdx}
    )`);
    params.push(`%${filters.search}%`);
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const sql = `
    SELECT
      c.id,
      c.patient_id,
      c.language,
      c.status,
      c.escalation_reason,
      c.created_at,
      c.updated_at,
      (SELECT COUNT(*) FROM conversation_messages cm WHERE cm.conversation_id = c.id) as message_count,
      (SELECT COUNT(*) FROM tool_calls tc WHERE tc.conversation_id = c.id) as tool_call_count
    FROM conversations c
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const { rows } = await db.query<{
    id: string;
    patient_id: string | null;
    language: string;
    status: string;
    escalation_reason: string | null;
    created_at: Date;
    updated_at: Date;
    message_count: string;
    tool_call_count: string;
  }>(sql, params);

  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient_id,
    language: r.language,
    status: r.status,
    messageCount: parseInt(r.message_count, 10),
    toolCallCount: parseInt(r.tool_call_count, 10),
    escalationReason: r.escalation_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Get detailed conversation with all messages and tool calls.
 * ❗ zamo_admin only (enforced by RLS).
 */
export async function getConversationDetail(
  db: Queryable,
  conversationId: string,
): Promise<ConversationDetail | null> {
  // Get conversation
  const conversations = await listConversations(db);
  const conversation = conversations.find((c) => c.id === conversationId);
  if (!conversation) return null;

  // Get messages
  const { rows: msgRows } = await db.query<{
    id: string;
    sequence: number;
    role: string;
    content: string;
    guard_action: string | null;
    created_at: Date;
  }>(
    `SELECT id, sequence, role, content, guard_action, created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY sequence`,
    [conversationId],
  );

  // Get tool calls
  const { rows: tcRows } = await db.query<{
    id: string;
    tool_name: string;
    input_params: Record<string, unknown>;
    output_result: unknown;
    output_error: string | null;
    duration_ms: number | null;
    tool_was_enabled: boolean;
    created_at: Date;
  }>(
    `SELECT id, tool_name, input_params, output_result, output_error,
            duration_ms, tool_was_enabled, created_at
     FROM tool_calls
     WHERE conversation_id = $1
     ORDER BY created_at`,
    [conversationId],
  );

  return {
    conversation,
    messages: msgRows.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      role: r.role,
      content: r.content,
      guardAction: r.guard_action,
      createdAt: r.created_at,
    })),
    toolCalls: tcRows.map((r) => ({
      id: r.id,
      toolName: r.tool_name,
      inputParams: r.input_params,
      outputResult: r.output_result,
      outputError: r.output_error,
      durationMs: r.duration_ms,
      toolWasEnabled: r.tool_was_enabled,
      createdAt: r.created_at,
    })),
  };
}

/**
 * List failed conversations (escalated or with blocked messages).
 * ❗ zamo_admin only.
 */
export async function listFailedConversations(
  db: Queryable,
  filters: ConversationFilters = {},
): Promise<ConversationSummary[]> {
  return listConversations(db, { ...filters, status: 'escalated' });
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface AgentStats {
  totalConversations: number;
  activeConversations: number;
  escalatedConversations: number;
  completedConversations: number;
  totalToolCalls: number;
  blockedMessages: number;
}

/**
 * Get agent statistics for the admin dashboard.
 */
export async function getAgentStats(db: Queryable): Promise<AgentStats> {
  const { rows } = await db.query<{
    total: string;
    active: string;
    escalated: string;
    completed: string;
  }>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'active') as active,
      COUNT(*) FILTER (WHERE status = 'escalated') as escalated,
      COUNT(*) FILTER (WHERE status = 'completed') as completed
    FROM conversations
  `);

  const { rows: tcRows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM tool_calls`,
  );

  const { rows: blockedRows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM conversation_messages
     WHERE guard_action IN ('blocked_medical', 'blocked_emergency', 'blocked_injection', 'blocked_output')`,
  );

  const stats = rows[0];

  return {
    totalConversations: parseInt(stats?.total ?? '0', 10),
    activeConversations: parseInt(stats?.active ?? '0', 10),
    escalatedConversations: parseInt(stats?.escalated ?? '0', 10),
    completedConversations: parseInt(stats?.completed ?? '0', 10),
    totalToolCalls: parseInt(tcRows[0]?.count ?? '0', 10),
    blockedMessages: parseInt(blockedRows[0]?.count ?? '0', 10),
  };
}
