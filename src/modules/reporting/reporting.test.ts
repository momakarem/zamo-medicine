/**
 * ZAMO-RPT-073..076 — Reporting Module Unit Tests.
 *
 * Tests for facility reports, Zamo dashboard, SLA response time,
 * and financial reconciliation.
 *
 * Covers IMPLEMENTATION_CHECKLIST.md Phase 9 — Reporting:
 *   RPT-073: Facility reports (3 tests)
 *   RPT-074: Zamo dashboard (2 tests)
 *   RPT-075: SLA response time (3 tests)
 *   RPT-076: Financial reports (2 tests)
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_REPORT_TYPES,
  REPORT_NAMES,
  REPORT_VIEWS,
  canAccessFacilityReports,
  validateReportQuery,
  validateReportExport,
} from './facility-reports.js';
import {
  canAccessZamoReportingDashboard,
  parseZamoDashboardKpis,
} from './zamo-reporting-dashboard.js';
import {
  validateSlaReportQuery,
  aggregateSlaReport,
} from './sla-response-report.js';
import type { SlaResponseReport } from './sla-response-report.js';
import {
  validateFinancialReportQuery,
  findDiscrepancies,
  buildReconciliationReport,
} from './financial-reports.js';
import type { SettlementReconciliation } from './financial-reports.js';
import type { RoleCode } from '../booking/state-machine.js';

// ═══════════════════════════════════════════════════════════════════════════
// RPT-073 — Facility Reports
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-RPT-073 · Facility Reports', () => {
  // --- Test 1: كل تقرير يعطي أرقامًا صحيحة (11 تقرير) ---

  it('defines all 11 facility report types with correct views and names', () => {
    expect(ALL_REPORT_TYPES).toHaveLength(11);

    // Each report type has a view and bilingual name
    for (const type of ALL_REPORT_TYPES) {
      expect(REPORT_VIEWS[type]).toBeDefined();
      expect(REPORT_VIEWS[type]).toMatch(/^v_facility_/);
      expect(REPORT_NAMES[type].ar).toBeTruthy();
      expect(REPORT_NAMES[type].en).toBeTruthy();
    }
  });

  // --- Test 2: ❗ التقرير محصور بنطاق المستخدم ---

  it('restricts facility_manager to their own facility only', () => {
    // facility_manager accessing own facility → allowed
    expect(canAccessFacilityReports(
      'facility_manager' as RoleCode,
      'fac-001',
      'fac-001',
    )).toBe(true);

    // facility_manager accessing another facility → denied
    expect(canAccessFacilityReports(
      'facility_manager' as RoleCode,
      'fac-001',
      'fac-002',
    )).toBe(false);

    // zamo_admin can access any facility
    expect(canAccessFacilityReports(
      'zamo_admin' as RoleCode,
      null,
      'fac-002',
    )).toBe(true);

    // receptionist cannot access reports
    expect(canAccessFacilityReports(
      'receptionist' as RoleCode,
      'fac-001',
      'fac-001',
    )).toBe(false);

    // doctor cannot access reports
    expect(canAccessFacilityReports(
      'doctor' as RoleCode,
      'fac-001',
      'fac-001',
    )).toBe(false);
  });

  it('validates report query — rejects facility mismatch', () => {
    const result = validateReportQuery({
      reportType: 'bookings',
      filters: { facilityId: 'fac-002' },
      actorId: 'user-001',
      actorRole: 'facility_manager' as RoleCode,
      actorFacilityId: 'fac-001',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('FACILITY_MISMATCH');
  });

  it('validates report query — accepts valid request', () => {
    const result = validateReportQuery({
      reportType: 'revenue',
      filters: { facilityId: 'fac-001' },
      actorId: 'user-001',
      actorRole: 'facility_manager' as RoleCode,
      actorFacilityId: 'fac-001',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.viewName).toBe('v_facility_revenue_report');
      expect(result.value.facilityId).toBe('fac-001');
    }
  });

  // --- Test 3: التصدير مسجّل في Audit ---

  it('validates report export — produces audit action', () => {
    const result = validateReportExport({
      reportType: 'commission',
      facilityId: 'fac-001',
      format: 'csv',
      actorId: 'user-001',
      actorRole: 'facility_manager' as RoleCode,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.auditAction).toBe('REPORT_EXPORTED:commission:csv');
      expect(result.value.reportName).toBe('Commission Report');
    }
  });

  it('rejects export by unauthorized role', () => {
    const result = validateReportExport({
      reportType: 'revenue',
      facilityId: 'fac-001',
      format: 'pdf',
      actorId: 'user-001',
      actorRole: 'receptionist' as RoleCode,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('NOT_AUTHORIZED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RPT-074 — Zamo Dashboard
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-RPT-074 · Zamo Executive Dashboard', () => {
  // --- Test 4: المؤشرات الـ12 صحيحة ---

  it('parses all 12 KPIs correctly from SQL row', () => {
    const row = {
      total_revenue: '150000.00',
      total_commission_due: '15000.00',
      total_commission_paid: '12000.00',
      collection_rate: '85.5',
      total_contribution_margin: '130000.00',
      conversion_rate: '72.3',
      active_campaigns: '5',
      customer_acquisition_cost: '250.00',
      avg_response_minutes: '18.5',
      sla_compliance_rate: '92.1',
    };

    const kpis = parseZamoDashboardKpis(row);

    expect(kpis.totalRevenue).toBe(150000);           // 1
    expect(kpis.totalCommissionDue).toBe(15000);      // 2
    expect(kpis.totalCommissionPaid).toBe(12000);     // 3
    expect(kpis.collectionRate).toBe(85.5);           // 4
    expect(kpis.totalContributionMargin).toBe(130000);// 5
    expect(kpis.conversionRate).toBe(72.3);           // 8
    expect(kpis.activeCampaigns).toBe(5);             // 9
    expect(kpis.customerAcquisitionCost).toBe(250);   // 10
    expect(kpis.avgResponseMinutes).toBe(18.5);       // 11
    expect(kpis.slaComplianceRate).toBe(92.1);        // 12
  });

  // --- Test 5: ❗ مدير زامو فقط يصل إليها ---

  it('restricts dashboard access to zamo_admin and zamo_ops only', () => {
    expect(canAccessZamoReportingDashboard('zamo_admin' as RoleCode)).toBe(true);
    expect(canAccessZamoReportingDashboard('zamo_ops' as RoleCode)).toBe(true);

    // All other roles denied
    expect(canAccessZamoReportingDashboard('facility_manager' as RoleCode)).toBe(false);
    expect(canAccessZamoReportingDashboard('branch_manager' as RoleCode)).toBe(false);
    expect(canAccessZamoReportingDashboard('receptionist' as RoleCode)).toBe(false);
    expect(canAccessZamoReportingDashboard('doctor' as RoleCode)).toBe(false);
    expect(canAccessZamoReportingDashboard('patient' as RoleCode)).toBe(false);
  });

  it('handles missing/null KPIs gracefully', () => {
    const emptyRow = {};
    const kpis = parseZamoDashboardKpis(emptyRow);

    expect(kpis.totalRevenue).toBe(0);
    expect(kpis.customerAcquisitionCost).toBeNull();
    expect(kpis.avgResponseMinutes).toBeNull();
    expect(kpis.activeCampaigns).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RPT-075 — SLA Response Time Report
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-RPT-075 · SLA Response Time Report', () => {
  // --- Test 6: متوسط زمن التأكيد لكل منشأة ---

  it('aggregates average confirmation time per facility', () => {
    const rows: SlaResponseReport[] = [
      {
        facilityId: 'fac-001',
        reportDate: new Date('2026-09-01'),
        avgConfirmationMinutes: 15,
        medianConfirmationMinutes: 12,
        p95ConfirmationMinutes: 30,
        totalWithSla: 20,
        confirmedWithinSla: 18,
        lateConfirmations: 2,
        slaComplianceRate: 90,
        totalBookings: 25,
        rejectedCount: 1,
        rejectionRate: 4,
      },
      {
        facilityId: 'fac-001',
        reportDate: new Date('2026-09-02'),
        avgConfirmationMinutes: 20,
        medianConfirmationMinutes: 18,
        p95ConfirmationMinutes: 35,
        totalWithSla: 10,
        confirmedWithinSla: 8,
        lateConfirmations: 2,
        slaComplianceRate: 80,
        totalBookings: 12,
        rejectedCount: 0,
        rejectionRate: 0,
      },
    ];

    const agg = aggregateSlaReport(
      rows,
      'fac-001',
      { from: new Date('2026-09-01'), to: new Date('2026-09-02') },
    );

    expect(agg.facilityId).toBe('fac-001');
    expect(agg.totalBookings).toBe(37);

    // Weighted avg: (15*20 + 20*10) / (20+10) = 500/30 ≈ 16.7
    expect(agg.avgConfirmationMinutes).toBeCloseTo(16.7, 1);
  });

  // --- Test 7: نسبة الالتزام بالـSLA ---

  it('calculates SLA compliance rate correctly', () => {
    const rows: SlaResponseReport[] = [
      {
        facilityId: 'fac-002',
        reportDate: new Date('2026-09-01'),
        avgConfirmationMinutes: 10,
        medianConfirmationMinutes: 8,
        p95ConfirmationMinutes: 20,
        totalWithSla: 50,
        confirmedWithinSla: 45,
        lateConfirmations: 5,
        slaComplianceRate: 90,
        totalBookings: 55,
        rejectedCount: 2,
        rejectionRate: 3.6,
      },
    ];

    const agg = aggregateSlaReport(
      rows,
      'fac-002',
      { from: new Date('2026-09-01'), to: new Date('2026-09-01') },
    );

    // 45/50 = 90%
    expect(agg.slaComplianceRate).toBe(90);
    expect(agg.confirmedWithinSla).toBe(45);
    expect(agg.lateConfirmations).toBe(5);
  });

  // --- Test 8: نسبة الرفض ---

  it('calculates rejection rate correctly', () => {
    const rows: SlaResponseReport[] = [
      {
        facilityId: 'fac-003',
        reportDate: new Date('2026-09-01'),
        avgConfirmationMinutes: 25,
        medianConfirmationMinutes: 22,
        p95ConfirmationMinutes: 45,
        totalWithSla: 40,
        confirmedWithinSla: 30,
        lateConfirmations: 10,
        slaComplianceRate: 75,
        totalBookings: 50,
        rejectedCount: 5,
        rejectionRate: 10,
      },
    ];

    const agg = aggregateSlaReport(
      rows,
      'fac-003',
      { from: new Date('2026-09-01'), to: new Date('2026-09-01') },
    );

    // 5/50 = 10%
    expect(agg.rejectionRate).toBe(10);
    expect(agg.rejectedCount).toBe(5);
  });

  // --- Access control ---

  it('restricts facility_manager to their own facility', () => {
    const result = validateSlaReportQuery({
      facilityId: 'fac-002',
      dateFrom: new Date('2026-09-01'),
      dateTo: new Date('2026-09-30'),
      actorId: 'user-001',
      actorRole: 'facility_manager' as RoleCode,
      actorFacilityId: 'fac-001',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('FACILITY_MISMATCH');
  });

  it('allows zamo_admin to query all facilities', () => {
    const result = validateSlaReportQuery({
      dateFrom: new Date('2026-09-01'),
      dateTo: new Date('2026-09-30'),
      actorId: 'admin-001',
      actorRole: 'zamo_admin' as RoleCode,
      actorFacilityId: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.facilityId).toBeNull(); // all facilities
    }
  });

  it('handles empty rows gracefully', () => {
    const agg = aggregateSlaReport(
      [],
      'fac-empty',
      { from: new Date('2026-09-01'), to: new Date('2026-09-30') },
    );

    expect(agg.avgConfirmationMinutes).toBeNull();
    expect(agg.slaComplianceRate).toBe(0);
    expect(agg.rejectionRate).toBe(0);
    expect(agg.totalBookings).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RPT-076 — Financial Reports
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-RPT-076 · Financial Reports', () => {
  // --- Test 9: تطابق تقرير العمولة مع الفواتير ---

  it('detects count mismatch between commission entries and invoice lines', () => {
    const settlements: SettlementReconciliation[] = [
      {
        settlementId: 'set-001',
        facilityId: 'fac-001',
        periodLabel: '2026-09',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        settlementStatus: 'closed',
        commissionEntryCount: 15,
        commissionTotalNet: 1500,
        commissionTotalVat: 225,
        commissionTotalGross: 1725,
        invoiceId: 'inv-001',
        invoiceNumber: 'ZAMO-INV-2026-09-001',
        invoiceStatus: 'issued',
        invoiceLineCount: 13,  // ❗ mismatch!
        invoiceSubtotal: 1500,
        invoiceVat: 225,
        invoiceTotal: 1725,
        totalPaid: 0,
        entriesMatchInvoice: false,
        amountsMatch: true,
      },
    ];

    const discrepancies = findDiscrepancies(settlements);
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]!.type).toBe('count_mismatch');
    expect(discrepancies[0]!.expected).toBe(15);
    expect(discrepancies[0]!.actual).toBe(13);
    expect(discrepancies[0]!.difference).toBe(2);
  });

  // --- Test 10: ❗ تطابق المجاميع مع قيود التسوية ---

  it('detects amount mismatch between commission gross and invoice total', () => {
    const settlements: SettlementReconciliation[] = [
      {
        settlementId: 'set-002',
        facilityId: 'fac-001',
        periodLabel: '2026-08',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        settlementStatus: 'closed',
        commissionEntryCount: 10,
        commissionTotalNet: 1000,
        commissionTotalVat: 150,
        commissionTotalGross: 1150,
        invoiceId: 'inv-002',
        invoiceNumber: 'ZAMO-INV-2026-08-001',
        invoiceStatus: 'issued',
        invoiceLineCount: 10,
        invoiceSubtotal: 1000,
        invoiceVat: 150,
        invoiceTotal: 1200,  // ❗ 1200 ≠ 1150 → mismatch!
        totalPaid: 1200,
        entriesMatchInvoice: true,
        amountsMatch: false,
      },
    ];

    const discrepancies = findDiscrepancies(settlements);
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]!.type).toBe('amount_mismatch');
    expect(discrepancies[0]!.expected).toBe(1150);
    expect(discrepancies[0]!.actual).toBe(1200);
    expect(discrepancies[0]!.difference).toBe(-50);
  });

  it('reports full reconciliation when no discrepancies', () => {
    const settlements: SettlementReconciliation[] = [
      {
        settlementId: 'set-003',
        facilityId: 'fac-001',
        periodLabel: '2026-07',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-31'),
        settlementStatus: 'closed',
        commissionEntryCount: 8,
        commissionTotalNet: 800,
        commissionTotalVat: 120,
        commissionTotalGross: 920,
        invoiceId: 'inv-003',
        invoiceNumber: 'ZAMO-INV-2026-07-001',
        invoiceStatus: 'paid',
        invoiceLineCount: 8,
        invoiceSubtotal: 800,
        invoiceVat: 120,
        invoiceTotal: 920,
        totalPaid: 920,
        entriesMatchInvoice: true,
        amountsMatch: true,
      },
    ];

    const report = buildReconciliationReport(
      settlements,
      'fac-001',
      { from: new Date('2026-07-01'), to: new Date('2026-07-31') },
    );

    expect(report.isFullyReconciled).toBe(true);
    expect(report.discrepancies).toHaveLength(0);
    expect(report.settlements).toHaveLength(1);
  });

  // --- Access control ---

  it('restricts facility_manager to their own facility', () => {
    const result = validateFinancialReportQuery({
      facilityId: 'fac-002',
      actorId: 'user-001',
      actorRole: 'facility_manager' as RoleCode,
      actorFacilityId: 'fac-001',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('FACILITY_MISMATCH');
  });

  it('allows zamo_admin to access any facility', () => {
    const result = validateFinancialReportQuery({
      facilityId: 'fac-002',
      actorId: 'admin-001',
      actorRole: 'zamo_admin' as RoleCode,
      actorFacilityId: null,
    });

    expect(result.ok).toBe(true);
  });

  it('rejects unauthorized role', () => {
    const result = validateFinancialReportQuery({
      facilityId: 'fac-001',
      actorId: 'user-001',
      actorRole: 'receptionist' as RoleCode,
      actorFacilityId: 'fac-001',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('NOT_AUTHORIZED');
  });
});
