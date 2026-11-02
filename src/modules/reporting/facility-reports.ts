/**
 * ZAMO-RPT-073 — Facility Reports (تقارير المنشأة — 11 تقرير).
 *
 * Read-only reports for facility_manager, backed by SQL views.
 * M14 Reporting is a **read-only module** (ARCHITECTURE.md §4).
 *
 * The 11 facility reports derived from [S1]:
 *   1.  Bookings          — الحجوزات (by period, branch, status, doctor)
 *   2.  Attendance         — الحضور (by period, branch, doctor)
 *   3.  Services Performed — الخدمات المنفذة (by period, branch, specialty)
 *   4.  Revenue            — الإيراد والتحصيل (by period, branch, service)
 *   5.  Commission         — العمولات (by period, settlement status)
 *   6.  Doctor Performance — أداء الأطباء (by period, branch)
 *   7.  Branch Comparison  — مقارنة الفروع (by period)
 *   8.  Cancellations      — الإلغاءات والرفض (by period, reason)
 *   9.  SLA Compliance     — الالتزام بالـSLA (by period, branch)
 *   10. Offer Performance  — أداء العروض (by period, status)
 *   11. Campaigns          — الحملات الإعلانية (by period, platform)
 *
 * Rules:
 *   ❗ Reports are SCOPED to the user's facility (enforced by RLS + app layer)
 *   ❗ Export is recorded in Audit log
 *   All reports support date range + branch filters
 */

import type { RoleCode } from '../booking/state-machine.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FacilityReportType =
  | 'bookings'
  | 'attendance'
  | 'services'
  | 'revenue'
  | 'commission'
  | 'doctors'
  | 'branches'
  | 'cancellations'
  | 'sla'
  | 'offers'
  | 'campaigns';

/** All 11 report types. */
export const ALL_REPORT_TYPES: readonly FacilityReportType[] = [
  'bookings', 'attendance', 'services', 'revenue', 'commission',
  'doctors', 'branches', 'cancellations', 'sla', 'offers', 'campaigns',
] as const;

/** Report name mapping (for display/export headers). */
export const REPORT_NAMES: Record<FacilityReportType, { ar: string; en: string }> = {
  bookings:      { ar: 'تقرير الحجوزات',          en: 'Bookings Report' },
  attendance:    { ar: 'تقرير الحضور',             en: 'Attendance Report' },
  services:      { ar: 'تقرير الخدمات المنفذة',    en: 'Services Report' },
  revenue:       { ar: 'تقرير الإيراد والتحصيل',   en: 'Revenue Report' },
  commission:    { ar: 'تقرير العمولات',            en: 'Commission Report' },
  doctors:       { ar: 'تقرير أداء الأطباء',       en: 'Doctor Performance Report' },
  branches:      { ar: 'تقرير مقارنة الفروع',      en: 'Branch Comparison Report' },
  cancellations: { ar: 'تقرير الإلغاءات والرفض',   en: 'Cancellations Report' },
  sla:           { ar: 'تقرير الالتزام بالـSLA',    en: 'SLA Compliance Report' },
  offers:        { ar: 'تقرير أداء العروض',         en: 'Offers Report' },
  campaigns:     { ar: 'تقرير الحملات الإعلانية',   en: 'Campaigns Report' },
};

/** SQL view backing each report type. */
export const REPORT_VIEWS: Record<FacilityReportType, string> = {
  bookings:      'v_facility_bookings_report',
  attendance:    'v_facility_attendance_report',
  services:      'v_facility_services_report',
  revenue:       'v_facility_revenue_report',
  commission:    'v_facility_commission_report',
  doctors:       'v_facility_doctors_report',
  branches:      'v_facility_branches_report',
  cancellations: 'v_facility_cancellations_report',
  sla:           'v_facility_sla_report',
  offers:        'v_facility_offers_report',
  campaigns:     'v_facility_campaigns_report',
};

/** Common filter parameters for facility reports. */
export interface FacilityReportFilters {
  facilityId: string;
  dateFrom?: Date;
  dateTo?: Date;
  branchId?: string;
}

/** Report query context including actor info. */
export interface ReportQueryContext {
  reportType: FacilityReportType;
  filters: FacilityReportFilters;
  actorId: string;
  actorRole: RoleCode;
  actorFacilityId: string | null;
}

/** Export request for audit logging. */
export interface ReportExportRequest {
  reportType: FacilityReportType;
  facilityId: string;
  format: 'csv' | 'pdf';
  actorId: string;
  actorRole: RoleCode;
}

export type ReportError =
  | 'NOT_AUTHORIZED'
  | 'FACILITY_MISMATCH'
  | 'INVALID_REPORT_TYPE'
  | 'INVALID_DATE_RANGE';

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * Roles that can access facility reports.
 */
const FACILITY_REPORT_ROLES: readonly RoleCode[] = [
  'facility_manager',
  'zamo_admin',
  'zamo_ops',
] as const;

/**
 * ❗ Validate that the actor can access reports for this facility.
 *
 * facility_manager sees ONLY their own facility's data.
 * zamo_admin/zamo_ops can see any facility.
 */
export function canAccessFacilityReports(
  actorRole: RoleCode,
  actorFacilityId: string | null,
  requestedFacilityId: string,
): boolean {
  if (!(FACILITY_REPORT_ROLES as readonly string[]).includes(actorRole)) {
    return false;
  }

  // zamo roles can see any facility
  if (actorRole === 'zamo_admin' || actorRole === 'zamo_ops') {
    return true;
  }

  // ❗ facility_manager must match
  return actorFacilityId === requestedFacilityId;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a report query request.
 */
export function validateReportQuery(
  ctx: ReportQueryContext,
): Result<{ viewName: string; facilityId: string }, ReportError> {
  // 1. Valid report type
  if (!ALL_REPORT_TYPES.includes(ctx.reportType)) {
    return err('INVALID_REPORT_TYPE');
  }

  // 2. Role authorization
  if (!(FACILITY_REPORT_ROLES as readonly string[]).includes(ctx.actorRole)) {
    return err('NOT_AUTHORIZED');
  }

  // 3. ❗ Facility scope enforcement
  if (!canAccessFacilityReports(ctx.actorRole, ctx.actorFacilityId, ctx.filters.facilityId)) {
    return err('FACILITY_MISMATCH');
  }

  // 4. Date range validation
  if (ctx.filters.dateFrom && ctx.filters.dateTo && ctx.filters.dateTo < ctx.filters.dateFrom) {
    return err('INVALID_DATE_RANGE');
  }

  return ok({
    viewName: REPORT_VIEWS[ctx.reportType],
    facilityId: ctx.filters.facilityId,
  });
}

/**
 * Validate a report export request (for Audit logging).
 */
export function validateReportExport(
  req: ReportExportRequest,
): Result<{ reportName: string; auditAction: string }, ReportError> {
  if (!ALL_REPORT_TYPES.includes(req.reportType)) {
    return err('INVALID_REPORT_TYPE');
  }

  if (!(FACILITY_REPORT_ROLES as readonly string[]).includes(req.actorRole)) {
    return err('NOT_AUTHORIZED');
  }

  const reportName = REPORT_NAMES[req.reportType].en;

  return ok({
    reportName,
    auditAction: `REPORT_EXPORTED:${req.reportType}:${req.format}`,
  });
}
