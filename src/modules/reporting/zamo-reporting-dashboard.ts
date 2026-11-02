/**
 * ZAMO-RPT-074 — Zamo Executive Dashboard (لوحة قيادة زامو).
 *
 * Financial and analytical KPIs extending the operational dashboard (OPS-045).
 * Backed by the v_zamo_dashboard SQL view + application-layer top-N queries.
 *
 * The 12 KPIs:
 *   1.  Total collected revenue              (مالي)
 *   2.  Total commission due                  (مالي)
 *   3.  Total commission paid                 (مالي)
 *   4.  Collection rate                       (نسبة)
 *   5.  Total contribution margin             (مالي)
 *   6.  Top 5 facilities by revenue           (ترتيب)
 *   7.  Top 5 services by demand              (ترتيب)
 *   8.  Conversion rate (booking → service)   (نسبة)
 *   9.  Active campaigns count                (عداد)
 *   10. Customer acquisition cost (CAC)       (مالي)
 *   11. Average response time                 (زمن)
 *   12. SLA compliance rate                   (نسبة)
 *
 * Rules:
 *   ❗ Only zamo_admin and zamo_ops can access [IMPLEMENTATION_CHECKLIST]
 */

import type { RoleCode } from '../booking/state-machine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** KPIs from the v_zamo_dashboard view. */
export interface ZamoDashboardKpis {
  totalRevenue: number;                    // 1
  totalCommissionDue: number;              // 2
  totalCommissionPaid: number;             // 3
  collectionRate: number;                  // 4 (%)
  totalContributionMargin: number;         // 5
  conversionRate: number;                  // 8 (%)
  activeCampaigns: number;                 // 9
  customerAcquisitionCost: number | null;  // 10 (SAR)
  avgResponseMinutes: number | null;       // 11
  slaComplianceRate: number;               // 12 (%)
}

/** Top-N facility ranking. */
export interface TopFacility {
  facilityId: string;
  facilityName: string;
  totalRevenue: number;
}

/** Top-N service ranking. */
export interface TopService {
  serviceId: string;
  serviceName: string;
  bookingCount: number;
}

/** Full dashboard data. */
export interface ZamoExecutiveDashboard {
  kpis: ZamoDashboardKpis;
  topFacilities: TopFacility[];    // 6
  topServices: TopService[];        // 7
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * ❗ Only zamo_admin and zamo_ops can access the executive dashboard.
 */
const ZAMO_DASHBOARD_ROLES: readonly RoleCode[] = ['zamo_admin', 'zamo_ops'] as const;

export function canAccessZamoReportingDashboard(actorRole: RoleCode): boolean {
  return (ZAMO_DASHBOARD_ROLES as readonly string[]).includes(actorRole);
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

/**
 * Parse a v_zamo_dashboard row into ZamoDashboardKpis.
 */
export function parseZamoDashboardKpis(
  row: Record<string, string | undefined>,
): ZamoDashboardKpis {
  return {
    totalRevenue: parseFloat(row.total_revenue ?? '0') || 0,
    totalCommissionDue: parseFloat(row.total_commission_due ?? '0') || 0,
    totalCommissionPaid: parseFloat(row.total_commission_paid ?? '0') || 0,
    collectionRate: parseFloat(row.collection_rate ?? '0') || 0,
    totalContributionMargin: parseFloat(row.total_contribution_margin ?? '0') || 0,
    conversionRate: parseFloat(row.conversion_rate ?? '0') || 0,
    activeCampaigns: parseInt(row.active_campaigns ?? '0', 10) || 0,
    customerAcquisitionCost: row.customer_acquisition_cost
      ? parseFloat(row.customer_acquisition_cost) || null
      : null,
    avgResponseMinutes: row.avg_response_minutes
      ? parseFloat(row.avg_response_minutes) || null
      : null,
    slaComplianceRate: parseFloat(row.sla_compliance_rate ?? '0') || 0,
  };
}
