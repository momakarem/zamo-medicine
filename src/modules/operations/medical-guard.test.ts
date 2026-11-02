/**
 * ZAMO-OPS-041 — Medical Content Guard tests (DEC-014).
 *
 * Ensures that the medical content guard correctly identifies
 * diagnostic/treatment content in both Arabic and English,
 * and allows legitimate administrative notes.
 */
import { describe, it, expect } from 'vitest';
import {
  checkMedicalContent,
  assertNoMedicalContent,
  MedicalContentError,
  _MEDICAL_TERMS_AR,
  _MEDICAL_TERMS_EN,
} from './medical-guard.js';

// ---------------------------------------------------------------------------
// checkMedicalContent
// ---------------------------------------------------------------------------
describe('checkMedicalContent', () => {
  it('returns clean for null/undefined/empty', () => {
    expect(checkMedicalContent(null).containsMedical).toBe(false);
    expect(checkMedicalContent(undefined).containsMedical).toBe(false);
    expect(checkMedicalContent('').containsMedical).toBe(false);
    expect(checkMedicalContent('   ').containsMedical).toBe(false);
  });

  it('allows legitimate administrative notes (Arabic)', () => {
    const adminNotes = [
      'المريض وصل متأخرًا 10 دقائق',
      'تم تغيير الغرفة من 3 إلى 5',
      'المرافق: الأم',
      'ملاحظة: يفضل الموعد الصباحي',
      'تم التحويل من فرع الملقا',
      'دفع نقدي',
      'تأمين شركة بوبا — رقم البوليصة 123456',
    ];
    for (const note of adminNotes) {
      const result = checkMedicalContent(note);
      expect(result.containsMedical).toBe(false);
    }
  });

  it('allows legitimate administrative notes (English)', () => {
    const adminNotes = [
      'Patient arrived 10 minutes late',
      'Room changed from 3 to 5',
      'Companion: Mother',
      'Note: prefers morning appointments',
      'Transferred from Al-Malqa branch',
      'Cash payment',
      'Insurance: Bupa policy #123456',
    ];
    for (const note of adminNotes) {
      const result = checkMedicalContent(note);
      expect(result.containsMedical).toBe(false);
    }
  });

  // ❗ Arabic medical content detection
  it('❗ detects Arabic diagnostic content', () => {
    const diagnosticNotes = [
      'تشخيص: التهاب اللثة',
      'الأعراض: ألم شديد في الضرس',
      'حالة مرضية: سكري نوع 2',
    ];
    for (const note of diagnosticNotes) {
      const result = checkMedicalContent(note);
      expect(result.containsMedical).toBe(true);
      expect(result.matchedTerms.length).toBeGreaterThan(0);
    }
  });

  it('❗ detects Arabic treatment content', () => {
    const treatmentNotes = [
      'وصفة: أموكسيسيلين 500 ملغ',
      'علاج: حشوة مؤقتة',
      'دواء: مسكن بعد الجلسة',
      'حقنة تخدير موضعي',
    ];
    for (const note of treatmentNotes) {
      const result = checkMedicalContent(note);
      expect(result.containsMedical).toBe(true);
    }
  });

  // ❗ English medical content detection
  it('❗ detects English diagnostic content', () => {
    const diagnosticNotes = [
      'Diagnosis: gingivitis',
      'Symptoms: severe toothache',
      'Patient has infection in upper molar',
    ];
    for (const note of diagnosticNotes) {
      const result = checkMedicalContent(note);
      expect(result.containsMedical).toBe(true);
    }
  });

  it('❗ detects English treatment content', () => {
    const treatmentNotes = [
      'Prescription: Amoxicillin 500mg',
      'Treatment plan: root canal',
      'Medication: ibuprofen after session',
      'Surgery scheduled for next week',
    ];
    for (const note of treatmentNotes) {
      const result = checkMedicalContent(note);
      expect(result.containsMedical).toBe(true);
    }
  });

  it('is case-insensitive for English terms', () => {
    expect(checkMedicalContent('DIAGNOSIS: something').containsMedical).toBe(true);
    expect(checkMedicalContent('Treatment Plan').containsMedical).toBe(true);
  });

  it('returns all matched terms', () => {
    const result = checkMedicalContent('تشخيص: التهاب. علاج: مضاد حيوي');
    expect(result.containsMedical).toBe(true);
    expect(result.matchedTerms).toContain('تشخيص');
    expect(result.matchedTerms).toContain('التهاب');
    expect(result.matchedTerms).toContain('علاج');
    expect(result.matchedTerms).toContain('مضاد حيوي');
  });
});

// ---------------------------------------------------------------------------
// assertNoMedicalContent
// ---------------------------------------------------------------------------
describe('assertNoMedicalContent', () => {
  it('does not throw for clean administrative notes', () => {
    expect(() => assertNoMedicalContent('admin_notes', 'المريض وصل متأخرًا')).not.toThrow();
    expect(() => assertNoMedicalContent('admin_notes', null)).not.toThrow();
    expect(() => assertNoMedicalContent('admin_notes', undefined)).not.toThrow();
  });

  it('❗ throws MedicalContentError for medical content', () => {
    expect(() => assertNoMedicalContent('admin_notes', 'تشخيص: التهاب'))
      .toThrow(MedicalContentError);
  });

  it('❗ error message includes DEC-014 reference', () => {
    try {
      assertNoMedicalContent('admin_notes', 'diagnosis: cavity');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(MedicalContentError);
      expect((e as MedicalContentError).message).toContain('DEC-014');
      expect((e as MedicalContentError).fieldName).toBe('admin_notes');
      expect((e as MedicalContentError).matchedTerms).toContain('diagnosis');
    }
  });
});

// ---------------------------------------------------------------------------
// Term list completeness
// ---------------------------------------------------------------------------
describe('Medical term lists', () => {
  it('Arabic list has at least 25 terms', () => {
    expect(_MEDICAL_TERMS_AR.length).toBeGreaterThanOrEqual(25);
  });

  it('English list has at least 25 terms', () => {
    expect(_MEDICAL_TERMS_EN.length).toBeGreaterThanOrEqual(25);
  });

  it('no duplicates in Arabic list', () => {
    const set = new Set(_MEDICAL_TERMS_AR);
    expect(set.size).toBe(_MEDICAL_TERMS_AR.length);
  });

  it('no duplicates in English list', () => {
    const set = new Set(_MEDICAL_TERMS_EN);
    expect(set.size).toBe(_MEDICAL_TERMS_EN.length);
  });
});
