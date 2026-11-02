/**
 * ZAMO-DISP-069 — Patient Objection Service.
 *
 * Allows patients to object to visit data after service is recorded.
 * 4 types from [S1] §14.3:
 *   1. did_not_attend     — "لم أحضر"
 *   2. did_not_receive_service — "لم أحصل على الخدمة"
 *   3. different_service  — "الخدمة مختلفة"
 *   4. incorrect_value    — "القيمة غير صحيحة"
 *
 * Objections are escalated to Zamo management for review.
 * Accepted objections reverse commission impact.
 *
 * [S1] §14.3: "المريض طرف تحقّق مستقل في سلسلة إثبات العمولة"
 */

import type { Queryable } from '../../db/client.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';
import { record, AUDIT_ACTIONS } from '../audit/audit.js';
import { reverseCommission } from './commission-compute.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObjectionType =
  | 'did_not_attend'
  | 'did_not_receive_service'
  | 'different_service'
  | 'incorrect_value';

export type ObjectionStatus = 'PENDING' | 'UNDER_REVIEW' | 'ACCEPTED' | 'REJECTED';

export type ObjectionError =
  | 'BOOKING_NOT_FOUND'
  | 'NOT_PATIENT'
  | 'OBJECTION_NOT_FOUND'
  | 'ALREADY_REVIEWED'
  | 'UNAUTHORIZED'
  | 'RESOLUTION_REQUIRED'
  | 'DB_ERROR';

export interface PatientObjection {
  id: string;
  bookingId: string;
  patientId: string;
  objectionType: ObjectionType;
  description: string | null;
  status: ObjectionStatus;
  reviewedBy: string | null;
  resolution: string | null;
  commissionReversed: boolean;
  reversalEntryId: string | null;
  createdAt: Date;
}

export interface RaiseObjectionParams {
  bookingId: string;
  patientId: string;
  objectionType: ObjectionType;
  description?: string;
  actorId: string;
  actorRole: string;
}

export interface ReviewObjectionParams {
  objectionId: string;
  decision: 'ACCEPTED' | 'REJECTED';
  resolution: string;
  actorId: string;
  actorRole: string;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Raise a patient objection on a booking.
 *
 * The patient must be the owner of the booking.
 */
export async function raiseObjection(
  db: Queryable,
  params: RaiseObjectionParams,
): Promise<Result<PatientObjection, ObjectionError>> {
  // 1. Verify booking belongs to patient
  const bookingRes = await db.query<{ patient_id: string; facility_id: string }>(
    `SELECT patient_id, facility_id FROM bookings WHERE id = $1`,
    [params.bookingId],
  );
  if (bookingRes.rows.length === 0) return err('BOOKING_NOT_FOUND');
  if (bookingRes.rows[0]!.patient_id !== params.patientId) return err('NOT_PATIENT');

  // 2. Insert objection
  const res = await db.query<PatientObjection>(
    `INSERT INTO patient_objections (
       booking_id, patient_id, objection_type, description
     ) VALUES ($1,$2,$3,$4)
     RETURNING
       id, booking_id AS "bookingId", patient_id AS "patientId",
       objection_type AS "objectionType", description,
       status, reviewed_by AS "reviewedBy", resolution,
       commission_reversed AS "commissionReversed",
       reversal_entry_id AS "reversalEntryId",
       created_at AS "createdAt"`,
    [
      params.bookingId,
      params.patientId,
      params.objectionType,
      params.description ?? null,
    ],
  );

  const objection = res.rows[0]!;

  // 3. Audit
  await record(db, {
    action: AUDIT_ACTIONS.VALUE_SUBMITTED,
    entityType: 'patient_objection',
    entityId: objection.id,
    actorUserId: params.actorId,
    actorRole: params.actorRole,
    facilityId: bookingRes.rows[0]!.facility_id,
    after: {
      bookingId: params.bookingId,
      objectionType: params.objectionType,
      status: 'PENDING',
    },
    reason: `Patient objection: ${params.objectionType}`,
  });

  return ok(objection);
}

/**
 * Review a patient objection (Zamo management only).
 *
 * If accepted, reverses the commission for that booking.
 */
export async function reviewObjection(
  db: Queryable,
  params: ReviewObjectionParams,
): Promise<Result<PatientObjection, ObjectionError>> {
  // 1. Authorization — Zamo only
  if (!['zamo_admin', 'zamo_ops'].includes(params.actorRole)) {
    return err('UNAUTHORIZED');
  }

  // 2. Resolution required
  if (!params.resolution || params.resolution.trim() === '') {
    return err('RESOLUTION_REQUIRED');
  }

  // 3. Fetch objection
  const objRes = await db.query<{
    id: string;
    booking_id: string;
    status: string;
  }>(
    `SELECT id, booking_id, status FROM patient_objections WHERE id = $1`,
    [params.objectionId],
  );
  if (objRes.rows.length === 0) return err('OBJECTION_NOT_FOUND');

  const current = objRes.rows[0]!;
  if (current.status === 'ACCEPTED' || current.status === 'REJECTED') {
    return err('ALREADY_REVIEWED');
  }

  // 4. If accepted, reverse commission
  let reversalEntryId: string | null = null;
  let commissionReversed = false;

  if (params.decision === 'ACCEPTED') {
    // Find the commission entry for this booking
    const ceRes = await db.query<{ id: string }>(
      `SELECT id FROM commission_entries
       WHERE booking_id = $1 AND is_reversal = false
       ORDER BY created_at DESC LIMIT 1`,
      [current.booking_id],
    );

    if (ceRes.rows.length > 0) {
      const reversalResult = await reverseCommission(
        db,
        ceRes.rows[0]!.id,
        `Patient objection accepted: ${params.resolution}`,
        params.actorId,
        params.actorRole,
      );
      if (reversalResult.ok) {
        reversalEntryId = reversalResult.value.id;
        commissionReversed = true;
      }
    }
  }

  // 5. Update objection
  const updateRes = await db.query<PatientObjection>(
    `UPDATE patient_objections
     SET status = $1, reviewed_by = $2, resolution = $3,
         commission_reversed = $4, reversal_entry_id = $5
     WHERE id = $6
     RETURNING
       id, booking_id AS "bookingId", patient_id AS "patientId",
       objection_type AS "objectionType", description,
       status, reviewed_by AS "reviewedBy", resolution,
       commission_reversed AS "commissionReversed",
       reversal_entry_id AS "reversalEntryId",
       created_at AS "createdAt"`,
    [
      params.decision,
      params.actorId,
      params.resolution.trim(),
      commissionReversed,
      reversalEntryId,
      params.objectionId,
    ],
  );

  const objection = updateRes.rows[0]!;

  // 6. Get facility_id for audit
  const bookingRes = await db.query<{ facility_id: string }>(
    `SELECT facility_id FROM bookings WHERE id = $1`,
    [current.booking_id],
  );

  // 7. Audit
  await record(db, {
    action: params.decision === 'ACCEPTED'
      ? AUDIT_ACTIONS.VALUE_APPROVED
      : AUDIT_ACTIONS.VALUE_REJECTED,
    entityType: 'patient_objection',
    entityId: objection.id,
    actorUserId: params.actorId,
    actorRole: params.actorRole,
    facilityId: bookingRes.rows[0]?.facility_id ?? null,
    before: { status: current.status },
    after: {
      status: params.decision,
      commissionReversed,
    },
    reason: params.resolution.trim(),
  });

  return ok(objection);
}

/**
 * List patient objections for a booking.
 */
export async function listObjections(
  db: Queryable,
  bookingId: string,
): Promise<PatientObjection[]> {
  const res = await db.query<PatientObjection>(
    `SELECT
       id, booking_id AS "bookingId", patient_id AS "patientId",
       objection_type AS "objectionType", description,
       status, reviewed_by AS "reviewedBy", resolution,
       commission_reversed AS "commissionReversed",
       reversal_entry_id AS "reversalEntryId",
       created_at AS "createdAt"
     FROM patient_objections
     WHERE booking_id = $1
     ORDER BY created_at DESC`,
    [bookingId],
  );
  return res.rows;
}
