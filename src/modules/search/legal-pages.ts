import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { localizedField, type Locale } from '../../shared/i18n.ts';

/**
 * ZAMO-SRCH-026 — legal & regulatory pages.
 *
 * 10 pages per [S1]:
 *   about · terms · privacy · medical-disclaimer · cookies
 *   refund · contact · faq · accessibility · complaints
 *
 * B-38: All texts are PLACEHOLDER until the project owner / legal specialist
 *       writes the final versions. Each placeholder is marked with "⚠️ PLACEHOLDER".
 *
 * ❗ medical-disclaimer is critical — must be linked from the agent journey.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LegalPageSlug =
  | 'about'
  | 'terms'
  | 'privacy'
  | 'medical-disclaimer'
  | 'cookies'
  | 'refund'
  | 'contact'
  | 'faq'
  | 'accessibility'
  | 'complaints';

export const LEGAL_PAGE_SLUGS: readonly LegalPageSlug[] = [
  'about', 'terms', 'privacy', 'medical-disclaimer', 'cookies',
  'refund', 'contact', 'faq', 'accessibility', 'complaints',
] as const;

export type LegalPageError = 'PAGE_NOT_FOUND';

export interface LegalPage {
  slug: string;
  title: string;
  content: string;
  isPlaceholder: boolean;
  updatedAt: string;
}

export interface LegalPageSummary {
  slug: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface LegalPagesService {
  getPage(slug: LegalPageSlug, locale: Locale): Promise<Result<LegalPage, LegalPageError>>;
  listPages(locale: Locale): Promise<LegalPageSummary[]>;
}

export function createLegalPagesService(db: Queryable): LegalPagesService {
  return {
    async getPage(slug, locale) {
      const res = await db.query<{
        slug: string;
        title_ar: string; title_en: string;
        content_ar: string; content_en: string;
        updated_at: string;
      }>(
        `SELECT slug, title_ar, title_en, content_ar, content_en, updated_at::text
         FROM legal_pages
         WHERE slug = $1 AND is_active = true`,
        [slug],
      );
      if (res.rows.length === 0) return err('PAGE_NOT_FOUND');

      const row = res.rows[0]!;
      const content = localizedField(row, 'content', locale);

      return ok({
        slug: row.slug,
        title: localizedField(row, 'title', locale),
        content,
        isPlaceholder: content.includes('⚠️ PLACEHOLDER'),
        updatedAt: row.updated_at,
      });
    },

    async listPages(locale) {
      const res = await db.query<{
        slug: string;
        title_ar: string; title_en: string;
      }>(
        `SELECT slug, title_ar, title_en
         FROM legal_pages
         WHERE is_active = true
         ORDER BY sort_order`,
      );
      return res.rows.map((r) => ({
        slug: r.slug,
        title: localizedField(r, 'title', locale),
      }));
    },
  };
}
