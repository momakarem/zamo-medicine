/**
 * ZAMO-RPT-076 — Financial Reports (التقارير المالية).
 *
 * Financial reconciliation between commission entries, invoices,
 * and settlements. Backed by v_financial_reconciliation view.
 *
 * Rules:
 *   ❗ Commission report must match invoices
 *   ❗ Totals must match settlement records
 */

import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';
import type { RoleCode } from '../booking/state-machine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A discrepancy found during reconciliation. */
export interface Discrepancy {
  settlementId: string;
  type: 'count_mismatch' | 'amount_mismatch';
  expected: number;
  actual: number;
  difference: number;
  description: string;
}

/** Single settlement reconciliation record. */
export interface SettlementReconciliation {
  settlementId: string;
  facilityId: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  settlementStatus: string;

  // Commission side
  commissionEntryCount: number;
  commissionTotalNet: number;
  commissionTotalVat: number;
  commissionTotalGross: number;

  // Invoice side
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceLineCount: number;
  invoiceSubtotal: number;
  invoiceVat: number;
  invoiceTotal: number;

  // Payment side
  totalPaid: number;

  // ❗ Reconciliation checks
  entriesMatchInvoice: boolean | null;
  amountsMatch: boolean | null;
}

/** Full financial reconciliation report. */
export interface FinancialReconciliationReport {
  facilityId: string;
  period: { from: Date; to: Date };
  settlements: SettlementReconciliation[];
  discrepancies: Discrepancy[];
  isFullyReconciled: boolean;
}

export interface FinancialReportQuery {
  facilityId: string;
  dateFrom?: Date;
  dateTo?: Date;
  actorId: string;
  actorRole: RoleCode;
  actorFacilityId: string | null;
}

export type FinancialReportError =
  | 'NOT_AUTHORIZED'
  | 'FACILITY_MISMATCH'
  | 'INVALID_DATE_RANGE';

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/** Roles that can access financial reports. */
const FINANCIAL_REPORT_ROLES: readonly RoleCode[] = [
  'facility_manager',
  'zamo_admin',
  'zamo_ops',
] as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate financial report query.
 */
export function validateFinancialReportQuery(
  query: FinancialReportQuery,
): Result<{ facilityId: string }, FinancialReportError> {
  if (!(FINANCIAL_REPORT_ROLES as readonly string[]).includes(query.actorRole)) {
    return err('NOT_AUTHORIZED');
  }

  // ❗ Facility scope enforcement
  if (query.actorRole === 'facility_manager') {
    if (query.actorFacilityId !== query.facilityId) {
      return err('FACILITY_MISMATCH');
    }
  }

  if (query.dateFrom && query.dateTo && query.dateTo < query.dateFrom) {
    return err('INVALID_DATE_RANGE');
  }

  return ok({ facilityId: query.facilityId });
}

// ---------------------------------------------------------------------------
// Reconciliation logic
// ---------------------------------------------------------------------------

/**
 * ❗ Find discrepancies between commission entries and invoices.
 *
 * Checks:
 *   1. Entry count matches invoice line count
 *   2. Gross amount matches invoice total (within 0.01 SAR)
 */
export function findDiscrepancies(
  settlements: SettlementReconciliation[],
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  for (const s of settlements) {
    // Skip settlements without invoices (not yet invoiced)
    if (!s.invoiceId) continue;

    // ❗ Check 1: entry count vs invoice line count
    if (s.entriesMatchInvoice === false) {
      discrepancies.push({
        settlementId: s.settlementId,
        type: 'count_mismatch',
        expected: s.commissionEntryCount,
        actual: s.invoiceLineCount,
        difference: s.commissionEntryCount - s.invoiceLineCount,
        description: `Settlement ${s.periodLabel}: commission entries (${s.commissionEntryCount}) ≠ invoice lines (${s.invoiceLineCount})`,
      });
    }

    // ❗ Check 2: gross amount vs invoice total
    if (s.amountsMatch === false) {
      discrepancies.push({
        settlementId: s.settlementId,
        type: 'amount_mismatch',
        expected: s.commissionTotalGross,
        actual: s.invoiceTotal,
        difference: Math.round((s.commissionTotalGross - s.invoiceTotal) * 100) / 100,
        description: `Settlement ${s.periodLabel}: commission gross (${s.commissionTotalGross}) ≠ invoice total (${s.invoiceTotal})`,
      });
    }
  }

  return discrepancies;
}

/**
 * Build a full reconciliation report from parsed settlement rows.
 */
export function buildReconciliationReport(
  settlements: SettlementReconciliation[],
  facilityId: string,
  period: { from: Date; to: Date },
): FinancialReconciliationReport {
  const discrepancies = findDiscrepancies(settlements);

  return {
    facilityId,
    period,
    settlements,
    discrepancies,
    isFullyReconciled: discrepancies.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

/**
 * Parse a v_financial_reconciliation row.
 */
export function parseReconciliationRow(
  row: Record<string, string | undefined>,
): SettlementReconciliation {
  return {
    settlementId: row.settlement_id ?? '',
    facilityId: row.facility_id ?? '',
    periodLabel: row.period_label ?? '',
    periodStart: new Date(row.period_start ?? Date.now()),
    periodEnd: new Date(row.period_end ?? Date.now()),
    settlementStatus: row.settlement_status ?? '',

    commissionEntryCount: parseInt(row.commission_entry_count ?? '0', 10) || 0,
    commissionTotalNet: parseFloat(row.commission_total_net ?? '0') || 0,
    commissionTotalVat: parseFloat(row.commission_total_vat ?? '0') || 0,
    commissionTotalGross: parseFloat(row.commission_total_gross ?? '0') || 0,

    invoiceId: row.invoice_id ?? null,
    invoiceNumber: row.invoice_number ?? null,
    invoiceStatus: row.invoice_status ?? null,
    invoiceLineCount: parseInt(row.invoice_line_count ?? '0', 10) || 0,
    invoiceSubtotal: parseFloat(row.invoice_subtotal ?? '0') || 0,
    invoiceVat: parseFloat(row.invoice_vat ?? '0') || 0,
    invoiceTotal: parseFloat(row.invoice_total ?? '0') || 0,

    totalPaid: parseFloat(row.total_paid ?? '0') || 0,

    entriesMatchInvoice: row.entries_match_invoice === 'true' ? true
      : row.entries_match_invoice === 'false' ? false : null,
    amountsMatch: row.amounts_match === 'true' ? true
      : row.amounts_match === 'false' ? false : null,
  };
}
