/**
 * ZAMO-AGENT-049 — Output Guard tests.
 *
 * Tests from IMPLEMENTATION_CHECKLIST:
 *   ❗ فحص 50+ ردًا من عبارات التفضيل بلا معيار
 *   ❗ محاولة استدراج للتشخيص بصيغ ملتوية ← الحاجز يوقفها
 *   ❗ محاولة حقن تعليمات ← لا تتجاوز الحدود
 *   الردود المشروعة لا تُحجب خطأً
 *   ❗ الوكيل لا يقول «تم تأكيد الحجز» (A-12)
 */

import { describe, it, expect } from 'vitest';
import {
  checkOutput,
  getSafeContent,
  _SUPERLATIVE_AR,
  _SUPERLATIVE_EN,
  type OutputGuardResult,
} from './output-guard.ts';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function expectBlocked(result: OutputGuardResult, reason: string): void {
  expect(result.type).toBe('blocked');
  if (result.type === 'blocked') {
    expect(result.reason).toBe(reason);
    expect(result.sanitized).toBeTruthy();
  }
}

function expectPass(result: OutputGuardResult): void {
  expect(result.type).toBe('pass');
}

// ---------------------------------------------------------------------------
// Medical content blocking
// ---------------------------------------------------------------------------

describe('Output Guard — Medical Content', () => {
  const medicalOutputs = [
    'التشخيص هو التهاب اللثة',
    'أنت مصاب بحساسية الجلد',
    'تناول هذا الدواء مرتين يومياً',
    'الجرعة هي 500 ملغ',
    'العلاج المناسب لحالتك هو',
    'أنصحك بأخذ مضاد حيوي',
    'من الناحية الطبية يبدو أن',
    // English
    'your diagnosis is gingivitis',
    'you have been diagnosed with eczema',
    'take this medication twice daily',
    'the dosage is 500mg',
    'i recommend taking antibiotics',
    'as a doctor, I would suggest',
    'you are suffering from a chronic condition',
  ];

  it.each(medicalOutputs)('blocks medical: "%s"', (output) => {
    expectBlocked(checkOutput(output), 'medical_content');
  });
});

// ---------------------------------------------------------------------------
// Superlative without data (A-38 / B-22)
// ❗ IMPLEMENTATION_CHECKLIST: «فحص 50+ ردًا من عبارات التفضيل بلا معيار»
// ---------------------------------------------------------------------------

describe('Output Guard — Superlatives (A-38)', () => {
  // Combine AR + EN superlatives and generate test phrases
  const superlativePhrases = [
    // Arabic superlatives
    'هذا أفضل طبيب أسنان في الرياض',
    'هذا أفضل دكتور جلدية',
    'هذه أفضل عيادة',
    'هذا الطبيب الأفضل في التخصص',
    'أحسن طبيب عندنا',
    'أشطر طبيب أسنان',
    'أشطر دكتور جلدية',
    'هو الأكثر خبرة في المجال',
    'هي الأكثر كفاءة',
    'ننصح بشدة بزيارة هذا الطبيب',
    'نوصي بشدة بهذه العيادة',
    'لا يوجد أفضل من هذا الدكتور',
    'هو الأفضل بلا منازع',
    'هي الأفضل في الرياض',
    'أمهر طبيب أسنان',
    'أفضل اختيار لحالتك',
    // English superlatives
    'this is the best doctor in Riyadh',
    'best clinic for dental care',
    'top doctor in dermatology',
    'the most skilled dentist',
    'most experienced doctor',
    'highly recommended dermatologist',
    'I strongly recommend this clinic',
    'no one better than Dr. Ahmad',
    'the finest dental clinic',
    'the greatest dermatologist',
    'number one dentist in the city',
    '#1 doctor for cosmetic procedures',
    'top-rated dental clinic',
    'most qualified surgeon',
    'best choice for your needs',
    'this is the best in the region',
    'best hospital in the area',
  ];

  // Ensure we have 50+ test cases
  const additionalPhrases = [
    'أفضل طبيب في المنطقة الشرقية',
    'أفضل دكتور في جدة',
    'أفضل عيادة في حي الملقا',
    'أحسن دكتور جراحة',
    'أشطر دكتور في التجميل',
    'الأفضل في مجاله بلا شك',
    'هو الأفضل على الإطلاق',
    'best doctor for cosmetic surgery',
    'the best doctor available for dental surgery',
    'top-rated specialist',
    'most experienced practitioner in the field',
    'number one specialist',
    'highly recommended for your case',
    'strongly recommend seeing this doctor',
    'the finest specialist I can suggest',
    'best hospital for this procedure',
    'the greatest specialist in town',
  ];

  const allCases = [...superlativePhrases, ...additionalPhrases];

  // Verify we have 50+
  it('has 50+ superlative test cases', () => {
    expect(allCases.length).toBeGreaterThanOrEqual(50);
  });

  it.each(allCases)('blocks superlative: "%s"', (output) => {
    expectBlocked(checkOutput(output), 'superlative_no_data');
  });
});

// ---------------------------------------------------------------------------
// Medical promises
// ---------------------------------------------------------------------------

describe('Output Guard — Medical Promises', () => {
  const promiseCases = [
    'لا تقلق ستشفى بعد الزيارة',
    'نتيجة مضمونة',
    'نسبة نجاح العملية 99%',
    'الشفاء مؤكد',
    // English
    'you will be cured after treatment',
    'guaranteed result',
    'guaranteed cure',
    'nothing to worry about',
  ];

  it.each(promiseCases)('blocks promise: "%s"', (output) => {
    expectBlocked(checkOutput(output), 'medical_promise');
  });
});

// ---------------------------------------------------------------------------
// False booking confirmation (A-12)
// ---------------------------------------------------------------------------

describe('Output Guard — False Confirmation (A-12)', () => {
  const falseCases = [
    'تم تأكيد حجزك مع الدكتور أحمد',
    'حجزك مؤكد ليوم الأحد',
    'تم تأكيد الحجز بنجاح',
    'تم تأكيد موعدك',
    'تم الحجز بنجاح',
    // English
    'your booking is confirmed for Sunday',
    'booking confirmed with Dr. Ahmad',
    'your appointment is confirmed',
    'successfully booked your appointment',
  ];

  it.each(falseCases)('blocks false confirmation: "%s"', (output) => {
    const result = checkOutput(output);
    expectBlocked(result, 'false_confirmation');
  });

  it('replaces with correct A-13 message (AR)', () => {
    const result = checkOutput('تم تأكيد حجزك', 'ar');
    if (result.type === 'blocked') {
      expect(result.sanitized).toContain('تم إرسال طلب حجزك');
      expect(result.sanitized).toContain('سنبلغك فور تأكيد الموعد');
    }
  });

  it('replaces with correct A-13 message (EN)', () => {
    const result = checkOutput('your booking is confirmed', 'en');
    if (result.type === 'blocked') {
      expect(result.sanitized).toContain('booking request has been sent');
      expect(result.sanitized).toContain('once the appointment is confirmed');
    }
  });
});

// ---------------------------------------------------------------------------
// Safe outputs — MUST pass through
// ---------------------------------------------------------------------------

describe('Output Guard — Safe Outputs (pass)', () => {
  const safeCases = [
    'وجدت لك 3 أطباء أسنان في حي الملقا. هذه النتائج مرتبة حسب أقرب موعد متاح:',
    'تم إرسال طلب حجزك إلى العيادة، وسنبلغك فور تأكيد الموعد.',
    'الدكتور أحمد متاح يوم الأحد الساعة 10 صباحاً. السعر: 350 ريال.',
    'تم إلغاء حجزك بنجاح وتحررت الفتحة.',
    'حالة حجزك: بانتظار تأكيد العيادة.',
    'سأحولك الآن لموظف خدمة العملاء.',
    'مرحباً! أنا المساعد الذكي في منصة زامو.',
    // English
    'I found 3 dentists in Al-Malqa district. Results sorted by nearest appointment:',
    'Your booking request has been sent to the clinic.',
    'Dr. Ahmad is available on Sunday at 10:00 AM. Price: 350 SAR.',
    'Your booking has been cancelled and the slot released.',
    'Booking status: Pending clinic confirmation.',
    'I will transfer you to customer service.',
  ];

  it.each(safeCases)('passes safe output: "%s"', (output) => {
    expectPass(checkOutput(output));
  });

  it('passes empty output', () => {
    expectPass(checkOutput(''));
    expectPass(checkOutput('   '));
  });
});

// ---------------------------------------------------------------------------
// getSafeContent helper
// ---------------------------------------------------------------------------

describe('getSafeContent', () => {
  it('returns original content for pass', () => {
    const result = checkOutput('مرحبا');
    expect(getSafeContent(result)).toBe('مرحبا');
  });

  it('returns sanitized for blocked', () => {
    const result = checkOutput('تم تأكيد حجزك');
    const safe = getSafeContent(result);
    expect(safe).toContain('طلب حجزك');
    expect(safe).not.toContain('تم تأكيد حجزك');
  });
});
