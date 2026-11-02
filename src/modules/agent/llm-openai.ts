/**
 * ZAMO-AGENT-046 — OpenAI LLM adapter (B-09).
 *
 * Implements the LlmPort interface using OpenAI's Chat Completions API.
 *
 * B-09: «المزود المبدئي: OpenAI (GPT-4o-mini للمحادثات العادية ·
 *        GPT-4o للحالات المعقدة). سقف التكلفة الشهرية: 500$ أمريكي»
 *
 * DEC-009: «واجهة LlmPort مجرّدة. أي تغيير يسبقه توثيق السبب + المقارنة + التأثير.»
 *
 * Uses native `fetch` — no SDK dependency.
 */

import type {
  LlmPort,
  ChatParams,
  ChatResponse,
  ChatMessage,
  ToolDefinition,
  ToolCall,
} from './llm-port.ts';
import { LlmError } from './llm-port.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAIConfig {
  apiKey: string;
  defaultModel: string;
  complexModel: string;
  /** Monthly cost cap in USD. Adapter tracks cumulative usage. */
  monthlyCostCapUsd: number;
  /** Base URL for OpenAI API (for testing with mock servers). */
  baseUrl?: string;
  /** Timeout in ms. */
  timeoutMs?: number;
  /** Max retries on rate limit. */
  maxRetries?: number;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OpenAILlm implements LlmPort {
  private readonly config: OpenAIConfig;
  private monthlyUsageUsd: number = 0;
  private monthStartedAt: Date = new Date();

  constructor(config: OpenAIConfig) {
    this.config = config;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    // Budget check
    this.checkBudget();

    const model = params.modelTier === 'complex'
      ? this.config.complexModel
      : this.config.defaultModel;

    // Build messages
    const messages: OpenAIMessage[] = [];

    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt });
    }

    for (const msg of params.messages) {
      const openAIMsg: OpenAIMessage = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.toolCallId) openAIMsg.tool_call_id = msg.toolCallId;
      if (msg.name) openAIMsg.name = msg.name;
      messages.push(openAIMsg);
    }

    // Build tools
    const tools: OpenAITool[] | undefined = params.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Build request body
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: params.temperature ?? 0.3,
    };

    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (tools && tools.length > 0) body.tools = tools;

    // Call API with retries
    const response = await this.callWithRetry(body);

    // Track usage
    if (response.usage) {
      this.trackUsage(model, response.usage);
    }

    // Parse response
    const choice = response.choices?.[0];
    if (!choice) {
      throw new LlmError('PROVIDER_ERROR', 'openai', 'No choices in response');
    }

    const toolCalls: ToolCall[] = (choice.message?.tool_calls ?? []).map(
      (tc: { id: string; function: { name: string; arguments: string } }) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }),
    );

    return {
      content: choice.message?.content ?? '',
      toolCalls,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async callWithRetry(
    body: Record<string, unknown>,
    attempt: number = 0,
  ): Promise<Record<string, unknown>> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';
    const url = `${baseUrl}/chat/completions`;
    const maxRetries = this.config.maxRetries ?? 3;
    const timeoutMs = this.config.timeoutMs ?? 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        if (attempt < maxRetries) {
          const retryAfter = parseInt(response.headers.get('Retry-After') ?? '2', 10);
          await this.sleep(retryAfter * 1000);
          return this.callWithRetry(body, attempt + 1);
        }
        throw new LlmError('RATE_LIMITED', 'openai', 'Rate limited after max retries');
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new LlmError('PROVIDER_ERROR', 'openai', `HTTP ${response.status}: ${errorBody}`);
      }

      return await response.json() as Record<string, unknown>;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof LlmError) throw error;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new LlmError('TIMEOUT', 'openai', `Request timed out after ${timeoutMs}ms`);
      }

      throw new LlmError('PROVIDER_ERROR', 'openai', `Unexpected error: ${error}`);
    }
  }

  private checkBudget(): void {
    // Reset monthly counter if new month
    const now = new Date();
    if (now.getMonth() !== this.monthStartedAt.getMonth() ||
        now.getFullYear() !== this.monthStartedAt.getFullYear()) {
      this.monthlyUsageUsd = 0;
      this.monthStartedAt = now;
    }

    if (this.monthlyUsageUsd >= this.config.monthlyCostCapUsd) {
      throw new LlmError(
        'BUDGET_EXCEEDED',
        'openai',
        `Monthly budget of $${this.config.monthlyCostCapUsd} exceeded. Current: $${this.monthlyUsageUsd.toFixed(2)}`,
      );
    }
  }

  /**
   * Rough cost tracking.
   * GPT-4o-mini: ~$0.15/1M input, ~$0.60/1M output
   * GPT-4o: ~$2.50/1M input, ~$10.00/1M output
   */
  private trackUsage(
    model: string,
    usage: { prompt_tokens?: number; completion_tokens?: number },
  ): void {
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;

    let costUsd: number;
    if (model.includes('4o-mini')) {
      costUsd = (promptTokens * 0.00000015) + (completionTokens * 0.0000006);
    } else {
      // GPT-4o
      costUsd = (promptTokens * 0.0000025) + (completionTokens * 0.00001);
    }

    this.monthlyUsageUsd += costUsd;
  }

  private mapFinishReason(
    reason: string | undefined,
  ): ChatResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'stop';
      case 'tool_calls': return 'tool_calls';
      case 'length': return 'length';
      case 'content_filter': return 'content_filter';
      default: return 'stop';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -----------------------------------------------------------------------
  // Public inspection (for monitoring)
  // -----------------------------------------------------------------------

  get currentMonthlyUsageUsd(): number {
    return this.monthlyUsageUsd;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createOpenAILlm(config: OpenAIConfig): OpenAILlm {
  return new OpenAILlm(config);
}
