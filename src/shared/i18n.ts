/**
 * ZAMO-I18N-025 — internationalization system.
 *
 * Supports Arabic (ar) and English (en).
 * - `t(key, locale)` — translate static UI strings
 * - `localizedField(row, field, locale)` — pick `_ar` or `_en` from DB rows
 * - `formatDate` / `formatPrice` / `formatPhone` — locale-aware formatting
 *
 * [S1+S2]: Bilingual platform (D8).
 */

import { translations as arTranslations } from './translations/ar.ts';
import { translations as enTranslations } from './translations/en.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Locale = 'ar' | 'en';

export const DEFAULT_LOCALE: Locale = 'ar';

export const SUPPORTED_LOCALES: readonly Locale[] = ['ar', 'en'] as const;

export type TranslationKeys = keyof typeof arTranslations;

// ---------------------------------------------------------------------------
// Translation lookup
// ---------------------------------------------------------------------------

const translationMap: Record<Locale, Record<string, string>> = {
  ar: arTranslations,
  en: enTranslations,
};

/**
 * Translate a static UI string by key and locale.
 * Falls back to Arabic if key missing in target locale,
 * then to the raw key itself as last resort.
 */
export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  return translationMap[locale]?.[key]
    ?? translationMap['ar']?.[key]
    ?? key;
}

// ---------------------------------------------------------------------------
// Localized DB field helper
// ---------------------------------------------------------------------------

/**
 * Pick the `_ar` or `_en` suffixed field from a DB row.
 *
 * Example: `localizedField(row, 'name', 'ar')` → `row.name_ar`
 *
 * Falls back to the other locale if the target is null/empty.
 */
export function localizedField<T extends Record<string, unknown>>(
  row: T,
  field: string,
  locale: Locale,
): string {
  const primary = row[`${field}_${locale}`];
  if (primary && typeof primary === 'string' && primary.trim() !== '') {
    return primary;
  }
  // Fallback to the other locale
  const fallbackLocale: Locale = locale === 'ar' ? 'en' : 'ar';
  const fallback = row[`${field}_${fallbackLocale}`];
  if (fallback && typeof fallback === 'string') {
    return fallback;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/**
 * Format a date in the user's locale.
 * Arabic: ١٤٤٨/٠٣/١٥ (Hijri would need a library — using Gregorian for now)
 * English: Sep 17, 2026
 */
export function formatDate(
  date: Date | string,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const localeCode = locale === 'ar' ? 'ar-SA' : 'en-US';
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  };
  return new Intl.DateTimeFormat(localeCode, defaultOptions).format(d);
}

/**
 * Format a time string (HH:MM) in the user's locale.
 */
export function formatTime(time: string, locale: Locale): string {
  const [hours, minutes] = time.split(':').map(Number);
  const d = new Date(2000, 0, 1, hours, minutes);
  const localeCode = locale === 'ar' ? 'ar-SA' : 'en-US';
  return new Intl.DateTimeFormat(localeCode, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

// ---------------------------------------------------------------------------
// Price formatting
// ---------------------------------------------------------------------------

/**
 * Format a monetary amount with currency.
 * Arabic: ١٥٠٫٠٠ ر.س
 * English: SAR 150.00
 */
export function formatPrice(
  amount: string | number,
  currency: string = 'SAR',
  locale: Locale = DEFAULT_LOCALE,
): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const localeCode = locale === 'ar' ? 'ar-SA' : 'en-US';
  return new Intl.NumberFormat(localeCode, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numAmount);
}

// ---------------------------------------------------------------------------
// Phone masking (A-34: partial phone display)
// ---------------------------------------------------------------------------

/**
 * Mask a phone number, showing only last 4 digits.
 * Example: +966512345678 → ****5678
 */
export function formatPhone(phone: string): string {
  if (!phone || phone.length < 4) return '****';
  return '****' + phone.slice(-4);
}

// ---------------------------------------------------------------------------
// Day-of-week names
// ---------------------------------------------------------------------------

const DAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Get day name by index (0 = Sunday).
 */
export function getDayName(dayOfWeek: number, locale: Locale): string {
  const names = locale === 'ar' ? DAY_NAMES_AR : DAY_NAMES_EN;
  return names[dayOfWeek] ?? '';
}

// ---------------------------------------------------------------------------
// Completeness check (for testing)
// ---------------------------------------------------------------------------

/**
 * Returns keys present in `reference` but missing in `target`.
 * Used by tests to ensure no translation is missing.
 */
export function findMissingKeys(
  reference: Record<string, string>,
  target: Record<string, string>,
): string[] {
  return Object.keys(reference).filter((key) => !(key in target));
}
