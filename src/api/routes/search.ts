/**
 * Search routes — /api/search
 *
 * GET /api/search       — search services/facilities by keyword
 * GET /api/slots        — available slots for a branch+service+date
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';

// eslint-disable-next-line @typescript-eslint/require-await
export async function searchRoutes(app: FastifyInstance) {
  // @ts-expect-error — decorated
  const db = app.db as Db;

  // ─── Search services/facilities ───────────────────────────
  app.get('/search', async (req) => {
    const { q = '', locale = 'ar', city } = req.query as {
      q?: string;
      locale?: string;
      city?: string;
    };

    const nameCol = locale === 'en' ? 'service_name_en' : 'service_name_ar';
    const facilityNameCol = locale === 'en' ? 'name_en' : 'name_ar';

    let sql = `
      SELECT DISTINCT
        cs.id AS service_id,
        cs.${nameCol} AS service_name,
        cs.specialty_code,
        f.id AS facility_id,
        f.${facilityNameCol} AS facility_name,
        f.city,
        bs.price::text,
        b.id AS branch_id,
        b.${facilityNameCol} AS branch_name
      FROM branch_services bs
      JOIN catalog_services cs ON cs.id = bs.service_id
      JOIN branches b ON b.id = bs.branch_id
      JOIN facilities f ON f.id = bs.facility_id
      WHERE bs.is_active = true
        AND f.status = 'approved'
        AND cs.is_active = true
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (q.trim()) {
      sql += ` AND (cs.service_name_ar ILIKE $${paramIndex} OR cs.service_name_en ILIKE $${paramIndex} OR f.name_ar ILIKE $${paramIndex} OR f.name_en ILIKE $${paramIndex})`;
      params.push(`%${q}%`);
      paramIndex++;
    }

    if (city) {
      sql += ` AND f.city = $${paramIndex}`;
      params.push(city);
      paramIndex++;
    }

    sql += ` ORDER BY f.${facilityNameCol}, cs.${nameCol} LIMIT 50`;

    const result = await db.query<Record<string, unknown>>(sql, params);
    return { results: result.rows, count: result.rows.length };
  });

  // ─── Available slots ──────────────────────────────────────
  app.get('/slots', async (req, reply) => {
    const { branchId, serviceId, date } = req.query as {
      branchId?: string;
      serviceId?: string;
      date?: string;
    };

    if (!branchId || !date) {
      return reply.status(400).send({ error: 'VALIDATION', message: 'branchId and date are required' });
    }

    let sql = `
      SELECT ss.id, ss.slot_date, ss.start_time, ss.end_time,
             ss.schedule_id, s.practitioner_id,
             p.display_name_ar AS practitioner_name
      FROM schedule_slots ss
      JOIN schedules s ON s.id = ss.schedule_id
      JOIN practitioners p ON p.id = s.practitioner_id
      WHERE ss.branch_id = $1
        AND ss.slot_date = $2
        AND ss.is_available = true
    `;

    const params: unknown[] = [branchId, date];

    if (serviceId) {
      // Filter by practitioners who offer this service
      sql += `
        AND s.practitioner_id IN (
          SELECT bp.practitioner_id FROM branch_practitioners bp
          WHERE bp.branch_id = $1 AND bp.is_active = true
        )
      `;
    }

    sql += ' ORDER BY ss.start_time';

    const result = await db.query<Record<string, unknown>>(sql, params);
    return { slots: result.rows, count: result.rows.length };
  });
}
