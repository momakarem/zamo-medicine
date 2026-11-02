/**
 * Booking routes — /api/bookings/*
 *
 * POST   /api/bookings              — create booking (patient)
 * GET    /api/bookings              — list my bookings (patient) or branch bookings (staff)
 * GET    /api/bookings/:id          — booking detail
 * PATCH  /api/bookings/:id/status   — transition booking status (staff)
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';
import type { AppConfig } from '../../config/env.ts';
import { requireAuth, getSession } from '../middleware/auth.ts';

// eslint-disable-next-line @typescript-eslint/require-await
export async function bookingRoutes(app: FastifyInstance) {
  // @ts-expect-error — decorated
  const db = app.db as Db;
  // @ts-expect-error — decorated
  const config = app.config as AppConfig;

  const sessionConfig = {
    ttlPatientMin: config.SESSION_TTL_PATIENT_MIN,
    ttlStaffMin: config.SESSION_TTL_STAFF_MIN,
    ttlAdminMin: config.SESSION_TTL_ADMIN_MIN,
  };

  const auth = requireAuth(sessionConfig);

  // ─── Create booking ───────────────────────────────────────
  app.post('/bookings', { preHandler: auth }, async (req, reply) => {
    const session = getSession(req);
    const body = req.body as {
      slotId: string;
      branchServiceId: string;
      notes?: string;
    };

    if (!body.slotId || !body.branchServiceId) {
      return reply.status(400).send({ error: 'VALIDATION', message: 'slotId and branchServiceId are required' });
    }

    try {
      const result = await db.query<{ id: string; status: string }>(
        `INSERT INTO bookings (patient_id, slot_id, branch_service_id, notes, status,
                               branch_id, facility_id, practitioner_id)
         SELECT $1, ss.id, $2, $3, 'PENDING_CONFIRMATION',
                ss.branch_id, b.facility_id, s.practitioner_id
         FROM schedule_slots ss
         JOIN schedules s ON s.id = ss.schedule_id
         JOIN branches b ON b.id = ss.branch_id
         WHERE ss.id = $4 AND ss.is_available = true
         RETURNING id, status`,
        [session.userId, body.branchServiceId, body.notes ?? null, body.slotId],
      );

      if (result.rows.length === 0) {
        return reply.status(409).send({ error: 'SLOT_UNAVAILABLE', message: 'The slot is no longer available' });
      }

      // Mark slot as taken
      await db.query(`UPDATE schedule_slots SET is_available = false WHERE id = $1`, [body.slotId]);

      return reply.status(201).send({ booking: result.rows[0] });
    } catch {
      return reply.status(500).send({ error: 'BOOKING_FAILED', message: 'Could not create booking' });
    }
  });

  // ─── List bookings ────────────────────────────────────────
  app.get('/bookings', { preHandler: auth }, async (req) => {
    const session = getSession(req);
    const { status, page = '1', limit = '20' } = req.query as Record<string, string>;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let sql: string;
    let params: unknown[];

    if (session.roleCode === 'patient') {
      sql = `SELECT b.id, b.status, b.created_at, b.slot_id,
                    bs.price::text, cs.service_name_ar
             FROM bookings b
             JOIN branch_services bs ON bs.id = b.branch_service_id
             JOIN catalog_services cs ON cs.id = bs.service_id
             WHERE b.patient_id = $1
             ${status ? 'AND b.status = $4' : ''}
             ORDER BY b.created_at DESC
             LIMIT $2 OFFSET $3`;
      params = status
        ? [session.userId, parseInt(limit, 10), offset, status]
        : [session.userId, parseInt(limit, 10), offset];
    } else {
      // Staff sees branch bookings
      sql = `SELECT b.id, b.status, b.created_at, b.patient_id,
                    u.full_name_ar AS patient_name, cs.service_name_ar
             FROM bookings b
             JOIN users u ON u.id = b.patient_id
             JOIN branch_services bs ON bs.id = b.branch_service_id
             JOIN catalog_services cs ON cs.id = bs.service_id
             WHERE b.branch_id = $1
             ${status ? 'AND b.status = $4' : ''}
             ORDER BY b.created_at DESC
             LIMIT $2 OFFSET $3`;
      params = status
        ? [session.branchId, parseInt(limit, 10), offset, status]
        : [session.branchId, parseInt(limit, 10), offset];
    }

    const result = await db.query<Record<string, unknown>>(sql, params);
    return { bookings: result.rows };
  });

  // ─── Booking detail ───────────────────────────────────────
  app.get('/bookings/:id', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const result = await db.query<Record<string, unknown>>(
      `SELECT b.*, cs.service_name_ar, cs.service_name_en,
              u.full_name_ar AS patient_name, u.phone AS patient_phone,
              p.display_name_ar AS practitioner_name
       FROM bookings b
       JOIN branch_services bs ON bs.id = b.branch_service_id
       JOIN catalog_services cs ON cs.id = bs.service_id
       JOIN users u ON u.id = b.patient_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       WHERE b.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'NOT_FOUND' });
    }

    // Get events
    const events = await db.query<Record<string, unknown>>(
      `SELECT * FROM booking_events WHERE booking_id = $1 ORDER BY created_at`,
      [id],
    );

    return { booking: result.rows[0], events: events.rows };
  });

  // ─── Update booking status ────────────────────────────────
  app.patch('/bookings/:id/status', { preHandler: auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = getSession(req);
    const { status: newStatus, reason } = req.body as { status: string; reason?: string };

    if (!newStatus) {
      return reply.status(400).send({ error: 'VALIDATION', message: 'status is required' });
    }

    try {
      // Get current status
      const current = await db.query<{ status: string }>(
        `SELECT status FROM bookings WHERE id = $1`,
        [id],
      );

      if (current.rows.length === 0) {
        return reply.status(404).send({ error: 'NOT_FOUND' });
      }

      const oldStatus = current.rows[0]!.status;

      // Update status
      await db.query(
        `UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2`,
        [newStatus, id],
      );

      // Record event
      await db.query(
        `INSERT INTO booking_events (booking_id, old_status, new_status, changed_by, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, oldStatus, newStatus, session.userId, reason ?? null],
      );

      return { booking: { id, status: newStatus, previousStatus: oldStatus } };
    } catch {
      return reply.status(500).send({ error: 'UPDATE_FAILED' });
    }
  });
}
