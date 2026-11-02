/**
 * ZAMO-AGENT-046 — LLM Port (B-09 / DEC-009).
 *
 * Abstract interface for LLM providers. The agent engine depends ONLY on
 * this port — never on a concrete provider. This enables:
 *   - Testing with a deterministic mock (llm-mock.ts)
 *   - Swapping providers without changing business logic
 *   - Budget enforcement at the adapter level
 *
 * B-09: Initial provider is OpenAI (GPT-4o-mini / GPT-4o).
 *       The interface is designed to be provider-agnostic.
 *
 * DEC-009: «واجهة LlmPort مجرّدة — المزود المبدئي OpenAI.
 *           أي تغيير يسبقه توثيق السبب + المقارنة + التأثير.»
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A message in the chat history. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For role='tool': the tool call ID this result belongs to. */
  toolCallId?: string;
  /** For role='assistant': name of the function being called. */
  name?: string;
}

/** A tool (function) the LLM can call. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>;
}

/** A tool call requested by the LLM. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;  // JSON string
}

/** Parameters for a chat completion request. */
export interface ChatParams {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** System prompt prepended to messages (convenience — also settable as first message). */
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Which model tier to use. */
  modelTier?: 'default' | 'complex';
}

/** Response from a chat completion. */
export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

/**
 * Abstract LLM port. All agent code depends on this interface.
 *
 * Implementations:
 *   - llm-mock.ts   — deterministic mock for testing
 *   - llm-openai.ts — OpenAI Chat Completions API
 */
export interface LlmPort {
  /**
   * Send a chat completion request.
   *
   * The implementation is responsible for:
   *   - Mapping our types to the provider's API
   *   - Handling retries and rate limits
   *   - Tracking usage for budget enforcement
   */
  chat(params: ChatParams): Promise<ChatResponse>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly provider: string;

  constructor(code: LlmErrorCode, provider: string, message: string) {
    super(`[${provider}] ${message}`);
    this.name = 'LlmError';
    this.code = code;
    this.provider = provider;
  }
}

export type LlmErrorCode =
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'CONTENT_FILTERED';
