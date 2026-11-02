/**
 * Catalog routes — public endpoints for browsing services/facilities.
 *
 * GET /api/facilities                — list active facilities
 * GET /api/facilities/:id            — facility detail + branches
 * GET /api/facilities/:id/services   — services at a facility
 * GET /api/practitioners/:id         — doctor profile
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';

/** Validate locale parameter and return safe column names. */
function localeColumns(locale: string | undefined) {
  // Only allow 'ar' or 'en' — prevents any SQL injection via column names
  const isEn = locale === 'en';
  return {
    name: isEn ? 'name_en' : 'name_ar',
    desc: isEn ? 'description_en' : 'description_ar',
    serviceName: isEn ? 'service_name_en' : 'service_name_ar',
    displayName: isEn ? 'display_name_en' : 'display_name_ar',
    bio: isEn ? 'bio_en' : 'bio_ar',
  };
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function catalogRoutes(app: FastifyInstance) {
  // @ts-expect-error — decorated
  const db = app.db as Db;

  // ─── List facilities ──────────────────────────────────────
  app.get('/facilities', async (req) => {
    const { locale } = req.query as { locale?: string };
    const cols = localeColumns(locale);

    const result = await db.query<{
      id: string;
      name: string;
      description: string | null;
      city: string | null;
      logo_url: string | null;
    }>(
      `SELECT id, ${cols.name} AS name, ${cols.desc} AS description, city, logo_url
       FROM facilities
       WHERE status = 'approved'
       ORDER BY ${cols.name}`,
    );

    return { facilities: result.rows };
  });

  // ─── Facility detail ──────────────────────────────────────
  app.get('/facilities/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { locale } = req.query as { locale?: string };
    const cols = localeColumns(locale);

    const facility = await db.query<Record<string, unknown>>(
      `SELECT f.id, f.${cols.name} AS name, f.city, f.logo_url, f.status,
              f.contract_start, f.contract_end
       FROM facilities f WHERE f.id = $1`,
      [id],
    );

    if (facility.rows.length === 0) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }

    const branches = await db.query<{ id: string; name: string; district: string | null }>(
      `SELECT id, ${cols.name} AS name, district FROM branches WHERE facility_id = $1 AND is_active = true`,
      [id],
    );

    return {
      facility: facility.rows[0],
      branches: branches.rows,
    };
  });

  // ─── Facility services ────────────────────────────────────
  app.get('/facilities/:id/services', async (req) => {
    const { id } = req.params as { id: string };
    const { locale } = req.query as { locale?: string };
    const cols = localeColumns(locale);

    const services = await db.query<{
      id: string;
      name: string;
      price: string;
      branch_id: string;
    }>(
      `SELECT bs.id, cs.${cols.serviceName} AS name, bs.price::text, bs.branch_id
       FROM branch_services bs
       JOIN catalog_services cs ON cs.id = bs.service_id
       WHERE bs.facility_id = $1 AND bs.is_active = true
       ORDER BY cs.${cols.serviceName}`,
      [id],
    );

    return { services: services.rows };
  });

  // ─── Practitioner profile ─────────────────────────────────
  app.get('/practitioners/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { locale } = req.query as { locale?: string };
    const cols = localeColumns(locale);

    const practitioner = await db.query<Record<string, unknown>>(
      `SELECT p.id, p.${cols.displayName} AS name, p.${cols.bio} AS bio,
              p.specialty_code, p.photo_url, p.gender, p.years_experience
       FROM practitioners p WHERE p.id = $1`,
      [id],
    );

    if (practitioner.rows.length === 0) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }

    // Get branches this practitioner works at
    const branches = await db.query<{ branch_id: string; branch_name: string; facility_id: string }>(
      `SELECT bp.branch_id, b.name_ar AS branch_name, b.facility_id
       FROM branch_practitioners bp
       JOIN branches b ON b.id = bp.branch_id
       WHERE bp.practitioner_id = $1 AND bp.is_active = true`,
      [id],
    );

    return {
      practitioner: practitioner.rows[0],
      branches: branches.rows,
    };
  });
}
