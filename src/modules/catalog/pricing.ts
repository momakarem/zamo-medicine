import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';

/**
 * ZAMO-CAT-016 — historical pricing service.
 *
 * [S1]: "تاريخ بدء/انتهاء السعر + سجل التعديلات + اسم المستخدم المعدّل"
 * DEC (ARCHITECTURE §8.2): "السعر جدول تاريخي منفصل، لا حقل في Service"
 *
 * Prices are APPEND-ONLY: a new row closes the previous one.
 * Approval workflow: facility_manager only (A-table §6.3).
 * All price operations are FINANCIAL actions → Audit required.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PricingError =
  | 'PRICE_NOT_FOUND'
  | 'BRANCH_SERVICE_NOT_FOUND'
  | 'ALREADY_APPROVED'
  | 'ALREADY_REJECTED'
  | 'INVALID_PRICE_TYPE'
  | 'REASON_REQUIRED';

export type PriceType = 'fixed' | 'starting_from' | 'range';

export interface PriceInput {
  branchServiceId: string;
  priceType: PriceType;
  amount: string;       // String to preserve numeric precision
  amountMax?: string;    // Required for 'range'
  currency?: string;
}

export interface PriceRow {
  id: string;
  branch_service_id: string;
  price_type: PriceType;
  amount: string;
  amount_max: string | null;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_by: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface PricingService {
  proposePrice(input: PriceInput, createdBy: string, facilityId: string): Promise<Result<string, PricingError>>;
  approvePrice(priceId: string, approvedBy: string, facilityId: string): Promise<Result<void, PricingError>>;
  rejectPrice(priceId: string, rejectedBy: string, reason: string, facilityId: string): Promise<Result<void, PricingError>>;
  getCurrentPrice(branchServiceId: string): Promise<Result<PriceRow, PricingError>>;
  getPriceHistory(branchServiceId: string): Promise<PriceRow[]>;
}

export function createPricingService(db: Queryable): PricingService {
  return {
    async proposePrice(input, createdBy, facilityId) {
      if (input.priceType === 'range' && !input.amountMax) {
        return err('INVALID_PRICE_TYPE');
      }

      const res = await db.query<{ id: string }>(
        `INSERT INTO prices
           (branch_service_id, price_type, amount, amount_max, currency, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          input.branchServiceId, input.priceType,
          input.amount, input.amountMax ?? null,
          input.currency ?? 'SAR', createdBy,
        ],
      );
      const priceId = res.rows[0]!.id;

      await record(db, {
        action: AUDIT_ACTIONS.PRICE_CHANGED,
        entityType: 'price',
        entityId: priceId,
        actorUserId: createdBy,
        facilityId,
        after: { priceType: input.priceType, amount: input.amount, amountMax: input.amountMax },
        reason: 'New price proposed',
      });

      return ok(priceId);
    },

    async approvePrice(priceId, approvedBy, facilityId) {
      const priceRes = await db.query<PriceRow>(
        `SELECT * FROM prices WHERE id = $1`,
        [priceId],
      );
      if (priceRes.rows.length === 0) return err('PRICE_NOT_FOUND');

      const price = priceRes.rows[0]!;
      if (price.status === 'approved') return err('ALREADY_APPROVED');
      if (price.status === 'rejected') return err('ALREADY_REJECTED');

      // Close the currently active price for this branch_service
      await db.query(
        `UPDATE prices SET effective_to = now()
         WHERE branch_service_id = $1 AND status = 'approved' AND effective_to IS NULL AND id != $2`,
        [price.branch_service_id, priceId],
      );

      // Approve the new price
      await db.query(
        `UPDATE prices SET status = 'approved', approved_by = $1, approved_at = now()
         WHERE id = $2`,
        [approvedBy, priceId],
      );

      await record(db, {
        action: AUDIT_ACTIONS.PRICE_APPROVED,
        entityType: 'price',
        entityId: priceId,
        actorUserId: approvedBy,
        facilityId,
        before: { status: 'pending_approval' },
        after: { status: 'approved' },
        reason: 'Price approved by facility manager',
      });

      return ok(undefined);
    },

    async rejectPrice(priceId, rejectedBy, reason, facilityId) {
      if (!reason || reason.trim() === '') return err('REASON_REQUIRED');

      const priceRes = await db.query<PriceRow>(
        `SELECT * FROM prices WHERE id = $1`,
        [priceId],
      );
      if (priceRes.rows.length === 0) return err('PRICE_NOT_FOUND');

      const price = priceRes.rows[0]!;
      if (price.status === 'approved') return err('ALREADY_APPROVED');
      if (price.status === 'rejected') return err('ALREADY_REJECTED');

      await db.query(
        `UPDATE prices SET status = 'rejected', approved_by = $1, approved_at = now(), rejection_reason = $2
         WHERE id = $3`,
        [rejectedBy, reason, priceId],
      );

      await record(db, {
        action: AUDIT_ACTIONS.PRICE_CHANGED,
        entityType: 'price',
        entityId: priceId,
        actorUserId: rejectedBy,
        facilityId,
        before: { status: 'pending_approval' },
        after: { status: 'rejected', rejection_reason: reason },
        reason,
      });

      return ok(undefined);
    },

    async getCurrentPrice(branchServiceId) {
      const res = await db.query<PriceRow>(
        `SELECT * FROM prices
         WHERE branch_service_id = $1 AND status = 'approved' AND effective_to IS NULL
         ORDER BY effective_from DESC
         LIMIT 1`,
        [branchServiceId],
      );
      if (res.rows.length === 0) return err('PRICE_NOT_FOUND');
      return ok(res.rows[0]!);
    },

    async getPriceHistory(branchServiceId) {
      const res = await db.query<PriceRow>(
        `SELECT * FROM prices
         WHERE branch_service_id = $1
         ORDER BY created_at DESC`,
        [branchServiceId],
      );
      return res.rows;
    },
  };
}
