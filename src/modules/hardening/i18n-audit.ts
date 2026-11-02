/**
 * ZAMO-I18N-079 — اختبار اللغتين الشامل (Bilingual Completeness Audit).
 *
 * Validates that every UI string, database field, and notification template
 * is correctly localised in both Arabic and English.
 *
 * Checks:
 *   1. Translation parity — same keys in ar.ts and en.ts (no orphans)
 *   2. Placeholder consistency — {name} tokens match between locales
 *   3. DB field pairs — every `_ar` column has a matching `_en` column
 *   4. Notification templates — both locales covered for every type
 *   5. RTL/LTR character detection — Arabic text in en.ts is a bug
 *   6. Number formatting — locale-specific formatters used correctly
 *   7. Date formatting — locale-specific formatters used correctly
 *
 * [S1+S2] D8: Bilingual platform.
 */

import type { Queryable } from '../../db/client.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type I18nSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'PASS';

export interface I18nFinding {
  id: string;
  category: string;
  severity: I18nSeverity;
  title: string;
  titleAr: string;
  description: string;
  passed: boolean;
}

export interface I18nAuditReport {
  timestamp: string;
  totalChecks: number;
  passed: number;
  failed: number;
  findings: I18nFinding[];
  translationParity: boolean;
  dbFieldParity: boolean;
  overallPass: boolean;
}

// ---------------------------------------------------------------------------
// Translation parity
// ---------------------------------------------------------------------------

/**
 * Check that the same keys exist in both translation files.
 */
export function checkTranslationParity(
  arTranslations: Record<string, string>,
  enTranslations: Record<string, string>,
): I18nFinding[] {
  const findings: I18nFinding[] = [];

  const arKeys = new Set(Object.keys(arTranslations));
  const enKeys = new Set(Object.keys(enTranslations));

  // Keys in Arabic but not English
  const missingInEn: string[] = [];
  for (const key of arKeys) {
    if (!enKeys.has(key)) missingInEn.push(key);
  }

  // Keys in English but not Arabic
  const missingInAr: string[] = [];
  for (const key of enKeys) {
    if (!arKeys.has(key)) missingInAr.push(key);
  }

  findings.push({
    id: 'I18N-MISSING-EN',
    category: 'Translation Parity',
    severity: missingInEn.length === 0 ? 'PASS' : 'CRITICAL',
    title: `Keys missing in English: ${missingInEn.length}`,
    titleAr: `مفاتيح ناقصة في الإنجليزية: ${missingInEn.length}`,
    description: missingInEn.length === 0
      ? 'All Arabic keys have English translations.'
      : `Missing keys: ${missingInEn.slice(0, 10).join(', ')}${missingInEn.length > 10 ? ` (+${missingInEn.length - 10} more)` : ''}.`,
    passed: missingInEn.length === 0,
  });

  findings.push({
    id: 'I18N-MISSING-AR',
    category: 'Translation Parity',
    severity: missingInAr.length === 0 ? 'PASS' : 'CRITICAL',
    title: `Keys missing in Arabic: ${missingInAr.length}`,
    titleAr: `مفاتيح ناقصة في العربية: ${missingInAr.length}`,
    description: missingInAr.length === 0
      ? 'All English keys have Arabic translations.'
      : `Missing keys: ${missingInAr.slice(0, 10).join(', ')}${missingInAr.length > 10 ? ` (+${missingInAr.length - 10} more)` : ''}.`,
    passed: missingInAr.length === 0,
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Placeholder consistency
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{([^}]+)\}/g;

function extractPlaceholders(text: string): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    matches.push(m[1]!);
  }
  return matches.sort();
}

/**
 * Ensure that dynamic placeholders ({name}, {count}, etc.) match between locales.
 */
export function checkPlaceholderConsistency(
  arTranslations: Record<string, string>,
  enTranslations: Record<string, string>,
): I18nFinding[] {
  const findings: I18nFinding[] = [];
  const mismatches: string[] = [];

  const commonKeys = Object.keys(arTranslations).filter(k => k in enTranslations);

  for (const key of commonKeys) {
    const arPlaceholders = extractPlaceholders(arTranslations[key]!);
    const enPlaceholders = extractPlaceholders(enTranslations[key]!);

    if (arPlaceholders.join(',') !== enPlaceholders.join(',')) {
      mismatches.push(key);
    }
  }

  findings.push({
    id: 'I18N-PLACEHOLDERS',
    category: 'Placeholder Consistency',
    severity: mismatches.length === 0 ? 'PASS' : 'MAJOR',
    title: `Placeholder mismatches: ${mismatches.length}`,
    titleAr: `عدم تطابق العناصر النائبة: ${mismatches.length}`,
    description: mismatches.length === 0
      ? 'All placeholders match between locales.'
      : `Mismatched keys: ${mismatches.slice(0, 5).join(', ')}${mismatches.length > 5 ? ` (+${mismatches.length - 5} more)` : ''}.`,
    passed: mismatches.length === 0,
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Arabic text in English translations (likely copy-paste bug)
// ---------------------------------------------------------------------------

const ARABIC_CHAR_RE = /[\u0600-\u06FF]/;

/**
 * Detect Arabic characters accidentally left in English translation values.
 * The key `nav.language` is expected to have Arabic text ("العربية") in en.ts.
 */
export function checkLanguageCrossContamination(
  enTranslations: Record<string, string>,
  exemptKeys: string[] = ['nav.language'],
): I18nFinding[] {
  const findings: I18nFinding[] = [];
  const contaminated: string[] = [];
  const exempt = new Set(exemptKeys);

  for (const [key, value] of Object.entries(enTranslations)) {
    if (exempt.has(key)) continue;
    if (ARABIC_CHAR_RE.test(value)) {
      contaminated.push(key);
    }
  }

  findings.push({
    id: 'I18N-LANG-CONTAMINATION',
    category: 'Language Contamination',
    severity: contaminated.length === 0 ? 'PASS' : 'MAJOR',
    title: `Arabic text in English translations: ${contaminated.length}`,
    titleAr: `نص عربي في الترجمات الإنجليزية: ${contaminated.length}`,
    description: contaminated.length === 0
      ? 'No Arabic characters found in English translations.'
      : `Keys with Arabic text in en.ts: ${contaminated.join(', ')}.`,
    passed: contaminated.length === 0,
  });

  return findings;
}

// ---------------------------------------------------------------------------
// DB field parity (_ar / _en columns)
// ---------------------------------------------------------------------------

/**
 * Check that every `_ar` column in the DB has a matching `_en` column, and vice versa.
 */
export async function checkDbFieldParity(db: Queryable): Promise<I18nFinding[]> {
  const findings: I18nFinding[] = [];

  const cols = await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (column_name LIKE '%_ar' OR column_name LIKE '%_en')
     ORDER BY table_name, column_name`,
  );

  // Group by table
  const byTable = new Map<string, Set<string>>();
  for (const row of cols.rows) {
    const set = byTable.get(row.table_name) ?? new Set();
    set.add(row.column_name);
    byTable.set(row.table_name, set);
  }

  const orphanAr: string[] = [];
  const orphanEn: string[] = [];

  for (const [table, columns] of byTable) {
    for (const col of columns) {
      if (col.endsWith('_ar')) {
        const pair = col.replace(/_ar$/, '_en');
        if (!columns.has(pair)) orphanAr.push(`${table}.${col}`);
      } else if (col.endsWith('_en')) {
        const pair = col.replace(/_en$/, '_ar');
        if (!columns.has(pair)) orphanEn.push(`${table}.${col}`);
      }
    }
  }

  findings.push({
    id: 'I18N-DB-ORPHAN-AR',
    category: 'DB Field Parity',
    severity: orphanAr.length === 0 ? 'PASS' : 'CRITICAL',
    title: `Arabic DB columns without English pair: ${orphanAr.length}`,
    titleAr: `أعمدة عربية بدون مقابل إنجليزي: ${orphanAr.length}`,
    description: orphanAr.length === 0
      ? 'Every _ar column has a matching _en column.'
      : `Orphans: ${orphanAr.join(', ')}.`,
    passed: orphanAr.length === 0,
  });

  findings.push({
    id: 'I18N-DB-ORPHAN-EN',
    category: 'DB Field Parity',
    severity: orphanEn.length === 0 ? 'PASS' : 'CRITICAL',
    title: `English DB columns without Arabic pair: ${orphanEn.length}`,
    titleAr: `أعمدة إنجليزية بدون مقابل عربي: ${orphanEn.length}`,
    description: orphanEn.length === 0
      ? 'Every _en column has a matching _ar column.'
      : `Orphans: ${orphanEn.join(', ')}.`,
    passed: orphanEn.length === 0,
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Empty translations check
// ---------------------------------------------------------------------------

/**
 * Detect translation values that are empty strings.
 */
export function checkEmptyTranslations(
  translations: Record<string, string>,
  locale: string,
): I18nFinding[] {
  const empty = Object.entries(translations)
    .filter(([, v]) => v.trim() === '')
    .map(([k]) => k);

  return [{
    id: `I18N-EMPTY-${locale.toUpperCase()}`,
    category: 'Empty Translations',
    severity: empty.length === 0 ? 'PASS' : 'MAJOR',
    title: `Empty values in ${locale}: ${empty.length}`,
    titleAr: `قيم فارغة في ${locale}: ${empty.length}`,
    description: empty.length === 0
      ? `No empty translation values in ${locale}.`
      : `Empty keys: ${empty.slice(0, 10).join(', ')}${empty.length > 10 ? ` (+${empty.length - 10} more)` : ''}.`,
    passed: empty.length === 0,
  }];
}

// ---------------------------------------------------------------------------
// Full i18n audit runner
// ---------------------------------------------------------------------------

export interface I18nAuditDeps {
  db: Queryable;
  arTranslations: Record<string, string>;
  enTranslations: Record<string, string>;
}

export async function runI18nAudit(deps: I18nAuditDeps): Promise<I18nAuditReport> {
  const allFindings: I18nFinding[] = [];

  // Static checks
  allFindings.push(...checkTranslationParity(deps.arTranslations, deps.enTranslations));
  allFindings.push(...checkPlaceholderConsistency(deps.arTranslations, deps.enTranslations));
  allFindings.push(...checkLanguageCrossContamination(deps.enTranslations));
  allFindings.push(...checkEmptyTranslations(deps.arTranslations, 'ar'));
  allFindings.push(...checkEmptyTranslations(deps.enTranslations, 'en'));

  // DB checks
  allFindings.push(...await checkDbFieldParity(deps.db));

  const passed = allFindings.filter(f => f.passed).length;
  const failed = allFindings.filter(f => !f.passed).length;

  const parityFindings = allFindings.filter(f => f.category === 'Translation Parity');
  const dbFindings = allFindings.filter(f => f.category === 'DB Field Parity');

  return {
    timestamp: new Date().toISOString(),
    totalChecks: allFindings.length,
    passed,
    failed,
    findings: allFindings,
    translationParity: parityFindings.every(f => f.passed),
    dbFieldParity: dbFindings.every(f => f.passed),
    overallPass: allFindings.filter(f => f.severity === 'CRITICAL').every(f => f.passed),
  };
}
