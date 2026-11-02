/**
 * ZAMO-AGENT-049 — Output Guard (حاجز المخرجات).
 *
 * Inspects every LLM response BEFORE it reaches the patient. Blocks:
 *   1. Medical diagnosis / treatment / medication content
 *   2. Superlatives without data — «أفضل طبيب» (A-38)
 *   3. Medical outcome promises — «ستشفى» «نتيجة مضمونة»
 *   4. False booking confirmation — «تم تأكيد حجزك» (A-12)
 *
 * ❗ ARCH §9.2 rule 6: «حاجز المخرجات ليس اختياريًا —
 *    هو الضمانة التقنية للمبدأ الحاكم»
 *
 * If content is blocked, the guard returns a sanitized version
 * or a safe fallback message.
 */

import type { Locale } from '../../shared/i18n.ts';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type OutputGuardResult =
  | { type: 'pass'; content: string }
  | { type: 'blocked'; reason: OutputBlockReason; matchedTerms: string[]; sanitized: string };

export type OutputBlockReason =
  | 'medical_content'
  | 'superlative_no_data'
  | 'medical_promise'
  | 'false_confirmation';

// ---------------------------------------------------------------------------
// Medical content — diagnosis, treatment, medication
// ---------------------------------------------------------------------------

const MEDICAL_OUTPUT_AR: readonly string[] = [
  // Diagnosis
  'تشخيصك',
  'التشخيص هو',
  'أنت مصاب',
  'لديك مرض',
  'عندك مرض',
  'الحالة هي',
  'تعاني من',
  'مصاب بـ',
  'يبدو أنك مصاب',

  // Treatment recommendations
  'خذ هذا الدواء',
  'تناول',
  'الجرعة هي',
  'اشرب هذا',
  'استخدم هذا المرهم',
  'أنصحك بأخذ',
  'يجب أن تأخذ',
  'العلاج هو',
  'العلاج المناسب',
  'الوصفة هي',

  // Medical advice
  'من الناحية الطبية',
  'طبياً',
  'كطبيب',
  'رأيي الطبي',
  'نصيحتي الطبية',
] as const;

const MEDICAL_OUTPUT_EN: readonly string[] = [
  // Diagnosis
  'your diagnosis',
  'the diagnosis is',
  'you have been diagnosed',
  'you are suffering from',
  'you have a condition',
  'it appears you have',
  'you likely have',
  'based on your symptoms',

  // Treatment
  'take this medication',
  'the dosage is',
  'use this ointment',
  'i recommend taking',
  'you should take',
  'the treatment is',
  'the prescription is',
  'apply this cream',

  // Medical advice
  'medically speaking',
  'as a doctor',
  'my medical opinion',
  'my medical advice',
  'from a medical standpoint',
] as const;

// ---------------------------------------------------------------------------
// Superlatives without data (A-38 / B-22)
//
// «ممنوع "أفضل طبيب" بلا معيار معلن»
// ---------------------------------------------------------------------------

const SUPERLATIVE_AR: readonly string[] = [
  'أفضل طبيب',
  'أفضل دكتور',
  'أفضل عيادة',
  'أفضل مستشفى',
  'أفضل اختيار',
  'الطبيب الأفضل',
  'الأفضل في',
  'أحسن طبيب',
  'أحسن دكتور',
  'أمهر طبيب',
  'أشطر طبيب',
  'أشطر دكتور',
  'الأكثر خبرة',
  'الأكثر كفاءة',
  'ننصح بشدة',
  'نوصي بشدة',
  'لا يوجد أفضل من',
  'هو الأفضل',
  'هي الأفضل',
] as const;

const SUPERLATIVE_EN: readonly string[] = [
  'best doctor',
  'best clinic',
  'best hospital',
  'best choice',
  'the best in',
  'top doctor',
  'top-rated',
  'most skilled',
  'most experienced',
  'most qualified',
  'highly recommended',
  'strongly recommend',
  'no one better',
  'the finest',
  'the greatest',
  'number one',
  '#1 doctor',
] as const;

// ---------------------------------------------------------------------------
// Medical promises
// ---------------------------------------------------------------------------

const PROMISE_AR: readonly string[] = [
  'ستشفى',
  'سوف تشفى',
  'ستتعافى',
  'مضمون',
  'نتيجة مضمونة',
  'نسبة نجاح',
  'نسبة الشفاء',
  'مؤكد الشفاء',
  'بإذن الله تشفى',
  'ما تقلق',
  'لا تقلق ستشفى',
  'الشفاء مؤكد',
] as const;

const PROMISE_EN: readonly string[] = [
  'you will be cured',
  'you will heal',
  'you will recover',
  'guaranteed result',
  'guaranteed outcome',
  'success rate',
  'cure rate',
  'certain recovery',
  'nothing to worry about',
  "don't worry you'll be fine",
  'guaranteed cure',
] as const;

// ---------------------------------------------------------------------------
// False confirmation (A-12)
//
// «لا تظهر عبارة "تم تأكيد الحجز" قبل رد الاستقبال»
// ---------------------------------------------------------------------------

const FALSE_CONFIRM_AR: readonly string[] = [
  'تم تأكيد حجزك',
  'تم تأكيد الحجز',
  'حجزك مؤكد',
  'الحجز مؤكد',
  'تم تأكيد موعدك',
  'موعدك مؤكد',
  'تأكد الحجز',
  'تم الحجز بنجاح',
] as const;

const FALSE_CONFIRM_EN: readonly string[] = [
  'your booking is confirmed',
  'booking confirmed',
  'your appointment is confirmed',
  'appointment confirmed',
  'successfully booked',
  'booking has been confirmed',
  'your reservation is confirmed',
] as const;

// ---------------------------------------------------------------------------
// Fallback messages
// ---------------------------------------------------------------------------

const FALLBACK = {
  medical_content: {
    ar: 'أنا مساعد إداري ولا أقدم استشارات طبية. يمكنني مساعدتك في حجز موعد مع طبيب مختص.',
    en: 'I am an administrative assistant and do not provide medical advice. I can help you book an appointment with a qualified doctor.',
  },
  superlative_no_data: {
    ar: 'لا أستطيع وصف طبيب بأنه "الأفضل" دون معيار واضح. يمكنني مساعدتك في مقارنة الأطباء بناءً على المسافة أو السعر أو أقرب موعد.',
    en: 'I cannot describe a doctor as "the best" without a clear criterion. I can help you compare doctors based on distance, price, or nearest appointment.',
  },
  medical_promise: {
    ar: 'لا أستطيع ضمان نتائج طبية. يمكنني مساعدتك في حجز موعد لاستشارة طبيب مختص.',
    en: 'I cannot guarantee medical outcomes. I can help you book an appointment to consult with a qualified doctor.',
  },
  false_confirmation: {
    ar: 'تم إرسال طلب حجزك إلى العيادة، وسنبلغك فور تأكيد الموعد.',
    en: 'Your booking request has been sent to the clinic. We will notify you once the appointment is confirmed.',
  },
} as const;

// ---------------------------------------------------------------------------
// Guard function
// ---------------------------------------------------------------------------

/**
 * Check an LLM response before sending it to the patient.
 *
 * Order of checks:
 *   1. False confirmation (A-12) — replace with correct message
 *   2. Medical content — block entirely
 *   3. Superlatives without data (A-38) — block
 *   4. Medical promises — block
 *   5. Pass
 */
export function checkOutput(content: string, locale: Locale = 'ar'): OutputGuardResult {
  if (!content || content.trim().length === 0) {
    return { type: 'pass', content: '' };
  }

  const normalized = content.toLowerCase().trim();

  // 1. False confirmation (A-12) — most specific, easiest to fix
  const falseConfirmMatches = findMatches(normalized, FALSE_CONFIRM_AR, FALSE_CONFIRM_EN);
  if (falseConfirmMatches.length > 0) {
    return {
      type: 'blocked',
      reason: 'false_confirmation',
      matchedTerms: falseConfirmMatches,
      sanitized: locale === 'ar'
        ? FALLBACK.false_confirmation.ar
        : FALLBACK.false_confirmation.en,
    };
  }

  // 2. Medical content
  const medicalMatches = findMatches(normalized, MEDICAL_OUTPUT_AR, MEDICAL_OUTPUT_EN);
  if (medicalMatches.length > 0) {
    return {
      type: 'blocked',
      reason: 'medical_content',
      matchedTerms: medicalMatches,
      sanitized: locale === 'ar'
        ? FALLBACK.medical_content.ar
        : FALLBACK.medical_content.en,
    };
  }

  // 3. Superlatives without data (A-38)
  const superlativeMatches = findMatches(normalized, SUPERLATIVE_AR, SUPERLATIVE_EN);
  if (superlativeMatches.length > 0) {
    return {
      type: 'blocked',
      reason: 'superlative_no_data',
      matchedTerms: superlativeMatches,
      sanitized: locale === 'ar'
        ? FALLBACK.superlative_no_data.ar
        : FALLBACK.superlative_no_data.en,
    };
  }

  // 4. Medical promises
  const promiseMatches = findMatches(normalized, PROMISE_AR, PROMISE_EN);
  if (promiseMatches.length > 0) {
    return {
      type: 'blocked',
      reason: 'medical_promise',
      matchedTerms: promiseMatches,
      sanitized: locale === 'ar'
        ? FALLBACK.medical_promise.ar
        : FALLBACK.medical_promise.en,
    };
  }

  // 5. Safe — pass through
  return { type: 'pass', content };
}

/**
 * Get the sanitized/fallback content from a guard result.
 * Returns the original content if it passed.
 */
export function getSafeContent(result: OutputGuardResult): string {
  return result.type === 'pass' ? result.content : result.sanitized;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findMatches(
  text: string,
  arTerms: readonly string[],
  enTerms: readonly string[],
): string[] {
  const matched: string[] = [];
  for (const term of arTerms) {
    if (text.includes(term)) matched.push(term);
  }
  for (const term of enTerms) {
    if (text.includes(term)) matched.push(term);
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export const _MEDICAL_OUTPUT_AR = MEDICAL_OUTPUT_AR;
export const _MEDICAL_OUTPUT_EN = MEDICAL_OUTPUT_EN;
export const _SUPERLATIVE_AR = SUPERLATIVE_AR;
export const _SUPERLATIVE_EN = SUPERLATIVE_EN;
export const _PROMISE_AR = PROMISE_AR;
export const _PROMISE_EN = PROMISE_EN;
export const _FALSE_CONFIRM_AR = FALSE_CONFIRM_AR;
export const _FALSE_CONFIRM_EN = FALSE_CONFIRM_EN;
export const _FALLBACK = FALLBACK;
