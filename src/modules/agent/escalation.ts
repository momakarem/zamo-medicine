/**
 * ZAMO-AGENT-053 — Human Escalation (التصعيد لموظف بشري).
 *
 * Provides both manual and automatic escalation:
 *   - Manual: Patient clicks "transfer to agent" button (always available)
 *   - Auto: System detects medical intent, emergency, or repeated failures
 *
 * Key rules:
 *   ❗ Escalation preserves full conversation context.
 *   ❗ Available at every stage of the conversation.
 *   ❗ escalate_to_human is always-on — cannot be disabled from admin.
 */

import type { Queryable } from '../../db/client.ts';
import type { Locale } from '../../shared/i18n.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscalationTrigger =
  | 'manual'           // Patient clicked escalation button
  | 'medical_intent'   // Input guard detected medical question
  | 'emergency'        // Input guard detected emergency
  | 'repeated_failure' // Agent failed to resolve after N attempts
  | 'prompt_injection' // Input guard detected injection attempt
  | 'system';          // System-initiated escalation

export interface EscalationRequest {
  conversationId: string;
  trigger: EscalationTrigger;
  reason?: string;
  locale: Locale;
}

export interface EscalationResult {
  success: boolean;
  messageAr: string;
  messageEn: string;
  /** Conversation was already escalated. */
  alreadyEscalated: boolean;
}

// ---------------------------------------------------------------------------
// Response messages
// ---------------------------------------------------------------------------

const ESCALATION_MESSAGES = {
  manual: {
    ar: 'تم تحويلك لموظف خدمة العملاء. سيتواصل معك في أقرب وقت. سياق محادثتك محفوظ ولن تحتاج لإعادة شرح طلبك.',
    en: 'You have been transferred to a customer service agent. They will contact you shortly. Your conversation context is preserved — you won\'t need to re-explain your request.',
  },
  medical_intent: {
    ar: 'تم تحويلك لموظف مختص يمكنه مساعدتك بشكل أفضل. سياق محادثتك محفوظ.',
    en: 'You have been transferred to a specialized agent who can better assist you. Your conversation context is preserved.',
  },
  emergency: {
    ar: '🚨 تم تحويلك لموظف مختص. أرجوك اتصل بالطوارئ على 997 إذا كانت حالة طارئة.',
    en: '🚨 You have been transferred to a specialized agent. Please call 997 if this is an emergency.',
  },
  repeated_failure: {
    ar: 'يبدو أنني لم أتمكن من مساعدتك بالشكل المطلوب. سأحولك لموظف يمكنه المساعدة.',
    en: 'It seems I was unable to help you as needed. I\'m transferring you to an agent who can assist.',
  },
  prompt_injection: {
    ar: 'تم تحويلك لموظف خدمة العملاء.',
    en: 'You have been transferred to customer service.',
  },
  system: {
    ar: 'تم تحويلك لموظف خدمة العملاء.',
    en: 'You have been transferred to customer service.',
  },
} as const;

// ---------------------------------------------------------------------------
// Escalation logic
// ---------------------------------------------------------------------------

/**
 * Escalate a conversation to a human agent.
 *
 * ❗ Always available, never fails (except if already escalated).
 */
export async function escalateConversation(
  db: Queryable,
  request: EscalationRequest,
): Promise<EscalationResult> {
  // Check if already escalated
  const { rows: existing } = await db.query<{ status: string }>(
    `SELECT status FROM conversations WHERE id = $1`,
    [request.conversationId],
  );

  if (existing.length === 0) {
    return {
      success: false,
      messageAr: 'المحادثة غير موجودة.',
      messageEn: 'Conversation not found.',
      alreadyEscalated: false,
    };
  }

  if (existing[0].status === 'escalated') {
    const msg = ESCALATION_MESSAGES[request.trigger];
    return {
      success: true,
      messageAr: 'محادثتك محولة بالفعل لموظف. سيتواصل معك قريباً.',
      messageEn: 'Your conversation is already transferred to an agent. They will contact you soon.',
      alreadyEscalated: true,
    };
  }

  // Update conversation status
  const reason = request.reason ?? formatEscalationReason(request.trigger);

  await db.query(
    `UPDATE conversations
     SET status = 'escalated',
         escalated_at = now(),
         escalation_reason = $1
     WHERE id = $2`,
    [reason, request.conversationId],
  );

  const messages = ESCALATION_MESSAGES[request.trigger];

  return {
    success: true,
    messageAr: messages.ar,
    messageEn: messages.en,
    alreadyEscalated: false,
  };
}

/**
 * Get the localized escalation message.
 */
export function getEscalationMessage(
  result: EscalationResult,
  locale: Locale,
): string {
  return locale === 'ar' ? result.messageAr : result.messageEn;
}

/**
 * Check if a conversation should be auto-escalated based on failure count.
 *
 * After 3 consecutive guard blocks or tool failures, auto-escalate.
 */
export function shouldAutoEscalate(
  consecutiveFailures: number,
  threshold: number = 3,
): boolean {
  return consecutiveFailures >= threshold;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEscalationReason(trigger: EscalationTrigger): string {
  const reasons: Record<EscalationTrigger, string> = {
    manual: 'Patient requested human agent',
    medical_intent: 'Medical intent detected by input guard',
    emergency: 'Emergency detected by input guard',
    repeated_failure: 'Repeated failures — auto-escalated',
    prompt_injection: 'Prompt injection detected',
    system: 'System-initiated escalation',
  };
  return reasons[trigger];
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export const _ESCALATION_MESSAGES = ESCALATION_MESSAGES;
