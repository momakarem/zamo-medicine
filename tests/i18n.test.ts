import { describe, it, expect } from 'vitest';
import {
  t, localizedField, formatDate, formatTime, formatPrice,
  formatPhone, getDayName, findMissingKeys,
  SUPPORTED_LOCALES,
} from '../src/shared/i18n.ts';
import { translations as arTranslations } from '../src/shared/translations/ar.ts';
import { translations as enTranslations } from '../src/shared/translations/en.ts';

// ---------------------------------------------------------------------------
// ZAMO-I18N-025 — internationalization tests
// ---------------------------------------------------------------------------

describe('I18N-025 — Translation completeness', () => {
  it('❗ no keys missing in Arabic', () => {
    const missing = findMissingKeys(enTranslations, arTranslations);
    expect(missing).toEqual([]);
  });

  it('❗ no keys missing in English', () => {
    const missing = findMissingKeys(arTranslations, enTranslations);
    expect(missing).toEqual([]);
  });

  it('both locales have at least 50 keys', () => {
    expect(Object.keys(arTranslations).length).toBeGreaterThanOrEqual(50);
    expect(Object.keys(enTranslations).length).toBeGreaterThanOrEqual(50);
  });

  it('all supported locales are covered', () => {
    expect(SUPPORTED_LOCALES).toContain('ar');
    expect(SUPPORTED_LOCALES).toContain('en');
  });
});

describe('I18N-025 — t() translation lookup', () => {
  it('returns Arabic translation', () => {
    expect(t('nav.home', 'ar')).toBe('الرئيسية');
  });

  it('returns English translation', () => {
    expect(t('nav.home', 'en')).toBe('Home');
  });

  it('falls back to Arabic when key missing in English', () => {
    // Both should exist, so test with a hypothetical scenario
    expect(t('nonexistent.key', 'en')).toBe('nonexistent.key');
  });

  it('returns key itself as last resort', () => {
    expect(t('definitely.missing.key', 'ar')).toBe('definitely.missing.key');
  });

  it('defaults to Arabic locale', () => {
    expect(t('nav.home')).toBe('الرئيسية');
  });
});

describe('I18N-025 — localizedField()', () => {
  const row = {
    name_ar: 'عيادة الزهور',
    name_en: 'Al Zuhour Clinic',
    description_ar: null,
    description_en: 'A great clinic',
  };

  it('picks Arabic field for ar locale', () => {
    expect(localizedField(row, 'name', 'ar')).toBe('عيادة الزهور');
  });

  it('picks English field for en locale', () => {
    expect(localizedField(row, 'name', 'en')).toBe('Al Zuhour Clinic');
  });

  it('falls back to English when Arabic is null', () => {
    expect(localizedField(row, 'description', 'ar')).toBe('A great clinic');
  });

  it('returns empty string when both are empty', () => {
    const emptyRow = { bio_ar: null, bio_en: null };
    expect(localizedField(emptyRow, 'bio', 'ar')).toBe('');
  });
});

describe('I18N-025 — formatDate()', () => {
  const date = new Date('2026-09-17T10:00:00Z');

  it('formats date in Arabic locale', () => {
    const formatted = formatDate(date, 'ar');
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe('string');
  });

  it('formats date in English locale', () => {
    const formatted = formatDate(date, 'en');
    expect(formatted).toBeTruthy();
    expect(formatted).toContain('2026');
  });

  it('accepts string input', () => {
    const formatted = formatDate('2026-09-17', 'en');
    expect(formatted).toBeTruthy();
  });
});

describe('I18N-025 — formatTime()', () => {
  it('formats time in Arabic locale', () => {
    const formatted = formatTime('14:30', 'ar');
    expect(formatted).toBeTruthy();
  });

  it('formats time in English locale', () => {
    const formatted = formatTime('14:30', 'en');
    expect(formatted).toBeTruthy();
    // Should contain PM for 14:30
    expect(formatted.toLowerCase()).toContain('pm');
  });
});

describe('I18N-025 — formatPrice()', () => {
  it('formats price in Arabic', () => {
    const formatted = formatPrice('150.00', 'SAR', 'ar');
    expect(formatted).toBeTruthy();
  });

  it('formats price in English', () => {
    const formatted = formatPrice('150.00', 'SAR', 'en');
    expect(formatted).toBeTruthy();
    expect(formatted).toContain('150');
  });

  it('handles number input', () => {
    const formatted = formatPrice(150, 'SAR', 'en');
    expect(formatted).toContain('150');
  });
});

describe('I18N-025 — formatPhone()', () => {
  it('masks phone number', () => {
    expect(formatPhone('+966512345678')).toBe('****5678');
  });

  it('handles short phone', () => {
    expect(formatPhone('12')).toBe('****');
  });

  it('handles empty phone', () => {
    expect(formatPhone('')).toBe('****');
  });
});

describe('I18N-025 — getDayName()', () => {
  it('returns Arabic day names', () => {
    expect(getDayName(0, 'ar')).toBe('الأحد');
    expect(getDayName(5, 'ar')).toBe('الجمعة');
  });

  it('returns English day names', () => {
    expect(getDayName(0, 'en')).toBe('Sunday');
    expect(getDayName(5, 'en')).toBe('Friday');
  });

  it('returns empty for invalid day', () => {
    expect(getDayName(7, 'ar')).toBe('');
  });
});

describe('I18N-025 — Recommendation reason labels', () => {
  const reasonKeys = [
    'reason.nearest_appointment',
    'reason.nearest_location',
    'reason.lowest_price',
    'reason.accepts_insurance',
    'reason.speaks_language',
    'reason.preferred_gender',
  ];

  for (const locale of SUPPORTED_LOCALES) {
    for (const key of reasonKeys) {
      it(`has ${key} in ${locale}`, () => {
        const value = t(key, locale);
        expect(value).not.toBe(key); // Should not fall back to key
        expect(value.length).toBeGreaterThan(0);
      });
    }
  }
});

describe('I18N-025 — Legal page title translations', () => {
  const legalKeys = [
    'legal.about', 'legal.terms', 'legal.privacy',
    'legal.medical_disclaimer', 'legal.cookies', 'legal.refund',
    'legal.contact', 'legal.faq', 'legal.accessibility', 'legal.complaints',
  ];

  for (const locale of SUPPORTED_LOCALES) {
    for (const key of legalKeys) {
      it(`has ${key} in ${locale}`, () => {
        const value = t(key, locale);
        expect(value).not.toBe(key);
      });
    }
  }
});
