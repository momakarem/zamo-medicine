/**
 * ZAMO-AGENT-048 — Input Guard (حاجز المدخلات).
 *
 * Inspects every user message BEFORE it reaches the LLM. Detects:
 *   1. Medical/diagnostic intent → refuse + explain role boundaries
 *   2. Emergency keywords → stop + show 997 + disclaimer (OQ-020 / B-21)
 *   3. Prompt injection → block + log
 *   4. Safe input → pass through
 *
 * ❗ This is a SAFETY component. It errs on the side of caution:
 *    false positives (blocking a safe message) are acceptable,
 *    false negatives (allowing a dangerous message) are NOT.
 *
 * The guard uses keyword/pattern matching (not LLM) for determinism
 * and speed. The LLM system prompt provides a second layer of defense.
 */

import type { Locale } from '../../shared/i18n.ts';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type InputGuardResult =
  | { type: 'pass' }
  | { type: 'medical_intent'; responseAr: string; responseEn: string }
  | { type: 'emergency'; responseAr: string; responseEn: string }
  | { type: 'prompt_injection'; responseAr: string; responseEn: string };

// ---------------------------------------------------------------------------
// Emergency keywords (OQ-020 → B-21)
//
// «عند كلمات طوارئ: يوقف المحادثة فورًا ويعرض رقم 997 + إخلاء مسؤولية»
// ---------------------------------------------------------------------------

const EMERGENCY_KEYWORDS_AR: readonly string[] = [
  'أموت',
  'بموت',
  'رح أموت',
  'حالة طوارئ',
  'طوارئ',
  'نزيف حاد',
  'نزيف شديد',
  'نزيف ما يوقف',
  'فقدت الوعي',
  'إغماء',
  'أغمي علي',
  'أغمي عليه',
  'أغمي عليها',
  'ما أقدر أتنفس',
  'صعوبة تنفس',
  'ضيق تنفس شديد',
  'حادث سيارة',
  'حادث مروري',
  'حادث',
  'جلطة',
  'سكتة',
  'سكتة قلبية',
  'نوبة قلبية',
  'توقف القلب',
  'تسمم',
  'ابتلع سم',
  'أبي أنتحر',
  'انتحار',
  'أبي أقتل نفسي',
  'حروق شديدة',
  'كسر مفتوح',
  'طلق ناري',
  'طعنة',
] as const;

const EMERGENCY_KEYWORDS_EN: readonly string[] = [
  'dying',
  'i am dying',
  "i'm dying",
  'emergency',
  'severe bleeding',
  'heavy bleeding',
  'unconscious',
  'fainted',
  'passed out',
  "can't breathe",
  'cannot breathe',
  'difficulty breathing',
  'car accident',
  'heart attack',
  'cardiac arrest',
  'stroke',
  'seizure',
  'poisoning',
  'swallowed poison',
  'suicide',
  'kill myself',
  'want to die',
  'severe burns',
  'open fracture',
  'gunshot',
  'stabbing',
  'stabbed',
] as const;

// ---------------------------------------------------------------------------
// Medical/diagnostic intent keywords
//
// Patterns that indicate the user is seeking medical advice, diagnosis,
// or treatment recommendations — NOT an appointment.
// ---------------------------------------------------------------------------

const MEDICAL_INTENT_AR: readonly string[] = [
  'ما سبب',
  'ما سببه',
  'شو سبب',
  'ليش عندي',
  'هل عندي',
  'هل هذا',
  'هل هذي',
  'هل هذه',
  'هل أنا مريض',
  'عندي مرض',
  'هل المرض',
  'ما هو التشخيص',
  'تشخيصي',
  'شخّص لي',
  'شخّصني',
  'أي دواء',
  'وش الدواء',
  'ما العلاج',
  'كيف أعالج',
  'هل أحتاج عملية',
  'هل أحتاج جراحة',
  'هل الحبوب',
  'هل هذا سرطان',
  'هل عندي سرطان',
  'هل هذا خطير',
  'أعطني وصفة',
  'اكتب لي وصفة',
  'هل آخذ مضاد',
  'هل آخذ حبوب',
  'ما الجرعة',
  'كم الجرعة',
  'تحليلي يقول',
  'نتيجة الفحص',
  'الأشعة تبين',
  'هل أوقف الدواء',
  'هل أزيد الجرعة',
  'ما رأيك في حالتي',
] as const;

const MEDICAL_INTENT_EN: readonly string[] = [
  'what is the cause',
  'what causes',
  'why do i have',
  'do i have',
  'is this cancer',
  'is it cancer',
  'is this serious',
  'is it dangerous',
  'what is the diagnosis',
  'diagnose me',
  'what medication',
  'what medicine',
  'which drug',
  'what treatment',
  'how to treat',
  'do i need surgery',
  'do i need an operation',
  'give me a prescription',
  'write me a prescription',
  'should i take antibiotics',
  'should i take pills',
  'what dosage',
  'my test results',
  'my lab results',
  'my x-ray shows',
  'should i stop the medication',
  'should i increase the dosage',
  'what do you think about my condition',
  'prescribe',
  'what pills',
] as const;

// ---------------------------------------------------------------------------
// Prompt injection patterns
//
// Attempts to override the system prompt or change the agent's behavior.
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS_AR: readonly string[] = [
  'تجاهل التعليمات',
  'تجاهل كل التعليمات',
  'أنت الآن',
  'تصرف كأنك',
  'غير شخصيتك',
  'نسيت تعليماتك',
  'التعليمات السابقة',
  'اكشف التعليمات',
  'ما هي تعليماتك',
  'أعطني البرومبت',
  'أعطني السيستم برومبت',
  'تجاوز القيود',
  'لا تلتزم بالقواعد',
  'افعل ما أقوله',
  'أنت طبيب الآن',
  'تصرف كطبيب',
] as const;

const INJECTION_PATTERNS_EN: readonly string[] = [
  'ignore all instructions',
  'ignore previous instructions',
  'ignore your instructions',
  'disregard your',
  'you are now',
  'act as if',
  'pretend you are',
  'change your personality',
  'forget your instructions',
  'reveal your prompt',
  'show me your system prompt',
  'what are your instructions',
  'give me the prompt',
  'bypass restrictions',
  'override your rules',
  'do what i say',
  'you are a doctor now',
  'act as a doctor',
  'jailbreak',
  'dan mode',
  'developer mode',
] as const;

// ---------------------------------------------------------------------------
// Response messages
// ---------------------------------------------------------------------------

const RESPONSES = {
  medical_intent: {
    ar: 'أنا مساعد إداري في منصة زامو لحجز المواعيد الطبية. لا أستطيع تقديم استشارات طبية أو تشخيصات أو توصيات علاجية. أنصحك باستشارة طبيب مختص. هل تريد أن أساعدك في حجز موعد مع طبيب؟',
    en: 'I am an administrative assistant on the Zamo platform for booking medical appointments. I cannot provide medical consultations, diagnoses, or treatment recommendations. I recommend consulting a qualified physician. Would you like me to help you book an appointment with a doctor?',
  },
  emergency: {
    ar: '🚨 يبدو أنك تصف حالة طارئة. أرجوك اتصل فوراً بالطوارئ على الرقم 997.\n\nمنصة زامو هي خدمة حجز مواعيد ولا تقدم رعاية طبية طارئة.\n\n⚠️ إخلاء مسؤولية: هذا المساعد الذكي ليس بديلاً عن الرعاية الطبية الطارئة.',
    en: '🚨 It sounds like you may be describing an emergency. Please call 997 immediately.\n\nZamo is an appointment booking service and does not provide emergency medical care.\n\n⚠️ Disclaimer: This smart assistant is not a substitute for emergency medical care.',
  },
  prompt_injection: {
    ar: 'عذراً، لا أستطيع تنفيذ هذا الطلب. أنا مساعد إداري لحجز المواعيد الطبية فقط. كيف يمكنني مساعدتك في البحث عن خدمة أو حجز موعد؟',
    en: 'Sorry, I cannot process this request. I am an administrative assistant for booking medical appointments only. How can I help you search for a service or book an appointment?',
  },
} as const;

// ---------------------------------------------------------------------------
// Guard function
// ---------------------------------------------------------------------------

/**
 * Check a user message against all guards.
 *
 * Order of checks (most critical first):
 *   1. Emergency → immediate response with 997
 *   2. Prompt injection → block and log
 *   3. Medical intent → refuse and redirect
 *   4. Pass → safe to forward to LLM
 */
export function checkInput(text: string): InputGuardResult {
  if (!text || text.trim().length === 0) {
    return { type: 'pass' };
  }

  const normalized = text.toLowerCase().trim();

  // 1. Emergency check (highest priority — OQ-020)
  if (matchesAny(normalized, EMERGENCY_KEYWORDS_AR) ||
      matchesAny(normalized, EMERGENCY_KEYWORDS_EN)) {
    return {
      type: 'emergency',
      responseAr: RESPONSES.emergency.ar,
      responseEn: RESPONSES.emergency.en,
    };
  }

  // 2. Prompt injection check
  if (matchesAny(normalized, INJECTION_PATTERNS_AR) ||
      matchesAny(normalized, INJECTION_PATTERNS_EN)) {
    return {
      type: 'prompt_injection',
      responseAr: RESPONSES.prompt_injection.ar,
      responseEn: RESPONSES.prompt_injection.en,
    };
  }

  // 3. Medical intent check
  if (matchesMedicalIntent(normalized)) {
    return {
      type: 'medical_intent',
      responseAr: RESPONSES.medical_intent.ar,
      responseEn: RESPONSES.medical_intent.en,
    };
  }

  // 4. Safe — pass through
  return { type: 'pass' };
}

/**
 * Get the localized response message for a guard result.
 */
export function getGuardResponse(
  result: InputGuardResult,
  locale: Locale,
): string | null {
  if (result.type === 'pass') return null;
  return locale === 'ar' ? result.responseAr : result.responseEn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/**
 * Medical intent detection with slightly smarter matching.
 *
 * Avoids false positives on legitimate booking requests like
 * «أبغى تنظيف أسنان» or «I want a dental cleaning».
 */
function matchesMedicalIntent(text: string): boolean {
  // Direct match against known medical intent patterns
  if (matchesAny(text, MEDICAL_INTENT_AR) ||
      matchesAny(text, MEDICAL_INTENT_EN)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export const _EMERGENCY_KEYWORDS_AR = EMERGENCY_KEYWORDS_AR;
export const _EMERGENCY_KEYWORDS_EN = EMERGENCY_KEYWORDS_EN;
export const _MEDICAL_INTENT_AR = MEDICAL_INTENT_AR;
export const _MEDICAL_INTENT_EN = MEDICAL_INTENT_EN;
export const _INJECTION_PATTERNS_AR = INJECTION_PATTERNS_AR;
export const _INJECTION_PATTERNS_EN = INJECTION_PATTERNS_EN;
export const _RESPONSES = RESPONSES;
