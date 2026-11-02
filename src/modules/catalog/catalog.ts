import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';

/**
 * ZAMO-CAT-014 — specialties & services catalog.
 *
 * Platform-level entities, not facility-scoped.
 * [S2]: "أسنان · جلدية · تجميل" — the three launch specialties.
 * [S1]: bilingual names (name_ar / name_en) per D8.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CatalogError =
  | 'SPECIALTY_NOT_FOUND'
  | 'SERVICE_NOT_FOUND'
  | 'DUPLICATE_SLUG';

export interface SpecialtyRow {
  id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  icon: string | null;
  description_ar: string | null;
  description_en: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface ServiceInput {
  specialtyId: string;
  nameAr: string;
  nameEn: string;
  slug: string;
  descriptionAr?: string;
  descriptionEn?: string;
  defaultDurationMinutes?: number;
  sortOrder?: number;
}

export interface ServiceRow {
  id: string;
  specialty_id: string;
  name_ar: string;
  name_en: string;
  slug: string;
  description_ar: string | null;
  description_en: string | null;
  default_duration_minutes: number;
  sort_order: number;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface CatalogService {
  listSpecialties(): Promise<SpecialtyRow[]>;
  getSpecialty(slug: string): Promise<Result<SpecialtyRow, CatalogError>>;
  getSpecialtyById(id: string): Promise<Result<SpecialtyRow, CatalogError>>;
  createService(input: ServiceInput): Promise<Result<string, CatalogError>>;
  updateService(serviceId: string, input: Partial<ServiceInput>): Promise<Result<void, CatalogError>>;
  listServices(specialtyId?: string): Promise<ServiceRow[]>;
  getService(serviceId: string): Promise<Result<ServiceRow, CatalogError>>;
}

export function createCatalogService(db: Queryable): CatalogService {
  return {
    async listSpecialties() {
      const res = await db.query<SpecialtyRow>(
        `SELECT * FROM specialties WHERE is_active = true ORDER BY sort_order, name_en`,
      );
      return res.rows;
    },

    async getSpecialty(slug) {
      const res = await db.query<SpecialtyRow>(
        `SELECT * FROM specialties WHERE slug = $1`,
        [slug],
      );
      if (res.rows.length === 0) return err('SPECIALTY_NOT_FOUND');
      return ok(res.rows[0]!);
    },

    async getSpecialtyById(id) {
      const res = await db.query<SpecialtyRow>(
        `SELECT * FROM specialties WHERE id = $1`,
        [id],
      );
      if (res.rows.length === 0) return err('SPECIALTY_NOT_FOUND');
      return ok(res.rows[0]!);
    },

    async createService(input) {
      // Verify specialty exists
      const spec = await this.getSpecialtyById(input.specialtyId);
      if (!spec.ok) return err('SPECIALTY_NOT_FOUND');

      try {
        const res = await db.query<{ id: string }>(
          `INSERT INTO services
             (specialty_id, name_ar, name_en, slug, description_ar, description_en,
              default_duration_minutes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id`,
          [
            input.specialtyId, input.nameAr, input.nameEn, input.slug,
            input.descriptionAr ?? null, input.descriptionEn ?? null,
            input.defaultDurationMinutes ?? 30, input.sortOrder ?? 0,
          ],
        );
        return ok(res.rows[0]!.id);
      } catch (e: unknown) {
        const msg = (e as Error).message ?? '';
        if (msg.includes('services_slug_key') || msg.includes('unique')) {
          return err('DUPLICATE_SLUG');
        }
        throw e;
      }
    },

    async updateService(serviceId, input) {
      const existing = await this.getService(serviceId);
      if (!existing.ok) return err(existing.error);

      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      const addField = (col: string, val: unknown): void => {
        if (val !== undefined) {
          sets.push(`${col} = $${idx++}`);
          params.push(val);
        }
      };

      addField('name_ar', input.nameAr);
      addField('name_en', input.nameEn);
      addField('slug', input.slug);
      addField('description_ar', input.descriptionAr);
      addField('description_en', input.descriptionEn);
      addField('default_duration_minutes', input.defaultDurationMinutes);
      addField('sort_order', input.sortOrder);

      if (sets.length === 0) return ok(undefined);

      params.push(serviceId);
      await db.query(
        `UPDATE services SET ${sets.join(', ')} WHERE id = $${idx}`,
        params,
      );

      return ok(undefined);
    },

    async listServices(specialtyId?) {
      if (specialtyId) {
        const res = await db.query<ServiceRow>(
          `SELECT * FROM services WHERE specialty_id = $1 AND is_active = true ORDER BY sort_order, name_en`,
          [specialtyId],
        );
        return res.rows;
      }
      const res = await db.query<ServiceRow>(
        `SELECT * FROM services WHERE is_active = true ORDER BY sort_order, name_en`,
      );
      return res.rows;
    },

    async getService(serviceId) {
      const res = await db.query<ServiceRow>(
        `SELECT * FROM services WHERE id = $1`,
        [serviceId],
      );
      if (res.rows.length === 0) return err('SERVICE_NOT_FOUND');
      return ok(res.rows[0]!);
    },
  };
}
