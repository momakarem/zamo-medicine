/**
 * ZAMO-RPT-075 — SLA Response Time Report (تقرير سرعة الاستجابة ❗).
 *
 * > مرتبط بالخطر رقم 1 المعلن في [S2]:
 * > «أكثر المخاطر ليست شكل الواجهة، بل التزام العيادة بسرعة التأكيد
 * >   وإثبات الخدمة والمبلغ النهائي.»
 *
 * Per-facility response time analytics backed by v_sla_response_time view.
 *
 * Metrics:
 *   - Average confirmation time per facility
 *   - Median and p95 confirmation time
 *   - SLA compliance rate
 *   - Rejection rate (uses REJECTED state per B-07)
 *
 * Dependencies: Phase 7 (SLA monitor + sla_deadline + is_late flag)
 */

import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';
import type { RoleCode } from '../booking/state-machine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-facility SLA response time report row. */
export interface SlaResponseReport {
  facilityId: string;
  reportDate: Date;

  // Response time metrics
  avgConfirmationMinutes: number | null;
  medianConfirmationMinutes: number | null;
  p95ConfirmationMinutes: number | null;

  // SLA compliance
  totalWithSla: number;
  confirmedWithinSla: number;
  lateConfirmations: number;
  slaComplianceRate: number;

  // Rejection
  totalBookings: number;
  rejectedCount: number;
  rejectionRate: number;
}

/** Aggregated facility SLA summary (over a date range). */
export interface FacilitySlaAggregation {
  facilityId: string;
  period: { from: Date; to: Date };

  avgConfirmationMinutes: number | null;
  slaComplianceRate: number;
  rejectionRate: number;

  totalBookings: number;
  confirmedWithinSla: number;
  lateConfirmations: number;
  rejectedCount: number;
}

export interface SlaReportQuery {
  facilityId?: string;  // null = all facilities (zamo_admin)
  dateFrom: Date;
  dateTo: Date;
  actorId: string;
  actorRole: RoleCode;
  actorFacilityId: string | null;
}

export type SlaReportError =
  | 'NOT_AUTHORIZED'
  | 'FACILITY_MISMATCH'
  | 'INVALID_DATE_RANGE';

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/** Roles that can access SLA reports. */
const SLA_REPORT_ROLES: readonly RoleCode[] = [
  'facility_manager',
  'zamo_admin',
  'zamo_ops',
] as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * ❗ Validate SLA report query.
 *
 * facility_manager sees only their own facility.
 * zamo_admin/zamo_ops can see all or a specific facility.
 */
export function validateSlaReportQuery(
  query: SlaReportQuery,
): Result<{ facilityId: string | null }, SlaReportError> {
  // Role check
  if (!(SLA_REPORT_ROLES as readonly string[]).includes(query.actorRole)) {
    return err('NOT_AUTHORIZED');
  }

  // Date range
  if (query.dateTo < query.dateFrom) {
    return err('INVALID_DATE_RANGE');
  }

  // Facility scope
  if (query.actorRole === 'facility_manager') {
    // Must specify own facility or defaults to own facility
    const targetFacility = query.facilityId ?? query.actorFacilityId;
    if (targetFacility !== query.actorFacilityId) {
      return err('FACILITY_MISMATCH');
    }
    return ok({ facilityId: targetFacility });
  }

  // zamo_admin/zamo_ops — can query any or all
  return ok({ facilityId: query.facilityId ?? null });
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

/**
 * Parse a v_sla_response_time row into SlaResponseReport.
 */
export function parseSlaResponseRow(
  row: Record<string, string | undefined>,
): SlaResponseReport {
  return {
    facilityId: row.facility_id ?? '',
    reportDate: new Date(row.report_date ?? Date.now()),
    avgConfirmationMinutes: row.avg_confirmation_minutes
      ? parseFloat(row.avg_confirmation_minutes)
      : null,
    medianConfirmationMinutes: row.median_confirmation_minutes
      ? parseFloat(row.median_confirmation_minutes)
      : null,
    p95ConfirmationMinutes: row.p95_confirmation_minutes
      ? parseFloat(row.p95_confirmation_minutes)
      : null,
    totalWithSla: parseInt(row.total_with_sla ?? '0', 10) || 0,
    confirmedWithinSla: parseInt(row.confirmed_within_sla ?? '0', 10) || 0,
    lateConfirmations: parseInt(row.late_confirmations ?? '0', 10) || 0,
    slaComplianceRate: parseFloat(row.sla_compliance_rate ?? '0') || 0,
    totalBookings: parseInt(row.total_bookings ?? '0', 10) || 0,
    rejectedCount: parseInt(row.rejected_count ?? '0', 10) || 0,
    rejectionRate: parseFloat(row.rejection_rate ?? '0') || 0,
  };
}

/**
 * Aggregate multiple daily SLA rows into a period summary.
 */
export function aggregateSlaReport(
  rows: SlaResponseReport[],
  facilityId: string,
  period: { from: Date; to: Date },
): FacilitySlaAggregation {
  if (rows.length === 0) {
    return {
      facilityId,
      period,
      avgConfirmationMinutes: null,
      slaComplianceRate: 0,
      rejectionRate: 0,
      totalBookings: 0,
      confirmedWithinSla: 0,
      lateConfirmations: 0,
      rejectedCount: 0,
    };
  }

  const totals = rows.reduce(
    (acc, r) => ({
      totalBookings: acc.totalBookings + r.totalBookings,
      totalWithSla: acc.totalWithSla + r.totalWithSla,
      confirmedWithinSla: acc.confirmedWithinSla + r.confirmedWithinSla,
      lateConfirmations: acc.lateConfirmations + r.lateConfirmations,
      rejectedCount: acc.rejectedCount + r.rejectedCount,
      sumMinutes: acc.sumMinutes + (r.avgConfirmationMinutes ?? 0) * r.totalWithSla,
      minutesDenominator: acc.minutesDenominator + (r.avgConfirmationMinutes !== null ? r.totalWithSla : 0),
    }),
    {
      totalBookings: 0,
      totalWithSla: 0,
      confirmedWithinSla: 0,
      lateConfirmations: 0,
      rejectedCount: 0,
      sumMinutes: 0,
      minutesDenominator: 0,
    },
  );

  return {
    facilityId,
    period,
    avgConfirmationMinutes: totals.minutesDenominator > 0
      ? Math.round((totals.sumMinutes / totals.minutesDenominator) * 10) / 10
      : null,
    slaComplianceRate: totals.totalWithSla > 0
      ? Math.round((100 * totals.confirmedWithinSla / totals.totalWithSla) * 10) / 10
      : 0,
    rejectionRate: totals.totalBookings > 0
      ? Math.round((100 * totals.rejectedCount / totals.totalBookings) * 10) / 10
      : 0,
    totalBookings: totals.totalBookings,
    confirmedWithinSla: totals.confirmedWithinSla,
    lateConfirmations: totals.lateConfirmations,
    rejectedCount: totals.rejectedCount,
  };
}
