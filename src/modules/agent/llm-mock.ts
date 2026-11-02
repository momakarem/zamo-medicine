/**
 * ZAMO-AGENT-046 — Mock LLM adapter for testing.
 *
 * Provides deterministic responses so that agent logic can be tested
 * without hitting a real LLM API. Supports:
 *   - Scripted responses (queue of responses to return in order)
 *   - Tool call simulation
 *   - Default fallback response
 *   - Call history inspection
 */

import type {
  LlmPort,
  ChatParams,
  ChatResponse,
  ToolCall,
} from './llm-port.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockResponse {
  content?: string;
  toolCalls?: ToolCall[];
  finishReason?: ChatResponse['finishReason'];
}

// ---------------------------------------------------------------------------
// Mock LLM
// ---------------------------------------------------------------------------

export class MockLlm implements LlmPort {
  /** Queue of scripted responses. Consumed in order (FIFO). */
  private readonly responseQueue: MockResponse[] = [];

  /** History of all calls made (for assertions). */
  readonly callHistory: ChatParams[] = [];

  /** Default response when queue is empty. */
  private defaultResponse: MockResponse = {
    content: 'Mock LLM response',
    finishReason: 'stop',
  };

  // -----------------------------------------------------------------------
  // Setup helpers
  // -----------------------------------------------------------------------

  /**
   * Enqueue one or more responses. They'll be returned in order.
   */
  enqueue(...responses: MockResponse[]): this {
    this.responseQueue.push(...responses);
    return this;
  }

  /**
   * Set the default response used when the queue is empty.
   */
  setDefault(response: MockResponse): this {
    this.defaultResponse = response;
    return this;
  }

  /**
   * Enqueue a response that includes tool calls.
   */
  enqueueToolCall(name: string, args: Record<string, unknown>): this {
    return this.enqueue({
      content: '',
      toolCalls: [{
        id: `call_${this.responseQueue.length}_${Date.now()}`,
        name,
        arguments: JSON.stringify(args),
      }],
      finishReason: 'tool_calls',
    });
  }

  /**
   * Reset the mock: clear queue, history, and default.
   */
  reset(): this {
    this.responseQueue.length = 0;
    this.callHistory.length = 0;
    this.defaultResponse = { content: 'Mock LLM response', finishReason: 'stop' };
    return this;
  }

  // -----------------------------------------------------------------------
  // LlmPort implementation
  // -----------------------------------------------------------------------

  async chat(params: ChatParams): Promise<ChatResponse> {
    this.callHistory.push(params);

    const mock = this.responseQueue.shift() ?? this.defaultResponse;

    return {
      content: mock.content ?? '',
      toolCalls: mock.toolCalls ?? [],
      finishReason: mock.finishReason ?? 'stop',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Inspection helpers
  // -----------------------------------------------------------------------

  /** Number of calls made so far. */
  get callCount(): number {
    return this.callHistory.length;
  }

  /** The last call's parameters, or undefined if no calls. */
  get lastCall(): ChatParams | undefined {
    return this.callHistory[this.callHistory.length - 1];
  }

  /** Whether the system prompt in the last call contains a substring. */
  lastSystemPromptIncludes(text: string): boolean {
    const last = this.lastCall;
    if (!last) return false;
    if (last.systemPrompt?.includes(text)) return true;
    return last.messages.some(
      (m) => m.role === 'system' && m.content.includes(text),
    );
  }
}
