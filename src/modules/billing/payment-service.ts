/**
 * ZAMO-BILL-067 — Payment Service.
 *
 * Manages payment submission, confirmation, and rejection.
 *
 * Key decisions enforced:
 *   B-26: Manual bank transfer + proof upload + Zamo confirmation.
 *   A-46: Every financial operation has Audit entry.
 */

import type { Queryable } from '../../db/client.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';
import { record, AUDIT_ACTIONS } from '../audit/audit.js';
import { markInvoicePaid } from './invoice-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaymentError =
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_NOT_PAYABLE'
  | 'INVALID_AMOUNT'
  | 'PAYMENT_NOT_FOUND'
  | 'ALREADY_PROCESSED'
  | 'REJECTION_REASON_REQUIRED'
  | 'UNAUTHORIZED'
  | 'DB_ERROR';

export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export interface Payment {
  id: string;
  invoiceId: string;
  facilityId: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  referenceNumber: string | null;
  proofUrl: string | null;
  status: PaymentStatus;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  rejectionReason: string | null;
  submittedBy: string;
  createdAt: Date;
}

export interface SubmitPaymentParams {
  invoiceId: string;
  facilityId: string;
  amount: number;
  referenceNumber?: string;
  proofUrl?: string;
  actorId: string;
  actorRole: string;
}

export interface ProcessPaymentParams {
  paymentId: string;
  decision: 'CONFIRMED' | 'REJECTED';
  rejectionReason?: string;
  actorId: string;
  actorRole: string;
}

// ---------------------------------------------------------------------------
// Allowed roles
// ---------------------------------------------------------------------------

const SUBMISSION_ROLES: ReadonlySet<string> = new Set([
  'facility_manager', 'accountant',
]);

const CONFIRMATION_ROLES: ReadonlySet<string> = new Set([
  'zamo_admin', 'zamo_ops',
]);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Submit a payment record (B-26: manual bank transfer).
 *
 * The facility uploads proof of transfer; Zamo confirms receipt later.
 */
export async function submitPayment(
  db: Queryable,
  params: SubmitPaymentParams,
): Promise<Result<Payment, PaymentError>> {
  // 1. Authorization
  if (!SUBMISSION_ROLES.has(params.actorRole)) {
    return err('UNAUTHORIZED');
  }

  // 2. Validate amount
  if (params.amount <= 0) {
    return err('INVALID_AMOUNT');
  }

  // 3. Verify invoice exists and is payable
  const invRes = await db.query<{ status: string }>(
    `SELECT status FROM invoices WHERE id = $1 AND facility_id = $2`,
    [params.invoiceId, params.facilityId],
  );
  if (invRes.rows.length === 0) return err('INVOICE_NOT_FOUND');
  if (!['ISSUED', 'OVERDUE'].includes(invRes.rows[0]!.status)) {
    return err('INVOICE_NOT_PAYABLE');
  }

  // 4. Insert payment
  const res = await db.query<Payment>(
    `INSERT INTO payments (
       invoice_id, facility_id, amount,
       payment_method, reference_number, proof_url,
       submitted_by
     ) VALUES ($1,$2,$3,'bank_transfer',$4,$5,$6)
     RETURNING
       id, invoice_id AS "invoiceId", facility_id AS "facilityId",
       amount, currency, payment_method AS "paymentMethod",
       reference_number AS "referenceNumber", proof_url AS "proofUrl",
       status, confirmed_by AS "confirmedBy", confirmed_at AS "confirmedAt",
       rejection_reason AS "rejectionReason",
       submitted_by AS "submittedBy", created_at AS "createdAt"`,
    [
      params.invoiceId,
      params.facilityId,
      params.amount,
      params.referenceNumber ?? null,
      params.proofUrl ?? null,
      params.actorId,
    ],
  );

  const payment = res.rows[0]!;

  // 5. Audit
  await record(db, {
    action: AUDIT_ACTIONS.VALUE_SUBMITTED,
    entityType: 'payment',
    entityId: payment.id,
    actorUserId: params.actorId,
    actorRole: params.actorRole,
    facilityId: params.facilityId,
    after: {
      invoiceId: params.invoiceId,
      amount: params.amount,
      referenceNumber: params.referenceNumber,
    },
    reason: 'Payment submitted (B-26)',
  });

  return ok(payment);
}

/**
 * Confirm or reject a payment (Zamo admin only).
 *
 * Confirmation updates the invoice status to PAID.
 */
export async function processPayment(
  db: Queryable,
  params: ProcessPaymentParams,
): Promise<Result<Payment, PaymentError>> {
  // 1. Authorization — Zamo only
  if (!CONFIRMATION_ROLES.has(params.actorRole)) {
    return err('UNAUTHORIZED');
  }

  // 2. Fetch payment
  const payRes = await db.query<Payment>(
    `SELECT
       id, invoice_id AS "invoiceId", facility_id AS "facilityId",
       amount, currency, payment_method AS "paymentMethod",
       reference_number AS "referenceNumber", proof_url AS "proofUrl",
       status, confirmed_by AS "confirmedBy", confirmed_at AS "confirmedAt",
       rejection_reason AS "rejectionReason",
       submitted_by AS "submittedBy", created_at AS "createdAt"
     FROM payments WHERE id = $1`,
    [params.paymentId],
  );
  if (payRes.rows.length === 0) return err('PAYMENT_NOT_FOUND');

  const current = payRes.rows[0]!;
  if (current.status !== 'PENDING') return err('ALREADY_PROCESSED');

  // 3. Validate rejection reason
  if (params.decision === 'REJECTED' && (!params.rejectionReason || params.rejectionReason.trim() === '')) {
    return err('REJECTION_REASON_REQUIRED');
  }

  // 4. Update payment
  const updateRes = await db.query<Payment>(
    `UPDATE payments
     SET status = $1, confirmed_by = $2, confirmed_at = now(),
         rejection_reason = $3
     WHERE id = $4
     RETURNING
       id, invoice_id AS "invoiceId", facility_id AS "facilityId",
       amount, currency, payment_method AS "paymentMethod",
       reference_number AS "referenceNumber", proof_url AS "proofUrl",
       status, confirmed_by AS "confirmedBy", confirmed_at AS "confirmedAt",
       rejection_reason AS "rejectionReason",
       submitted_by AS "submittedBy", created_at AS "createdAt"`,
    [
      params.decision,
      params.actorId,
      params.rejectionReason ?? null,
      params.paymentId,
    ],
  );

  const payment = updateRes.rows[0]!;

  // 5. If confirmed, update invoice to PAID
  if (params.decision === 'CONFIRMED') {
    await markInvoicePaid(db, current.invoiceId, params.actorId, params.actorRole);
  }

  // 6. Audit
  await record(db, {
    action: params.decision === 'CONFIRMED'
      ? AUDIT_ACTIONS.VALUE_APPROVED
      : AUDIT_ACTIONS.VALUE_REJECTED,
    entityType: 'payment',
    entityId: payment.id,
    actorUserId: params.actorId,
    actorRole: params.actorRole,
    facilityId: current.facilityId,
    before: { status: 'PENDING' },
    after: { status: params.decision },
    reason: params.decision === 'REJECTED'
      ? params.rejectionReason!
      : 'Payment confirmed (B-26)',
  });

  return ok(payment);
}

/**
 * List payments for an invoice.
 */
export async function listPayments(
  db: Queryable,
  invoiceId: string,
): Promise<Payment[]> {
  const res = await db.query<Payment>(
    `SELECT
       id, invoice_id AS "invoiceId", facility_id AS "facilityId",
       amount, currency, payment_method AS "paymentMethod",
       reference_number AS "referenceNumber", proof_url AS "proofUrl",
       status, confirmed_by AS "confirmedBy", confirmed_at AS "confirmedAt",
       rejection_reason AS "rejectionReason",
       submitted_by AS "submittedBy", created_at AS "createdAt"
     FROM payments
     WHERE invoice_id = $1
     ORDER BY created_at DESC`,
    [invoiceId],
  );
  return res.rows;
}
