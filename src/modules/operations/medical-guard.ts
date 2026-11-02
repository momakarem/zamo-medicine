/**
 * ZAMO-OPS-041 — Medical Content Guard (DEC-014).
 *
 * Ensures that admin_notes and other free-text fields do NOT contain
 * medical/diagnostic content. The platform is administrative only —
 * no medical records, diagnoses, treatments, or prescriptions.
 *
 * DEC-014: «❌ لا MedicalRecord، ولا حقل تشخيص أو علاج أو دواء.
 *           الملاحظات الإدارية حقل إداري فقط ويُختبر بفحص آلي.»
 *
 * This module is used by:
 *   - operations-service.ts (recordService → admin_notes)
 *   - scan-medical-fields.mjs (build-time scan)
 */

// ---------------------------------------------------------------------------
// Medical term lists — Arabic and English
// ---------------------------------------------------------------------------

/**
 * Arabic medical terms that MUST NOT appear in admin notes.
 * These indicate diagnostic/treatment content.
 */
const MEDICAL_TERMS_AR: readonly string[] = [
  // Diagnosis
  'تشخيص',
  'مرض',
  'أعراض',
  'علامات',
  'حالة مرضية',
  'متلازمة',
  'أورام',
  'سرطان',
  'التهاب',
  'كسر',
  'عدوى',

  // Treatment
  'علاج',
  'وصفة',
  'دواء',
  'حبوب',
  'حقنة',
  'جرعة',
  'مضاد حيوي',
  'مسكن',
  'عملية جراحية',
  'تخدير',

  // Medical records
  'سجل طبي',
  'تقرير طبي',
  'نتيجة الفحص',
  'أشعة',
  'تحليل',
  'مختبر',

  // Prescriptions
  'روشتة',
  'وصفة طبية',
  'ملغ',  // milligrams
] as const;

/**
 * English medical terms that MUST NOT appear in admin notes.
 */
const MEDICAL_TERMS_EN: readonly string[] = [
  // Diagnosis
  'diagnosis',
  'diagnosed',
  'symptoms',
  'syndrome',
  'tumor',
  'cancer',
  'infection',
  'fracture',
  'inflammation',
  'disease',
  'pathology',
  'prognosis',

  // Treatment
  'treatment',
  'prescription',
  'medication',
  'drug',
  'antibiotic',
  'painkiller',
  'surgery',
  'anesthesia',
  'dosage',
  'therapy',
  'injection',

  // Medical records
  'medical record',
  'lab result',
  'x-ray',
  'mri',
  'ct scan',
  'blood test',

  // Prescriptions
  'prescribe',
  'rx',
  'mg tablet',
] as const;

// ---------------------------------------------------------------------------
// Guard functions
// ---------------------------------------------------------------------------

export interface MedicalContentResult {
  /** Whether the text contains medical content. */
  containsMedical: boolean;
  /** The matched terms (empty if clean). */
  matchedTerms: string[];
}

/**
 * Check if a text string contains medical/diagnostic content.
 *
 * Returns a result indicating whether medical content was found
 * and which terms matched.
 *
 * ❗ This is a safety check, not a medical NLP system.
 *    It errs on the side of caution — false positives are acceptable,
 *    false negatives are not.
 */
export function checkMedicalContent(text: string | null | undefined): MedicalContentResult {
  if (!text || text.trim().length === 0) {
    return { containsMedical: false, matchedTerms: [] };
  }

  const normalized = text.toLowerCase().trim();
  const matchedTerms: string[] = [];

  // Check Arabic terms
  for (const term of MEDICAL_TERMS_AR) {
    if (normalized.includes(term)) {
      matchedTerms.push(term);
    }
  }

  // Check English terms
  for (const term of MEDICAL_TERMS_EN) {
    if (normalized.includes(term)) {
      matchedTerms.push(term);
    }
  }

  return {
    containsMedical: matchedTerms.length > 0,
    matchedTerms,
  };
}

/**
 * Validate that admin_notes do NOT contain medical content.
 * Throws a descriptive error if medical content is detected.
 *
 * Used as a guard in operations-service.ts before saving.
 */
export function assertNoMedicalContent(
  fieldName: string,
  text: string | null | undefined,
): void {
  const result = checkMedicalContent(text);
  if (result.containsMedical) {
    throw new MedicalContentError(
      fieldName,
      result.matchedTerms,
    );
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class MedicalContentError extends Error {
  readonly fieldName: string;
  readonly matchedTerms: string[];

  constructor(fieldName: string, matchedTerms: string[]) {
    super(
      `DEC-014 violation: field "${fieldName}" contains medical content. ` +
      `Matched terms: [${matchedTerms.join(', ')}]. ` +
      `Admin notes must be administrative only — no diagnosis, treatment, or medication.`,
    );
    this.name = 'MedicalContentError';
    this.fieldName = fieldName;
    this.matchedTerms = matchedTerms;
  }
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export const _MEDICAL_TERMS_AR = MEDICAL_TERMS_AR;
export const _MEDICAL_TERMS_EN = MEDICAL_TERMS_EN;
