/**
 * ZAMO-BILL-064 — Commission Computation.
 *
 * Computes commission when a value is approved (booking reaches COLLECTED).
 * Creates an immutable CommissionEntry with snapshot of the applied rule (DEC-007).
 *
 * Key decisions enforced:
 *   A-07:  Commission on executed+collected service only.
 *   B-11:  VAT 15% on top of commission.
 *   B-12:  Accrual at manager approval. Per-payment. Partial collection.
 *   B-13:  Based on collected amount for actual service (not booked).
 *   B-24:  SAR, ceiling to nearest 0.01.
 *   B-25:  Commission on collected offer price (not original).
 *   DEC-007: Snapshot — stores rate/amounts at computation time.
 *   DEC-008: Rule active at accrual date is applied.
 */

import type { Queryable } from '../../db/client.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';
import { resolveCommissionRule } from './commission-engine.js';
import { record, AUDIT_ACTIONS } from '../audit/audit.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComputeError =
  | 'NO_RULE_FOUND'
  | 'INVALID_AMOUNT'
  | 'DB_ERROR';

export interface CommissionEntryResult {
  id: string;
  bookingId: string;
  valueApprovalId: string;
  facilityId: string;
  ruleId: string;
  ruleScope: string;
  appliedRate: string;
  collectedAmount: string;
  commissionAmount: string;
  vatRate: string;
  vatAmount: string;
  totalWithVat: string;
  accruedAt: Date;
}

export interface ComputeCommissionParams {
  bookingId: string;
  valueApprovalId: string;
  facilityId: string;
  serviceId: string;    // actual service performed (B-13)
  approvedAmount: number;  // collected amount (B-12, B-13, B-25)
  accrualDate: Date;       // moment of approval (B-12)
  actorId: string;
  actorRole: string;
}

// ---------------------------------------------------------------------------
// VAT configuration (B-11)
// ---------------------------------------------------------------------------

/** Saudi VAT rate. Configurable from admin panel per B-11 note. */
const DEFAULT_VAT_RATE = 0.15;

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Ceiling to nearest halalah (0.01 SAR) — B-24.
 *
 * Uses integer arithmetic to avoid floating-point errors:
 *   Math.ceil(amount * 100) / 100
 */
export function ceilToHalalah(amount: number): number {
  return Math.ceil(amount * 100) / 100;
}

/**
 * Compute commission for an approved collection.
 *
 * Called when value_approvals.decision = 'APPROVED' (B-12).
 * This function:
 *   1. Resolves the applicable rule (commission-engine)
 *   2. Computes commission = collectedAmount × rate
 *   3. Computes VAT = commission × 0.15 (B-11)
 *   4. Stores immutable snapshot (DEC-007)
 *   5. Records Audit entry (A-46)
 */
export async function computeCommission(
  db: Queryable,
  params: ComputeCommissionParams,
): Promise<Result<CommissionEntryResult, ComputeError>> {
  // 1. Validate amount
  if (params.approvedAmount < 0) {
    return err('INVALID_AMOUNT');
  }

  // Zero amount = zero commission (valid but nothing to compute)
  if (params.approvedAmount === 0) {
    return await insertEntry(db, params, {
      ruleId: 'N/A',
      ruleScope: 'platform',
      appliedRate: 0,
      commissionAmount: 0,
      vatAmount: 0,
      totalWithVat: 0,
    });
  }

  // 2. Resolve commission rule (DEC-008: at accrual date)
  const resolved = await resolveCommissionRule(
    db,
    params.serviceId,
    params.facilityId,
    params.accrualDate,
  );

  if (!resolved) {
    return err('NO_RULE_FOUND');
  }

  // 3. Compute amounts
  const rate = Number(resolved.rule.rate);
  const commissionAmount = ceilToHalalah(params.approvedAmount * rate);
  const vatAmount = ceilToHalalah(commissionAmount * DEFAULT_VAT_RATE);
  const totalWithVat = ceilToHalalah(commissionAmount + vatAmount);

  // 4. Insert immutable entry (DEC-007)
  return await insertEntry(db, params, {
    ruleId: resolved.rule.id,
    ruleScope: resolved.matchLevel,
    appliedRate: rate,
    commissionAmount,
    vatAmount,
    totalWithVat,
  });
}

/**
 * Create a reversal commission entry (for accepted disputes/objections).
 * The reversal is a negative entry that offsets the original.
 */
export async function reverseCommission(
  db: Queryable,
  originalEntryId: string,
  reason: string,
  actorId: string,
  actorRole: string,
): Promise<Result<CommissionEntryResult, ComputeError>> {
  // Fetch original entry
  const origRes = await db.query<{
    booking_id: string;
    value_approval_id: string;
    facility_id: string;
    rule_id: string;
    rule_scope: string;
    applied_rate: string;
    collected_amount: string;
    commission_amount: string;
    vat_rate: string;
    vat_amount: string;
    total_with_vat: string;
  }>(
    `SELECT booking_id, value_approval_id, facility_id,
            rule_id, rule_scope, applied_rate,
            collected_amount, commission_amount,
            vat_rate, vat_amount, total_with_vat
     FROM commission_entries WHERE id = $1`,
    [originalEntryId],
  );

  if (origRes.rows.length === 0) {
    return err('DB_ERROR');
  }

  const orig = origRes.rows[0]!;

  // Insert reversal (negative amounts)
  const res = await db.query<CommissionEntryResult>(
    `INSERT INTO commission_entries (
       booking_id, value_approval_id, facility_id,
       rule_id, rule_scope, applied_rate,
       collected_amount, commission_amount,
       vat_rate, vat_amount, total_with_vat,
       is_reversal, reverses_entry_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12)
     RETURNING
       id, booking_id AS "bookingId", value_approval_id AS "valueApprovalId",
       facility_id AS "facilityId", rule_id AS "ruleId", rule_scope AS "ruleScope",
       applied_rate AS "appliedRate", collected_amount AS "collectedAmount",
       commission_amount AS "commissionAmount", vat_rate AS "vatRate",
       vat_amount AS "vatAmount", total_with_vat AS "totalWithVat",
       accrued_at AS "accruedAt"`,
    [
      orig.booking_id,
      orig.value_approval_id,
      orig.facility_id,
      orig.rule_id,
      orig.rule_scope,
      orig.applied_rate,
      orig.collected_amount,
      -Number(orig.commission_amount),
      orig.vat_rate,
      -Number(orig.vat_amount),
      -Number(orig.total_with_vat),
      originalEntryId,
    ],
  );

  const entry = res.rows[0]!;

  // Audit
  await record(db, {
    action: AUDIT_ACTIONS.COMMISSION_RULE_CHANGED,
    entityType: 'commission_entry',
    entityId: entry.id,
    actorUserId: actorId,
    actorRole: actorRole,
    facilityId: orig.facility_id,
    before: { originalEntryId },
    after: {
      commissionAmount: entry.commissionAmount,
      isReversal: true,
    },
    reason,
  });

  return ok(entry);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function insertEntry(
  db: Queryable,
  params: ComputeCommissionParams,
  computed: {
    ruleId: string;
    ruleScope: string;
    appliedRate: number;
    commissionAmount: number;
    vatAmount: number;
    totalWithVat: number;
  },
): Promise<Result<CommissionEntryResult, ComputeError>> {
  const res = await db.query<CommissionEntryResult>(
    `INSERT INTO commission_entries (
       booking_id, value_approval_id, facility_id,
       rule_id, rule_scope, applied_rate,
       collected_amount, commission_amount,
       vat_rate, vat_amount, total_with_vat,
       accrued_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING
       id, booking_id AS "bookingId", value_approval_id AS "valueApprovalId",
       facility_id AS "facilityId", rule_id AS "ruleId", rule_scope AS "ruleScope",
       applied_rate AS "appliedRate", collected_amount AS "collectedAmount",
       commission_amount AS "commissionAmount", vat_rate AS "vatRate",
       vat_amount AS "vatAmount", total_with_vat AS "totalWithVat",
       accrued_at AS "accruedAt"`,
    [
      params.bookingId,
      params.valueApprovalId,
      params.facilityId,
      computed.ruleId,
      computed.ruleScope,
      computed.appliedRate,
      params.approvedAmount,
      computed.commissionAmount,
      DEFAULT_VAT_RATE,
      computed.vatAmount,
      computed.totalWithVat,
      params.accrualDate,
    ],
  );

  const entry = res.rows[0]!;

  // Audit (A-46)
  await record(db, {
    action: AUDIT_ACTIONS.VALUE_APPROVED,
    entityType: 'commission_entry',
    entityId: entry.id,
    actorUserId: params.actorId,
    actorRole: params.actorRole,
    facilityId: params.facilityId,
    after: {
      ruleScope: computed.ruleScope,
      appliedRate: computed.appliedRate,
      collectedAmount: params.approvedAmount,
      commissionAmount: computed.commissionAmount,
      vatAmount: computed.vatAmount,
      totalWithVat: computed.totalWithVat,
    },
    reason: 'Commission computed on value approval (B-12)',
  });

  return ok(entry);
}
