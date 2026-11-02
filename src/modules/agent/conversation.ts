/**
 * ZAMO-AGENT-046 — Conversation Engine (محرك الحوار).
 *
 * The central orchestrator that ties all agent components together:
 *
 *   رسالة المستخدم
 *     → Input Guard (block/pass)
 *     → Load conversation context + system prompt
 *     → LLM chat (with enabled tools)
 *     → If tool_call → execute tool → log → feed back to LLM
 *     → Output Guard (block/sanitize/pass)
 *     → Save messages → return response
 *
 * Key properties:
 *   - ❗ Clear identification as smart assistant (not doctor)
 *   - ❗ No-diagnosis disclaimer in welcome + system prompt
 *   - ❗ Transfer-to-human button always available
 *   - Bilingual (AR/EN) — detects from first message
 *   - A-34: Conversation starts without login (OTP at booking time)
 */

import type { Queryable } from '../../db/client.ts';
import type { LlmPort, ChatMessage, ToolCall, ChatResponse } from './llm-port.ts';
import type { Locale } from '../../shared/i18n.ts';
import { checkInput, getGuardResponse, type InputGuardResult } from './input-guard.ts';
import { checkOutput, getSafeContent, type OutputGuardResult } from './output-guard.ts';
import { ToolRegistry, type AgentToolName } from './tool-registry.ts';
import { escalateConversation, shouldAutoEscalate } from './escalation.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationState {
  id: string;
  patientId: string | null;
  language: Locale;
  status: 'active' | 'completed' | 'escalated' | 'abandoned';
  messageCount: number;
  consecutiveFailures: number;
}

export interface UserMessage {
  conversationId: string | null;  // null = new conversation
  content: string;
  patientId?: string;
  locale?: Locale;
  source?: string;
}

export interface AgentResponse {
  conversationId: string;
  content: string;
  /** Doctor cards (if search was performed). */
  cards?: unknown[];
  /** Was input blocked by guard? */
  inputGuardAction?: InputGuardResult['type'];
  /** Was output modified by guard? */
  outputGuardAction?: OutputGuardResult['type'];
  /** Conversation was escalated? */
  escalated: boolean;
  /** Conversation status. */
  status: ConversationState['status'];
}

export interface ConversationEngineConfig {
  /** Max tool call iterations per message (safety limit). */
  maxToolIterations: number;
  /** Auto-escalation failure threshold. */
  autoEscalateThreshold: number;
}

const DEFAULT_CONFIG: ConversationEngineConfig = {
  maxToolIterations: 5,
  autoEscalateThreshold: 3,
};

// ---------------------------------------------------------------------------
// Conversation Engine
// ---------------------------------------------------------------------------

export class ConversationEngine {
  private readonly llm: LlmPort;
  private readonly toolRegistry: ToolRegistry;
  private readonly config: ConversationEngineConfig;

  constructor(
    llm: LlmPort,
    toolRegistry: ToolRegistry,
    config: Partial<ConversationEngineConfig> = {},
  ) {
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a user message and return the agent's response.
   *
   * This is the main entry point for the agent.
   */
  async processMessage(
    db: Queryable,
    message: UserMessage,
    toolExecutor?: ToolExecutorFn,
  ): Promise<AgentResponse> {
    // 1. Get or create conversation
    const conversation = message.conversationId
      ? await this.loadConversation(db, message.conversationId)
      : await this.createConversation(db, message);

    if (!conversation) {
      return {
        conversationId: '',
        content: message.locale === 'en'
          ? 'Conversation not found.'
          : 'المحادثة غير موجودة.',
        escalated: false,
        status: 'active',
      };
    }

    // 2. Input Guard
    const guardResult = checkInput(message.content);

    if (guardResult.type !== 'pass') {
      const guardResponse = getGuardResponse(guardResult, conversation.language)!;

      // Save user message + guard response
      await this.saveMessage(db, conversation.id, conversation.messageCount + 1, 'user', message.content, guardResult.type === 'emergency' ? 'blocked_emergency' : guardResult.type === 'medical_intent' ? 'blocked_medical' : 'blocked_injection');
      await this.saveMessage(db, conversation.id, conversation.messageCount + 2, 'assistant', guardResponse, 'passed');

      // Auto-escalate on medical intent or emergency
      let escalated = false;
      if (guardResult.type === 'medical_intent' || guardResult.type === 'emergency') {
        await escalateConversation(db, {
          conversationId: conversation.id,
          trigger: guardResult.type === 'emergency' ? 'emergency' : 'medical_intent',
          locale: conversation.language,
        });
        escalated = true;
      }

      return {
        conversationId: conversation.id,
        content: guardResponse,
        inputGuardAction: guardResult.type,
        escalated,
        status: escalated ? 'escalated' : 'active',
      };
    }

    // 3. Save user message
    const userSeq = conversation.messageCount + 1;
    await this.saveMessage(db, conversation.id, userSeq, 'user', message.content, 'passed');

    // 4. Build chat context
    const history = await this.loadMessageHistory(db, conversation.id);
    const systemPrompt = await this.loadSystemPrompt(db, conversation.language);
    const enabledTools = await this.toolRegistry.getEnabledTools(db);

    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: message.content },
    ];

    // 5. LLM chat + tool call loop
    let llmResponse: ChatResponse;
    let iterations = 0;
    let currentMessages = messages;

    do {
      llmResponse = await this.llm.chat({
        messages: currentMessages,
        tools: enabledTools,
        systemPrompt,
        temperature: 0.3,
      });

      // If the LLM wants to call tools
      if (llmResponse.toolCalls.length > 0 && toolExecutor) {
        for (const toolCall of llmResponse.toolCalls) {
          const startedAt = new Date();
          const isEnabled = await this.toolRegistry.isToolEnabled(
            db, toolCall.name as AgentToolName,
          );

          let toolResult: string;

          if (!isEnabled) {
            toolResult = JSON.stringify({
              error: 'TOOL_DISABLED',
              message: 'This tool is currently disabled by the administrator.',
            });
          } else {
            try {
              const result = await toolExecutor(
                toolCall.name as AgentToolName,
                JSON.parse(toolCall.arguments),
                { conversationId: conversation.id, patientId: conversation.patientId, locale: conversation.language, db },
              );
              toolResult = JSON.stringify(result);
            } catch (error) {
              toolResult = JSON.stringify({
                error: 'TOOL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }

          const completedAt = new Date();

          // Log tool call (rule 3)
          await this.toolRegistry.logToolCall(db, {
            conversationId: conversation.id,
            toolName: toolCall.name,
            inputParams: JSON.parse(toolCall.arguments),
            outputResult: JSON.parse(toolResult),
            startedAt,
            completedAt,
            toolWasEnabled: isEnabled,
          });

          // Feed result back to LLM
          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: '', toolCallId: toolCall.id, name: toolCall.name },
            { role: 'tool', content: toolResult, toolCallId: toolCall.id },
          ];
        }
      }

      iterations++;
    } while (
      llmResponse.toolCalls.length > 0 &&
      iterations < this.config.maxToolIterations
    );

    // 6. Output Guard
    const outputResult = checkOutput(llmResponse.content, conversation.language);
    const safeContent = getSafeContent(outputResult);

    // 7. Save assistant response
    const assistantSeq = userSeq + 1;
    const guardAction = outputResult.type === 'blocked' ? 'blocked_output' : 'passed';
    await this.saveMessage(db, conversation.id, assistantSeq, 'assistant', safeContent, guardAction);

    // 8. Check for auto-escalation on repeated failures
    let escalated = false;
    if (outputResult.type === 'blocked') {
      const failures = conversation.consecutiveFailures + 1;
      if (shouldAutoEscalate(failures, this.config.autoEscalateThreshold)) {
        await escalateConversation(db, {
          conversationId: conversation.id,
          trigger: 'repeated_failure',
          locale: conversation.language,
        });
        escalated = true;
      }
    }

    return {
      conversationId: conversation.id,
      content: safeContent,
      outputGuardAction: outputResult.type,
      escalated,
      status: escalated ? 'escalated' : 'active',
    };
  }

  /**
   * Start a new conversation with a welcome message.
   */
  async startConversation(
    db: Queryable,
    params: { patientId?: string; locale?: Locale; source?: string },
  ): Promise<AgentResponse> {
    const locale = params.locale ?? 'ar';
    const conversation = await this.createConversation(db, {
      conversationId: null,
      content: '',
      patientId: params.patientId,
      locale,
      source: params.source,
    });

    if (!conversation) {
      return {
        conversationId: '',
        content: 'Error creating conversation.',
        escalated: false,
        status: 'active',
      };
    }

    // Load welcome message from config
    const welcomeKey = locale === 'ar' ? 'welcome_message_ar' : 'welcome_message_en';
    const welcomeMessage = await this.loadConfigValue(db, welcomeKey);

    const defaultWelcome = locale === 'ar'
      ? 'مرحباً! أنا المساعد الذكي في منصة زامو. يمكنني مساعدتك في البحث عن خدمات طبية وحجز المواعيد. ⚠️ أنا مساعد إداري ولا أقدم استشارات طبية. يمكنك التحويل لموظف بشري في أي وقت.'
      : 'Hello! I am Zamo\'s smart assistant. I can help you search for medical services and book appointments. ⚠️ I am an administrative assistant and do not provide medical consultations. You can transfer to a human agent at any time.';

    const content = welcomeMessage ?? defaultWelcome;

    // Save welcome message
    await this.saveMessage(db, conversation.id, 1, 'assistant', content, 'passed');

    return {
      conversationId: conversation.id,
      content,
      escalated: false,
      status: 'active',
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async createConversation(
    db: Queryable,
    message: UserMessage,
  ): Promise<ConversationState | null> {
    const locale = message.locale ?? 'ar';
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO conversations (patient_id, language, source)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [message.patientId ?? null, locale, message.source ?? null],
    );

    if (rows.length === 0) return null;

    return {
      id: rows[0].id,
      patientId: message.patientId ?? null,
      language: locale,
      status: 'active',
      messageCount: 0,
      consecutiveFailures: 0,
    };
  }

  private async loadConversation(
    db: Queryable,
    conversationId: string,
  ): Promise<ConversationState | null> {
    const { rows } = await db.query<{
      id: string;
      patient_id: string | null;
      language: string;
      status: string;
    }>(
      `SELECT id, patient_id, language, status FROM conversations WHERE id = $1`,
      [conversationId],
    );

    if (rows.length === 0) return null;

    const { rows: msgRows } = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM conversation_messages WHERE conversation_id = $1`,
      [conversationId],
    );

    const { rows: failRows } = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM conversation_messages
       WHERE conversation_id = $1
         AND guard_action IN ('blocked_output', 'blocked_medical')
         AND created_at > (
           SELECT COALESCE(MAX(created_at), '1970-01-01')
           FROM conversation_messages
           WHERE conversation_id = $1 AND guard_action = 'passed' AND role = 'assistant'
         )`,
      [conversationId],
    );

    return {
      id: rows[0].id,
      patientId: rows[0].patient_id,
      language: rows[0].language as Locale,
      status: rows[0].status as ConversationState['status'],
      messageCount: parseInt(msgRows[0]?.count ?? '0', 10),
      consecutiveFailures: parseInt(failRows[0]?.count ?? '0', 10),
    };
  }

  private async loadMessageHistory(
    db: Queryable,
    conversationId: string,
  ): Promise<ChatMessage[]> {
    const { rows } = await db.query<{
      role: string;
      content: string;
    }>(
      `SELECT role, content FROM conversation_messages
       WHERE conversation_id = $1
         AND role IN ('user', 'assistant', 'system')
       ORDER BY sequence
       LIMIT 50`,  // Keep context window manageable
      [conversationId],
    );

    return rows.map((r) => ({
      role: r.role as ChatMessage['role'],
      content: r.content,
    }));
  }

  private async loadSystemPrompt(db: Queryable, locale: Locale): Promise<string> {
    const key = locale === 'ar' ? 'system_prompt_ar' : 'system_prompt_en';
    const value = await this.loadConfigValue(db, key);
    return value ?? (locale === 'ar'
      ? 'أنت مساعد ذكي في منصة زامو الطبية. دورك إداري فقط.'
      : 'You are a smart assistant on the Zamo Medical platform. Your role is strictly administrative.');
  }

  private async loadConfigValue(db: Queryable, key: string): Promise<string | null> {
    const { rows } = await db.query<{ value_text: string | null }>(
      `SELECT value_text FROM agent_config WHERE config_key = $1`,
      [key],
    );
    return rows[0]?.value_text ?? null;
  }

  private async saveMessage(
    db: Queryable,
    conversationId: string,
    sequence: number,
    role: string,
    content: string,
    guardAction: string,
  ): Promise<void> {
    await db.query(
      `INSERT INTO conversation_messages (conversation_id, sequence, role, content, guard_action)
       VALUES ($1, $2, $3, $4, $5)`,
      [conversationId, sequence, role, content, guardAction],
    );
  }
}

// ---------------------------------------------------------------------------
// Tool executor type
// ---------------------------------------------------------------------------

export type ToolExecutorFn = (
  toolName: AgentToolName,
  args: Record<string, unknown>,
  context: { conversationId: string; patientId: string | null; locale: Locale; db: Queryable },
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createConversationEngine(
  llm: LlmPort,
  config?: Partial<ConversationEngineConfig>,
): ConversationEngine {
  return new ConversationEngine(llm, new ToolRegistry(), config);
}
