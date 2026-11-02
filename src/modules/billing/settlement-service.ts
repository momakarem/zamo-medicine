/**
 * ZAMO-BILL-065 — Settlement & Monthly Close Service.
 *
 * Manages the billing cycle (B-15):
 *   - Close at last day of calendar month (23:59 Asia/Riyadh).
 *   - Invoice within 5 business days.
 *   - Payment due in 30 days.
 *   - Objection within 7 business days.
 *
 * Key decisions enforced:
 *   B-15:  Monthly close cycle.
 *   DEC-019: Idempotent — running twice does not duplicate.
 */

import type { Queryable } from '../../db/client.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettlementError =
  | 'PERIOD_ALREADY_CLOSED'
  | 'NO_ENTRIES_FOUND'
  | 'INVALID_PERIOD'
  | 'DB_ERROR';

export interface BillingPeriod {
  id: string;
  periodKey: string;
  facilityId: string;
  startsAt: Date;
  endsAt: Date;
  status: 'OPEN' | 'CLOSED';
  closedAt: Date | null;
  closedBy: string | null;
}

export interface SettlementSummary {
  period: BillingPeriod;
  entryCount: number;
  totalCollected: string;
  totalCommission: string;
  totalVat: string;
  grandTotal: string;
}

// ---------------------------------------------------------------------------
// Period management
// ---------------------------------------------------------------------------

/**
 * Get or create a billing period for a facility and month.
 *
 * Idempotent (DEC-019): calling this multiple times returns the same period.
 */
export async function getOrCreatePeriod(
  db: Queryable,
  facilityId: string,
  periodKey: string, // e.g. '2026-09'
): Promise<Result<BillingPeriod, SettlementError>> {
  // Parse period key
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) {
    return err('INVALID_PERIOD');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  // Calculate period boundaries (Asia/Riyadh = UTC+3)
  const startsAt = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - 3 * 3600 * 1000);
  // Last moment of the last day of the month
  const endsAt = new Date(Date.UTC(year, month, 0, 23, 59, 59) - 3 * 3600 * 1000);

  // Upsert (idempotent)
  const res = await db.query<BillingPeriod>(
    `INSERT INTO billing_periods (period_key, facility_id, starts_at, ends_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (period_key, facility_id) DO UPDATE SET period_key = EXCLUDED.period_key
     RETURNING
       id, period_key AS "periodKey", facility_id AS "facilityId",
       starts_at AS "startsAt", ends_at AS "endsAt",
       status, closed_at AS "closedAt", closed_by AS "closedBy"`,
    [periodKey, facilityId, startsAt, endsAt],
  );

  return ok(res.rows[0]!);
}

/**
 * Close a billing period and assign all unsettled commission entries.
 *
 * Idempotent (DEC-019):
 *   - If already CLOSED, returns the existing summary without modification.
 *   - Commission entries already assigned to this period are not duplicated.
 *
 * B-15: Items approved after close go to next month's invoice.
 */
export async function closePeriod(
  db: Queryable,
  facilityId: string,
  periodKey: string,
  closedBy: string,
): Promise<Result<SettlementSummary, SettlementError>> {
  // 1. Get or create period
  const periodResult = await getOrCreatePeriod(db, facilityId, periodKey);
  if (!periodResult.ok) return periodResult;

  const period = periodResult.value;

  // 2. If already closed, return existing summary (idempotent)
  if (period.status === 'CLOSED') {
    return await getSummary(db, period);
  }

  // 3. Assign unsettled commission entries to this period
  //    Only entries accrued within the period's date range (B-15)
  await db.query(
    `UPDATE commission_entries
     SET billing_period_id = $1, settlement_period = $2
     WHERE facility_id = $3
       AND billing_period_id IS NULL
       AND accrued_at >= $4
       AND accrued_at <= $5`,
    [period.id, periodKey, facilityId, period.startsAt, period.endsAt],
  );

  // 4. Close the period
  await db.query(
    `UPDATE billing_periods
     SET status = 'CLOSED', closed_at = now(), closed_by = $1
     WHERE id = $2`,
    [closedBy, period.id],
  );

  // 5. Refresh period data
  const refreshed = await db.query<BillingPeriod>(
    `SELECT
       id, period_key AS "periodKey", facility_id AS "facilityId",
       starts_at AS "startsAt", ends_at AS "endsAt",
       status, closed_at AS "closedAt", closed_by AS "closedBy"
     FROM billing_periods WHERE id = $1`,
    [period.id],
  );

  return await getSummary(db, refreshed.rows[0]!);
}

/**
 * Get settlement summary for a billing period.
 */
async function getSummary(
  db: Queryable,
  period: BillingPeriod,
): Promise<Result<SettlementSummary, SettlementError>> {
  const res = await db.query<{
    entry_count: string;
    total_collected: string;
    total_commission: string;
    total_vat: string;
    grand_total: string;
  }>(
    `SELECT
       COUNT(*)::text AS entry_count,
       COALESCE(SUM(collected_amount), 0)::text AS total_collected,
       COALESCE(SUM(commission_amount), 0)::text AS total_commission,
       COALESCE(SUM(vat_amount), 0)::text AS total_vat,
       COALESCE(SUM(total_with_vat), 0)::text AS grand_total
     FROM commission_entries
     WHERE billing_period_id = $1`,
    [period.id],
  );

  const row = res.rows[0]!;
  return ok({
    period,
    entryCount: Number(row.entry_count),
    totalCollected: row.total_collected,
    totalCommission: row.total_commission,
    totalVat: row.total_vat,
    grandTotal: row.grand_total,
  });
}
