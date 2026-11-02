/**
 * ZAMO-BILL-066 — Invoice Service.
 *
 * Generates, issues, and manages monthly commission invoices.
 *
 * Key decisions enforced:
 *   A-08:  Monthly commission invoice.
 *   A-46:  Modifications to issued invoices → Audit.
 *   B-11:  VAT 15% on top of commission.
 *   B-15:  Invoice within 5 business days. Due in 30 days. Object in 7.
 *   B-24:  SAR currency.
 *   [S1]:  9 fields. Each line item traceable to booking+service+value.
 *   [S2]:  Invoice must be "reviewable" — every item traceable.
 */

import type { Queryable } from '../../db/client.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';
import { record, AUDIT_ACTIONS } from '../audit/audit.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvoiceError =
  | 'PERIOD_NOT_CLOSED'
  | 'INVOICE_ALREADY_EXISTS'
  | 'INVOICE_NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'
  | 'NO_LINE_ITEMS'
  | 'DB_ERROR';

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'OBJECTED';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  billingPeriodId: string;
  facilityId: string;
  serviceCount: number;
  totalCollected: string;
  totalCommission: string;
  totalVat: string;
  grandTotal: string;
  zamoTaxNumber: string | null;
  issuedAt: Date | null;
  dueDate: string | null;
  objectionDeadline: string | null;
  status: InvoiceStatus;
  currency: string;
  createdAt: Date;
}

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  commissionEntryId: string;
  bookingId: string;
  serviceNameAr: string;
  serviceNameEn: string | null;
  collectedAmount: string;
  commissionRate: string;
  commissionAmount: string;
  vatAmount: string;
  lineTotal: string;
}

// ---------------------------------------------------------------------------
// Invoice Number Generation
// ---------------------------------------------------------------------------

/**
 * Generate a sequential invoice number: ZAMO-INV-YYYYMM-NNN.
 */
async function generateInvoiceNumber(
  db: Queryable,
  periodKey: string,
): Promise<string> {
  const res = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM invoices
     WHERE invoice_number LIKE $1`,
    [`ZAMO-INV-${periodKey.replace('-', '')}-%`],
  );
  const seq = Number(res.rows[0]!.count) + 1;
  return `ZAMO-INV-${periodKey.replace('-', '')}-${String(seq).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Invoice Operations
// ---------------------------------------------------------------------------

/**
 * Generate a draft invoice from a closed billing period.
 *
 * Idempotent: if an invoice already exists for this period+facility,
 * returns the existing one.
 */
export async function generateInvoice(
  db: Queryable,
  billingPeriodId: string,
  facilityId: string,
  periodKey: string,
  zamoTaxNumber?: string,
): Promise<Result<Invoice, InvoiceError>> {
  // 1. Verify period is closed
  const periodRes = await db.query<{ status: string }>(
    `SELECT status FROM billing_periods WHERE id = $1 AND facility_id = $2`,
    [billingPeriodId, facilityId],
  );
  if (periodRes.rows.length === 0 || periodRes.rows[0]!.status !== 'CLOSED') {
    return err('PERIOD_NOT_CLOSED');
  }

  // 2. Check if invoice already exists (idempotent)
  const existingRes = await db.query<Invoice>(
    `SELECT
       id, invoice_number AS "invoiceNumber",
       billing_period_id AS "billingPeriodId", facility_id AS "facilityId",
       service_count AS "serviceCount",
       total_collected AS "totalCollected", total_commission AS "totalCommission",
       total_vat AS "totalVat", grand_total AS "grandTotal",
       zamo_tax_number AS "zamoTaxNumber",
       issued_at AS "issuedAt", due_date AS "dueDate",
       objection_deadline AS "objectionDeadline",
       status, currency, created_at AS "createdAt"
     FROM invoices
     WHERE billing_period_id = $1 AND facility_id = $2`,
    [billingPeriodId, facilityId],
  );
  if (existingRes.rows.length > 0) {
    return ok(existingRes.rows[0]!);
  }

  // 3. Aggregate commission entries for this period
  const aggRes = await db.query<{
    entry_count: string;
    total_collected: string;
    total_commission: string;
    total_vat: string;
    grand_total: string;
  }>(
    `SELECT
       COUNT(*)::text AS entry_count,
       COALESCE(SUM(collected_amount), 0) AS total_collected,
       COALESCE(SUM(commission_amount), 0) AS total_commission,
       COALESCE(SUM(vat_amount), 0) AS total_vat,
       COALESCE(SUM(total_with_vat), 0) AS grand_total
     FROM commission_entries
     WHERE billing_period_id = $1 AND facility_id = $2`,
    [billingPeriodId, facilityId],
  );

  const agg = aggRes.rows[0]!;
  if (Number(agg.entry_count) === 0) {
    return err('NO_LINE_ITEMS');
  }

  // 4. Generate invoice number
  const invoiceNumber = await generateInvoiceNumber(db, periodKey);

  // 5. Insert draft invoice
  const invRes = await db.query<Invoice>(
    `INSERT INTO invoices (
       invoice_number, billing_period_id, facility_id,
       service_count, total_collected, total_commission,
       total_vat, grand_total, zamo_tax_number, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT')
     RETURNING
       id, invoice_number AS "invoiceNumber",
       billing_period_id AS "billingPeriodId", facility_id AS "facilityId",
       service_count AS "serviceCount",
       total_collected AS "totalCollected", total_commission AS "totalCommission",
       total_vat AS "totalVat", grand_total AS "grandTotal",
       zamo_tax_number AS "zamoTaxNumber",
       issued_at AS "issuedAt", due_date AS "dueDate",
       objection_deadline AS "objectionDeadline",
       status, currency, created_at AS "createdAt"`,
    [
      invoiceNumber,
      billingPeriodId,
      facilityId,
      Number(agg.entry_count),
      agg.total_collected,
      agg.total_commission,
      agg.total_vat,
      agg.grand_total,
      zamoTaxNumber ?? null,
    ],
  );

  const invoice = invRes.rows[0]!;

  // 6. Populate line items — each traceable to booking+service+value [S2]
  await db.query(
    `INSERT INTO invoice_line_items (
       invoice_id, commission_entry_id, booking_id,
       service_name_ar, service_name_en,
       collected_amount, commission_rate, commission_amount,
       vat_amount, line_total
     )
     SELECT
       $1, ce.id, ce.booking_id,
       COALESCE(s.name_ar, 'خدمة'), COALESCE(s.name_en, 'Service'),
       ce.collected_amount, ce.applied_rate, ce.commission_amount,
       ce.vat_amount, ce.total_with_vat
     FROM commission_entries ce
     LEFT JOIN bookings b ON b.id = ce.booking_id
     LEFT JOIN branch_services bs ON bs.id = b.branch_service_id
     LEFT JOIN services s ON s.id = bs.service_id
     WHERE ce.billing_period_id = $2 AND ce.facility_id = $3`,
    [invoice.id, billingPeriodId, facilityId],
  );

  return ok(invoice);
}

/**
 * Issue a draft invoice: DRAFT → ISSUED.
 *
 * Sets issued_at, due_date (B-15: +30 days), objection_deadline (+7 business days).
 */
export async function issueInvoice(
  db: Queryable,
  invoiceId: string,
  actorId: string,
  actorRole: string,
): Promise<Result<Invoice, InvoiceError>> {
  // 1. Fetch and validate
  const current = await getInvoice(db, invoiceId);
  if (!current) return err('INVOICE_NOT_FOUND');
  if (current.status !== 'DRAFT') return err('INVALID_STATUS_TRANSITION');

  const issuedAt = new Date();
  const dueDate = new Date(issuedAt);
  dueDate.setDate(dueDate.getDate() + 30); // B-15: 30 days

  const objectionDeadline = addBusinessDays(issuedAt, 7); // B-15: 7 business days

  // 2. Update
  const res = await db.query<Invoice>(
    `UPDATE invoices
     SET status = 'ISSUED', issued_at = $1, due_date = $2, objection_deadline = $3
     WHERE id = $4
     RETURNING
       id, invoice_number AS "invoiceNumber",
       billing_period_id AS "billingPeriodId", facility_id AS "facilityId",
       service_count AS "serviceCount",
       total_collected AS "totalCollected", total_commission AS "totalCommission",
       total_vat AS "totalVat", grand_total AS "grandTotal",
       zamo_tax_number AS "zamoTaxNumber",
       issued_at AS "issuedAt", due_date AS "dueDate",
       objection_deadline AS "objectionDeadline",
       status, currency, created_at AS "createdAt"`,
    [issuedAt, dueDate.toISOString().slice(0, 10), objectionDeadline, invoiceId],
  );

  const invoice = res.rows[0]!;

  // 3. Audit (A-46)
  await record(db, {
    action: AUDIT_ACTIONS.INVOICE_ISSUED,
    entityType: 'invoice',
    entityId: invoice.id,
    actorUserId: actorId,
    actorRole,
    facilityId: invoice.facilityId,
    before: { status: 'DRAFT' },
    after: {
      status: 'ISSUED',
      issuedAt: issuedAt.toISOString(),
      dueDate: dueDate.toISOString().slice(0, 10),
    },
    reason: 'Invoice issued (B-15)',
  });

  return ok(invoice);
}

/**
 * Mark an overdue invoice: ISSUED → OVERDUE.
 * Called by a daily cron job.
 */
export async function markOverdueInvoices(
  db: Queryable,
): Promise<number> {
  const res = await db.query<{ id: string }>(
    `UPDATE invoices
     SET status = 'OVERDUE'
     WHERE status = 'ISSUED'
       AND due_date < CURRENT_DATE
     RETURNING id`,
  );
  return res.rowCount;
}

/**
 * Mark invoice as paid: ISSUED/OVERDUE → PAID.
 */
export async function markInvoicePaid(
  db: Queryable,
  invoiceId: string,
  actorId: string,
  actorRole: string,
): Promise<Result<Invoice, InvoiceError>> {
  const current = await getInvoice(db, invoiceId);
  if (!current) return err('INVOICE_NOT_FOUND');
  if (current.status !== 'ISSUED' && current.status !== 'OVERDUE') {
    return err('INVALID_STATUS_TRANSITION');
  }

  const res = await db.query<Invoice>(
    `UPDATE invoices SET status = 'PAID' WHERE id = $1
     RETURNING
       id, invoice_number AS "invoiceNumber",
       billing_period_id AS "billingPeriodId", facility_id AS "facilityId",
       service_count AS "serviceCount",
       total_collected AS "totalCollected", total_commission AS "totalCommission",
       total_vat AS "totalVat", grand_total AS "grandTotal",
       zamo_tax_number AS "zamoTaxNumber",
       issued_at AS "issuedAt", due_date AS "dueDate",
       objection_deadline AS "objectionDeadline",
       status, currency, created_at AS "createdAt"`,
    [invoiceId],
  );

  await record(db, {
    action: AUDIT_ACTIONS.INVOICE_ADJUSTED,
    entityType: 'invoice',
    entityId: invoiceId,
    actorUserId: actorId,
    actorRole,
    facilityId: current.facilityId,
    before: { status: current.status },
    after: { status: 'PAID' },
    reason: 'Payment confirmed',
  });

  return ok(res.rows[0]!);
}

/**
 * Get an invoice with its line items.
 */
export async function getInvoiceWithLineItems(
  db: Queryable,
  invoiceId: string,
): Promise<{ invoice: Invoice; lineItems: InvoiceLineItem[] } | null> {
  const invoice = await getInvoice(db, invoiceId);
  if (!invoice) return null;

  const itemsRes = await db.query<InvoiceLineItem>(
    `SELECT
       id, invoice_id AS "invoiceId",
       commission_entry_id AS "commissionEntryId",
       booking_id AS "bookingId",
       service_name_ar AS "serviceNameAr", service_name_en AS "serviceNameEn",
       collected_amount AS "collectedAmount",
       commission_rate AS "commissionRate",
       commission_amount AS "commissionAmount",
       vat_amount AS "vatAmount", line_total AS "lineTotal"
     FROM invoice_line_items
     WHERE invoice_id = $1
     ORDER BY created_at`,
    [invoiceId],
  );

  return { invoice, lineItems: itemsRes.rows };
}

/**
 * List invoices for a facility.
 */
export async function listInvoices(
  db: Queryable,
  facilityId: string,
  filters?: { status?: InvoiceStatus },
): Promise<Invoice[]> {
  const where = ['facility_id = $1'];
  const params: unknown[] = [facilityId];

  if (filters?.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }

  const res = await db.query<Invoice>(
    `SELECT
       id, invoice_number AS "invoiceNumber",
       billing_period_id AS "billingPeriodId", facility_id AS "facilityId",
       service_count AS "serviceCount",
       total_collected AS "totalCollected", total_commission AS "totalCommission",
       total_vat AS "totalVat", grand_total AS "grandTotal",
       zamo_tax_number AS "zamoTaxNumber",
       issued_at AS "issuedAt", due_date AS "dueDate",
       objection_deadline AS "objectionDeadline",
       status, currency, created_at AS "createdAt"
     FROM invoices
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );

  return res.rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getInvoice(db: Queryable, invoiceId: string): Promise<Invoice | null> {
  const res = await db.query<Invoice>(
    `SELECT
       id, invoice_number AS "invoiceNumber",
       billing_period_id AS "billingPeriodId", facility_id AS "facilityId",
       service_count AS "serviceCount",
       total_collected AS "totalCollected", total_commission AS "totalCommission",
       total_vat AS "totalVat", grand_total AS "grandTotal",
       zamo_tax_number AS "zamoTaxNumber",
       issued_at AS "issuedAt", due_date AS "dueDate",
       objection_deadline AS "objectionDeadline",
       status, currency, created_at AS "createdAt"
     FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  return res.rows[0] ?? null;
}

/**
 * Add business days (skip Saturday + Friday for Saudi weekend).
 */
function addBusinessDays(from: Date, days: number): string {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    // Saudi weekend: Friday (5) and Saturday (6)
    if (day !== 5 && day !== 6) {
      added++;
    }
  }
  return result.toISOString().slice(0, 10);
}
