/**
 * ZAMO-AGENT-047 — Tool Registry (سجل الأدوات والتحكم).
 *
 * Manages the 7+1 agent tools (ARCHITECTURE §9.1):
 *   search_services, search_doctors, get_availability,
 *   create_booking_req, reschedule, cancel,
 *   get_booking_status, escalate_to_human
 *
 * Key rules (ARCH §9.2):
 *   Rule 1: Agent never writes to DB directly — tools call module interfaces.
 *   Rule 2: Agent answers from tool results only — no hallucinated data.
 *   Rule 3: Every tool call is logged (tool_calls table).
 *   Rule 5: Disabling a tool takes effect immediately, no redeployment.
 *   Rule 7: Recommendation reasons from real data only (B-22).
 */

import type { Queryable } from '../../db/client.ts';
import type { ToolDefinition } from './llm-port.ts';
import type { Locale } from '../../shared/i18n.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tool names as defined in ARCHITECTURE §9.1 + escalate_to_human. */
export type AgentToolName =
  | 'search_services'
  | 'search_doctors'
  | 'get_availability'
  | 'create_booking_req'
  | 'reschedule'
  | 'cancel'
  | 'get_booking_status'
  | 'escalate_to_human';

export const ALL_TOOL_NAMES: readonly AgentToolName[] = [
  'search_services',
  'search_doctors',
  'get_availability',
  'create_booking_req',
  'reschedule',
  'cancel',
  'get_booking_status',
  'escalate_to_human',
] as const;

export interface ToolStatus {
  toolName: AgentToolName;
  enabled: boolean;
  labelAr: string;
  labelEn: string;
}

export interface ToolCallRecord {
  id: string;
  conversationId: string;
  toolName: string;
  inputParams: Record<string, unknown>;
  outputResult: Record<string, unknown> | null;
  outputError: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  toolWasEnabled: boolean;
}

export type ToolExecutor = (
  params: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolExecutionResult>;

export interface ToolContext {
  conversationId: string;
  patientId: string | null;
  locale: Locale;
  db: Queryable;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool definitions (for LLM function calling)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: Record<AgentToolName, ToolDefinition> = {
  search_services: {
    name: 'search_services',
    description: 'Search for available medical services by specialty, name, or location.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (service name or keyword)' },
        specialtySlug: { type: 'string', description: 'Specialty slug (e.g. dental, dermatology)' },
        district: { type: 'string', description: 'District/neighborhood name' },
        locale: { type: 'string', enum: ['ar', 'en'], description: 'Language for results' },
      },
      required: [],
    },
  },
  search_doctors: {
    name: 'search_doctors',
    description: 'Search for doctors with recommendation reasons. Results include distance, price, availability, insurance, language, and gender preferences.',
    parameters: {
      type: 'object',
      properties: {
        specialtySlug: { type: 'string', description: 'Specialty slug' },
        district: { type: 'string', description: 'District/neighborhood name' },
        serviceId: { type: 'string', description: 'Specific service ID' },
        doctorName: { type: 'string', description: 'Doctor name (partial match)' },
        doctorGender: { type: 'string', enum: ['male', 'female'], description: 'Preferred doctor gender' },
        maxPrice: { type: 'number', description: 'Maximum price' },
        availableToday: { type: 'boolean', description: 'Only show doctors available today' },
        insurancePlanId: { type: 'string', description: 'Insurance plan ID' },
        sortBy: { type: 'string', enum: ['default', 'nearest_appointment', 'nearest_location', 'lowest_price'] },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: [],
    },
  },
  get_availability: {
    name: 'get_availability',
    description: 'Get available appointment slots for a specific doctor at a branch.',
    parameters: {
      type: 'object',
      properties: {
        doctorId: { type: 'string', description: 'Doctor ID' },
        branchId: { type: 'string', description: 'Branch ID' },
        fromDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        toDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['doctorId', 'branchId'],
    },
  },
  create_booking_req: {
    name: 'create_booking_req',
    description: 'Create a booking request. ❗ The booking will be PENDING_CONFIRMATION — it is NOT confirmed until the clinic responds. Uses the same State Machine as the web interface.',
    parameters: {
      type: 'object',
      properties: {
        patientId: { type: 'string', description: 'Patient user ID (requires OTP verification)' },
        doctorId: { type: 'string', description: 'Doctor ID' },
        branchId: { type: 'string', description: 'Branch ID' },
        branchServiceId: { type: 'string', description: 'Branch service ID' },
        slotStart: { type: 'string', description: 'Slot start time (ISO 8601)' },
        slotEnd: { type: 'string', description: 'Slot end time (ISO 8601)' },
        consentPrivacy: { type: 'boolean', description: 'Privacy consent (required)' },
        consentOperational: { type: 'boolean', description: 'Operational notifications consent' },
        consentMarketing: { type: 'boolean', description: 'Marketing notifications consent' },
      },
      required: ['patientId', 'doctorId', 'branchId', 'branchServiceId', 'slotStart', 'slotEnd', 'consentPrivacy'],
    },
  },
  reschedule: {
    name: 'reschedule',
    description: 'Reschedule an existing booking to a new time slot. Maximum 2 reschedules allowed (B-14).',
    parameters: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'Booking ID to reschedule' },
        newSlotStart: { type: 'string', description: 'New slot start time (ISO 8601)' },
        newSlotEnd: { type: 'string', description: 'New slot end time (ISO 8601)' },
      },
      required: ['bookingId', 'newSlotStart', 'newSlotEnd'],
    },
  },
  cancel: {
    name: 'cancel',
    description: 'Cancel a booking and release the time slot.',
    parameters: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'Booking ID to cancel' },
        reason: { type: 'string', description: 'Cancellation reason' },
      },
      required: ['bookingId'],
    },
  },
  get_booking_status: {
    name: 'get_booking_status',
    description: 'Check the current status of a booking.',
    parameters: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'Booking ID' },
        bookingNumber: { type: 'string', description: 'Booking number (e.g. ZAMO-20260917-A3F2)' },
      },
      required: [],
    },
  },
  escalate_to_human: {
    name: 'escalate_to_human',
    description: 'Transfer this conversation to a human agent. Available at any time. The human agent will see the full conversation history.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for escalation' },
      },
      required: [],
    },
  },
};

// ---------------------------------------------------------------------------
// Registry class
// ---------------------------------------------------------------------------

export class ToolRegistry {
  /** In-memory cache of tool statuses. Refreshed from DB on each request. */
  private cachedStatuses: Map<AgentToolName, boolean> | null = null;

  /**
   * Get the list of currently enabled tools as LLM ToolDefinitions.
   *
   * Reads from DB each time (rule 5: disable takes immediate effect).
   */
  async getEnabledTools(db: Queryable): Promise<ToolDefinition[]> {
    const statuses = await this.loadToolStatuses(db);
    const enabled: ToolDefinition[] = [];

    for (const [name, isEnabled] of statuses) {
      if (isEnabled) {
        const def = TOOL_DEFINITIONS[name];
        if (def) enabled.push(def);
      }
    }

    return enabled;
  }

  /**
   * Check if a specific tool is enabled.
   */
  async isToolEnabled(db: Queryable, toolName: AgentToolName): Promise<boolean> {
    const statuses = await this.loadToolStatuses(db);
    return statuses.get(toolName) ?? false;
  }

  /**
   * Get all tool statuses.
   */
  async getAllStatuses(db: Queryable): Promise<ToolStatus[]> {
    const { rows } = await db.query<{
      tool_name: string;
      enabled: boolean;
      label_ar: string;
      label_en: string;
    }>(`SELECT tool_name, enabled, label_ar, label_en FROM agent_tools ORDER BY created_at`);

    return rows.map((r) => ({
      toolName: r.tool_name as AgentToolName,
      enabled: r.enabled,
      labelAr: r.label_ar,
      labelEn: r.label_en,
    }));
  }

  /**
   * Enable or disable a tool (zamo_admin only).
   * Takes effect immediately (rule 5).
   */
  async setToolEnabled(
    db: Queryable,
    toolName: AgentToolName,
    enabled: boolean,
    updatedBy: string,
  ): Promise<void> {
    await db.query(
      `UPDATE agent_tools SET enabled = $1, updated_by = $2 WHERE tool_name = $3`,
      [enabled, updatedBy, toolName],
    );
    // Invalidate cache so next request picks up the change
    this.cachedStatuses = null;
  }

  /**
   * Log a tool call to the database (rule 3).
   */
  async logToolCall(
    db: Queryable,
    params: {
      conversationId: string;
      toolName: string;
      inputParams: Record<string, unknown>;
      outputResult?: unknown;
      outputError?: string;
      startedAt: Date;
      completedAt: Date;
      toolWasEnabled: boolean;
    },
  ): Promise<string> {
    const durationMs = params.completedAt.getTime() - params.startedAt.getTime();

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO tool_calls (
        conversation_id, tool_name, input_params, output_result, output_error,
        started_at, completed_at, duration_ms, tool_was_enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        params.conversationId,
        params.toolName,
        JSON.stringify(params.inputParams),
        params.outputResult ? JSON.stringify(params.outputResult) : null,
        params.outputError ?? null,
        params.startedAt,
        params.completedAt,
        durationMs,
        params.toolWasEnabled,
      ],
    );

    return rows[0].id;
  }

  /**
   * Get tool call history for a conversation.
   */
  async getToolCallHistory(
    db: Queryable,
    conversationId: string,
  ): Promise<ToolCallRecord[]> {
    const { rows } = await db.query<{
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
    }>(
      `SELECT * FROM tool_calls WHERE conversation_id = $1 ORDER BY started_at`,
      [conversationId],
    );

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      toolName: r.tool_name,
      inputParams: r.input_params,
      outputResult: r.output_result,
      outputError: r.output_error,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMs: r.duration_ms,
      toolWasEnabled: r.tool_was_enabled,
    }));
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async loadToolStatuses(db: Queryable): Promise<Map<AgentToolName, boolean>> {
    // Always re-read from DB (rule 5: immediate effect)
    const { rows } = await db.query<{ tool_name: string; enabled: boolean }>(
      `SELECT tool_name, enabled FROM agent_tools`,
    );

    const map = new Map<AgentToolName, boolean>();
    for (const row of rows) {
      map.set(row.tool_name as AgentToolName, row.enabled);
    }

    this.cachedStatuses = map;
    return map;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const toolRegistry = new ToolRegistry();
