/**
 * M14 Reporting Module — Public API.
 *
 * Phase 9 — التقارير. Read-only reports and dashboards
 * for facility managers and Zamo administrators.
 */

// Facility Reports (ZAMO-RPT-073)
export {
  type FacilityReportType,
  type FacilityReportFilters,
  type ReportQueryContext,
  type ReportExportRequest,
  type ReportError,
  ALL_REPORT_TYPES,
  REPORT_NAMES,
  REPORT_VIEWS,
  canAccessFacilityReports,
  validateReportQuery,
  validateReportExport,
} from './facility-reports.js';

// Zamo Executive Dashboard (ZAMO-RPT-074)
export {
  type ZamoDashboardKpis,
  type TopFacility,
  type TopService,
  type ZamoExecutiveDashboard,
  canAccessZamoReportingDashboard,
  parseZamoDashboardKpis,
} from './zamo-reporting-dashboard.js';

// SLA Response Time Report (ZAMO-RPT-075)
export {
  type SlaResponseReport,
  type FacilitySlaAggregation,
  type SlaReportQuery,
  type SlaReportError,
  validateSlaReportQuery,
  parseSlaResponseRow,
  aggregateSlaReport,
} from './sla-response-report.js';

// Financial Reports (ZAMO-RPT-076)
export {
  type Discrepancy,
  type SettlementReconciliation,
  type FinancialReconciliationReport,
  type FinancialReportQuery,
  type FinancialReportError,
  validateFinancialReportQuery,
  findDiscrepancies,
  buildReconciliationReport,
  parseReconciliationRow,
} from './financial-reports.js';
