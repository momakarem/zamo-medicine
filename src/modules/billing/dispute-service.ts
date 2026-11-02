/**
 * ZAMO-DISP-068 — Dispute Service.
 *
 * Manages disputes between facilities and Zamo.
 *
 * 7 dispute types from [S1]:
 *   1. patient_no_show
 *   2. service_not_performed
 *   3. incorrect_value
 *   4. patient_source_disputed
 *   5. incorrect_commission
 *   6. booking_complaint
 *   7. advertising_complaint
 *
 * Key decisions enforced:
 *   A-46: All operations in Audit.
 *   Resolved disputes can reverse commission impact.
 *   Parties see their own disputes only (RLS).
 */

import type { Queryable } from '../../db/client.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';
import { record, AUDIT_ACTIONS } from '../audit/audit.js';
import { reverseCommission } from './commission-compute.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DisputeType =
  | 'patient_no_show'
  | 'service_not_performed'
  | 'incorrect_value'
  | 'patient_source_disputed'
  | 'incorrect_commission'
  | 'booking_complaint'
  | 'advertising_complaint';

export type DisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED' | 'CLOSED';

export type DisputeError =
  | 'DISPUTE_NOT_FOUND'
  | 'ALREADY_RESOLVED'
  | 'INVALID_TYPE'
  | 'DESCRIPTION_REQUIRED'
  | 'RESOLUTION_REQUIRED'
  | 'DB_ERROR';

export interface Dispute {
  id: string;
  disputeNumber: string;
  disputeType: DisputeType;
  bookingId: string | null;
  invoiceId: string | null;
  facilityId: string;
  raisedBy: string;
  raisedByRole: string;
  assignedTo: string | null;
  description: string;
  status: DisputeStatus;
  resolution: string | null;
  financialImpact: string | null;
  commissionEntryId: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

export interface Evidence {
  id: string;
  disputeId: string;
  uploadedBy: string;
  fileUrl: string;
  fileType: string;
  description: string | null;
  createdAt: Date;
}

export interface OpenDisputeParams {
  disputeType: DisputeType;
  bookingId?: string;
  invoiceId?: string;
  facilityId: string;
  description: string;
  actorId: string;
  actorRole: string;
}

export interface ResolveDisputeParams {
  disputeId: string;
  resolution: string;
  financialImpact?: number;
  commissionEntryIdToReverse?: string;
  actorId: string;
  actorRole: string;
}

export interface UploadEvidenceParams {
  disputeId: string;
  fileUrl: string;
  fileType: string;
  description?: string;
  actorId: string;
}

// ---------------------------------------------------------------------------
// Dispute Number Generation
// ---------------------------------------------------------------------------

async function generateDisputeNumber(db: Queryable): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const res = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM disputes
     WHERE dispute_number LIKE $1`,
    [`ZAMO-DSP-${yearMonth}-%`],
  );
  const seq = Number(res.rows[0]!.count) + 1;
  return `ZAMO-DSP-${yearMonth}-${String(seq).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Open a new dispute.
 */
export async function openDispute(
  db: Queryable,
  params: OpenDisputeParams,
): Promise<Result<Dispute, DisputeError>> {
  if (!params.description || params.description.trim() === '') {
    return err('DESCRIPTION_REQUIRED');
  }

  const disputeNumber = await generateDisputeNumber(db);

  const res = await db.query<Dispute>(
    `INSERT INTO disputes (
       dispute_number, dispute_type,
       booking_id, invoice_id, facility_id,
       raised_by, raised_by_role,
       description
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING
       id, dispute_number AS "disputeNumber", dispute_type AS "disputeType",
       booking_id AS "bookingId", invoice_id AS "invoiceId",
       facility_id AS "facilityId",
       raised_by AS "raisedBy", raised_by_role AS "raisedByRole",
       assigned_to AS "assignedTo", description,
       status, resolution,
       financial_impact AS "financialImpact",
       commission_entry_id AS "commissionEntryId",
       created_at AS "createdAt", closed_at AS "closedAt"`,
    [
      disputeNumber,
      params.disputeType,
      params.bookingId ?? null,
      params.invoiceId ?? null,
      params.facilityId,
      params.actorId,
      params.actorRole,
      params.description.trim(),
    ],
  );

  const dispute = res.rows[0]!;

  await record(db, {
    action: AUDIT_ACTIONS.INVOICE_ADJUSTED,
    entityType: 'dispute',
    entityId: dispute.id,
    actorUserId: params.actorId,
    actorRole: params.actorRole,
    facilityId: params.facilityId,
    after: {
      disputeType: params.disputeType,
      status: 'OPEN',
    },
    reason: `Dispute opened: ${params.disputeType}`,
  });

  return ok(dispute);
}

/**
 * Upload evidence for a dispute.
 */
export async function uploadEvidence(
  db: Queryable,
  params: UploadEvidenceParams,
): Promise<Result<Evidence, DisputeError>> {
  // Verify dispute exists
  const dispRes = await db.query<{ id: string }>(
    `SELECT id FROM disputes WHERE id = $1`,
    [params.disputeId],
  );
  if (dispRes.rows.length === 0) return err('DISPUTE_NOT_FOUND');

  const res = await db.query<Evidence>(
    `INSERT INTO dispute_evidence (
       dispute_id, uploaded_by, file_url, file_type, description
     ) VALUES ($1,$2,$3,$4,$5)
     RETURNING
       id, dispute_id AS "disputeId", uploaded_by AS "uploadedBy",
       file_url AS "fileUrl", file_type AS "fileType",
       description, created_at AS "createdAt"`,
    [
      params.disputeId,
      params.actorId,
      params.fileUrl,
      params.fileType,
      params.description ?? null,
    ],
  );

  return ok(res.rows[0]!);
}

/**
 * Resolve a dispute. If financial impact is specified and a commission
 * entry is referenced, a reversal entry is created.
 */
export async function resolveDispute(
  db: Queryable,
  params: ResolveDisputeParams,
): Promise<Result<Dispute, DisputeError>> {
  if (!params.resolution || params.resolution.trim() === '') {
    return err('RESOLUTION_REQUIRED');
  }

  // 1. Fetch dispute
  const current = await getDispute(db, params.disputeId);
  if (!current) return err('DISPUTE_NOT_FOUND');
  if (current.status === 'RESOLVED' || current.status === 'CLOSED') {
    return err('ALREADY_RESOLVED');
  }

  // 2. If there's a commission impact, create reversal
  let reversalEntryId: string | null = null;
  if (params.commissionEntryIdToReverse) {
    const reversalResult = await reverseCommission(
      db,
      params.commissionEntryIdToReverse,
      `Dispute ${current.disputeNumber} resolved: ${params.resolution}`,
      params.actorId,
      params.actorRole,
    );
    if (reversalResult.ok) {
      reversalEntryId = reversalResult.value.id;
    }
  }

  // 3. Update dispute
  const res = await db.query<Dispute>(
    `UPDATE disputes
     SET status = 'RESOLVED',
         resolution = $1,
         financial_impact = $2,
         commission_entry_id = $3,
         closed_at = now()
     WHERE id = $4
     RETURNING
       id, dispute_number AS "disputeNumber", dispute_type AS "disputeType",
       booking_id AS "bookingId", invoice_id AS "invoiceId",
       facility_id AS "facilityId",
       raised_by AS "raisedBy", raised_by_role AS "raisedByRole",
       assigned_to AS "assignedTo", description,
       status, resolution,
       financial_impact AS "financialImpact",
       commission_entry_id AS "commissionEntryId",
       created_at AS "createdAt", closed_at AS "closedAt"`,
    [
      params.resolution.trim(),
      params.financialImpact ?? null,
      reversalEntryId,
      params.disputeId,
    ],
  );

  const dispute = res.rows[0]!;

  await record(db, {
    action: AUDIT_ACTIONS.INVOICE_ADJUSTED,
    entityType: 'dispute',
    entityId: dispute.id,
    actorUserId: params.actorId,
    actorRole: params.actorRole,
    facilityId: current.facilityId,
    before: { status: current.status },
    after: {
      status: 'RESOLVED',
      resolution: params.resolution,
      financialImpact: params.financialImpact,
    },
    reason: `Dispute resolved: ${params.resolution}`,
  });

  return ok(dispute);
}

/**
 * List disputes for a facility.
 */
export async function listDisputes(
  db: Queryable,
  facilityId: string,
  filters?: { status?: DisputeStatus },
): Promise<Dispute[]> {
  const where = ['facility_id = $1'];
  const params: unknown[] = [facilityId];

  if (filters?.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }

  const res = await db.query<Dispute>(
    `SELECT
       id, dispute_number AS "disputeNumber", dispute_type AS "disputeType",
       booking_id AS "bookingId", invoice_id AS "invoiceId",
       facility_id AS "facilityId",
       raised_by AS "raisedBy", raised_by_role AS "raisedByRole",
       assigned_to AS "assignedTo", description,
       status, resolution,
       financial_impact AS "financialImpact",
       commission_entry_id AS "commissionEntryId",
       created_at AS "createdAt", closed_at AS "closedAt"
     FROM disputes
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getDispute(db: Queryable, disputeId: string): Promise<Dispute | null> {
  const res = await db.query<Dispute>(
    `SELECT
       id, dispute_number AS "disputeNumber", dispute_type AS "disputeType",
       booking_id AS "bookingId", invoice_id AS "invoiceId",
       facility_id AS "facilityId",
       raised_by AS "raisedBy", raised_by_role AS "raisedByRole",
       assigned_to AS "assignedTo", description,
       status, resolution,
       financial_impact AS "financialImpact",
       commission_entry_id AS "commissionEntryId",
       created_at AS "createdAt", closed_at AS "closedAt"
     FROM disputes WHERE id = $1`,
    [disputeId],
  );
  return res.rows[0] ?? null;
}
