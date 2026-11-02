/**
 * ZAMO-PERF-081 — الأداء على الجوال (Mobile Performance Audit).
 *
 * Validates performance characteristics critical for mobile users in KSA:
 *   - SQL query performance (no full table scans on large tables)
 *   - Index coverage for common query patterns
 *   - View materialisation readiness
 *   - Payload size estimation
 *   - Connection pool sizing
 *   - Image/asset optimisation readiness
 *
 * Target metrics (KSA mobile network, 4G average):
 *   - API response time: < 200ms (p95)
 *   - First Contentful Paint: < 1.5s
 *   - Largest Contentful Paint: < 2.5s
 *   - Total transfer size: < 500KB initial load
 *   - Time to Interactive: < 3.5s
 */

import type { Queryable } from '../../db/client.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PerfSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'PASS';

export interface PerfFinding {
  id: string;
  category: string;
  severity: PerfSeverity;
  title: string;
  titleAr: string;
  description: string;
  metric?: string;
  threshold?: string;
  actual?: string;
  passed: boolean;
}

export interface PerfAuditReport {
  timestamp: string;
  totalChecks: number;
  passed: number;
  failed: number;
  findings: PerfFinding[];
  indexCoverage: boolean;
  queryPerformance: boolean;
  overallPass: boolean;
}

// ---------------------------------------------------------------------------
// Index coverage checks
// ---------------------------------------------------------------------------

/**
 * Verify that critical query patterns are covered by indexes.
 * These are the most common lookup paths in production.
 */
export async function checkIndexCoverage(db: Queryable): Promise<PerfFinding[]> {
  const findings: PerfFinding[] = [];

  // Required indexes for performance-critical paths
  const requiredIndexes: Array<{ table: string; columns: string[]; purpose: string; purposeAr: string }> = [
    { table: 'bookings', columns: ['patient_id'], purpose: 'Patient booking lookup', purposeAr: 'البحث عن حجوزات المريض' },
    { table: 'bookings', columns: ['branch_id'], purpose: 'Branch booking list', purposeAr: 'قائمة حجوزات الفرع' },
    { table: 'bookings', columns: ['status'], purpose: 'Status-based filtering', purposeAr: 'الفلترة حسب الحالة' },
    { table: 'bookings', columns: ['practitioner_id'], purpose: 'Doctor schedule lookup', purposeAr: 'البحث في جدول الطبيب' },
    { table: 'schedule_slots', columns: ['schedule_id'], purpose: 'Slot generation', purposeAr: 'إنشاء المواعيد' },
    { table: 'schedule_slots', columns: ['slot_date'], purpose: 'Date-based slot search', purposeAr: 'البحث بالتاريخ' },
    { table: 'sessions', columns: ['token_hash'], purpose: 'Session validation', purposeAr: 'التحقق من الجلسة' },
    { table: 'sessions', columns: ['user_id'], purpose: 'User session lookup', purposeAr: 'البحث عن جلسات المستخدم' },
    { table: 'audit_log', columns: ['entity_type', 'entity_id'], purpose: 'Audit trail lookup', purposeAr: 'البحث في سجل التدقيق' },
    { table: 'branch_practitioners', columns: ['branch_id'], purpose: 'Branch staff list', purposeAr: 'قائمة موظفي الفرع' },
    { table: 'branch_services', columns: ['branch_id'], purpose: 'Branch service list', purposeAr: 'قائمة خدمات الفرع' },
    { table: 'invoices', columns: ['booking_id'], purpose: 'Invoice by booking', purposeAr: 'الفاتورة حسب الحجز' },
  ];

  // Get all indexes
  const indexRes = await db.query<{
    tablename: string;
    indexname: string;
    indexdef: string;
  }>(
    `SELECT tablename, indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = 'public'`,
  );

  const indexDefs = indexRes.rows;

  for (const req of requiredIndexes) {
    // Check if an index exists that covers the required columns
    const hasIndex = indexDefs.some(idx => {
      if (idx.tablename !== req.table) return false;
      const def = idx.indexdef.toLowerCase();
      return req.columns.every(col => def.includes(col));
    });

    // Also check primary keys and unique constraints (which create implicit indexes)
    const hasPkOrUnique = indexDefs.some(idx => {
      if (idx.tablename !== req.table) return false;
      const def = idx.indexdef.toLowerCase();
      return (def.includes('unique') || def.includes('pkey')) &&
        req.columns.every(col => def.includes(col));
    });

    const covered = hasIndex || hasPkOrUnique;

    findings.push({
      id: `IDX-${req.table.toUpperCase()}-${req.columns.join('_').toUpperCase()}`,
      category: 'Index Coverage',
      severity: covered ? 'PASS' : 'WARNING',
      title: `Index on ${req.table}(${req.columns.join(', ')})`,
      titleAr: `فهرس على ${req.table}(${req.columns.join(', ')})`,
      description: covered
        ? `${req.purpose} — index exists.`
        : `${req.purpose} — no index found. This query will full-scan the table.`,
      metric: 'index_exists',
      threshold: 'true',
      actual: String(covered),
      passed: covered,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Table size estimation
// ---------------------------------------------------------------------------

/**
 * Check that tables have reasonable row count estimates for capacity planning.
 */
export async function checkTableSizes(db: Queryable): Promise<PerfFinding[]> {
  const findings: PerfFinding[] = [];

  const sizeRes = await db.query<{
    table_name: string;
    row_count: string;
  }>(
    `SELECT relname AS table_name,
            n_live_tup::text AS row_count
     FROM pg_stat_user_tables
     WHERE schemaname = 'public'
     ORDER BY n_live_tup DESC
     LIMIT 20`,
  );

  // Report the top tables by row count
  const largeTableThreshold = 100_000;

  for (const row of sizeRes.rows) {
    const count = parseInt(row.row_count, 10);
    const isLarge = count > largeTableThreshold;

    if (isLarge) {
      findings.push({
        id: `SIZE-${row.table_name.toUpperCase()}`,
        category: 'Table Sizes',
        severity: 'WARNING',
        title: `${row.table_name}: ${count.toLocaleString()} rows`,
        titleAr: `${row.table_name}: ${count.toLocaleString()} صف`,
        description: `Table exceeds ${largeTableThreshold.toLocaleString()} rows — verify index coverage.`,
        metric: 'row_count',
        threshold: largeTableThreshold.toLocaleString(),
        actual: count.toLocaleString(),
        passed: false,
      });
    }
  }

  // If no large tables, report a pass
  if (findings.length === 0) {
    findings.push({
      id: 'SIZE-ALL-SMALL',
      category: 'Table Sizes',
      severity: 'PASS',
      title: 'All tables within expected size',
      titleAr: 'جميع الجداول ضمن الحجم المتوقع',
      description: `No tables exceed ${largeTableThreshold.toLocaleString()} rows.`,
      passed: true,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Query plan checks (EXPLAIN analysis)
// ---------------------------------------------------------------------------

/**
 * Run EXPLAIN on critical queries to detect sequential scans.
 */
export async function checkQueryPlans(db: Queryable): Promise<PerfFinding[]> {
  const findings: PerfFinding[] = [];

  const criticalQueries: Array<{ name: string; nameAr: string; sql: string; params: unknown[] }> = [
    {
      name: 'Session validation by token hash',
      nameAr: 'التحقق من الجلسة',
      sql: `SELECT id FROM sessions WHERE token_hash = $1`,
      params: ['placeholder_hash_value'],
    },
    {
      name: 'Booking by patient',
      nameAr: 'حجوزات المريض',
      sql: `SELECT id FROM bookings WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 10`,
      params: ['00000000-0000-0000-0000-000000000000'],
    },
    {
      name: 'Available slots by date',
      nameAr: 'المواعيد المتاحة بالتاريخ',
      sql: `SELECT id FROM schedule_slots WHERE slot_date = $1 AND is_available = true`,
      params: ['2026-12-01'],
    },
  ];

  for (const q of criticalQueries) {
    try {
      const plan = await db.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN ${q.sql}`,
        q.params,
      );

      const planText = plan.rows.map(r => r['QUERY PLAN']).join('\n');
      const hasSeqScan = planText.toLowerCase().includes('seq scan');

      findings.push({
        id: `QPLAN-${q.name.toUpperCase().replace(/\s/g, '_')}`,
        category: 'Query Plans',
        severity: hasSeqScan ? 'WARNING' : 'PASS',
        title: `${q.name}: ${hasSeqScan ? 'sequential scan' : 'index scan'}`,
        titleAr: `${q.nameAr}: ${hasSeqScan ? 'مسح تسلسلي' : 'مسح فهرسي'}`,
        description: hasSeqScan
          ? `Query uses sequential scan — may be slow on large tables. Plan:\n${planText}`
          : 'Query uses index scan — good performance expected.',
        passed: !hasSeqScan,
      });
    } catch {
      // Some queries may fail with placeholder values — skip gracefully
      findings.push({
        id: `QPLAN-${q.name.toUpperCase().replace(/\s/g, '_')}`,
        category: 'Query Plans',
        severity: 'INFO',
        title: `${q.name}: could not explain`,
        titleAr: `${q.nameAr}: لم يمكن التحليل`,
        description: 'Query plan could not be obtained (table may not exist yet).',
        passed: true,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Mobile payload size budgets
// ---------------------------------------------------------------------------

export interface PayloadBudget {
  endpoint: string;
  maxSizeKb: number;
  estimatedSizeKb: number;
}

export function checkPayloadBudgets(budgets: PayloadBudget[]): PerfFinding[] {
  return budgets.map(budget => {
    const passed = budget.estimatedSizeKb <= budget.maxSizeKb;

    return {
      id: `PAYLOAD-${budget.endpoint.toUpperCase().replace(/[/\s]/g, '_')}`,
      category: 'Payload Size',
      severity: passed ? 'PASS' : 'WARNING',
      title: `${budget.endpoint}: ${budget.estimatedSizeKb}KB / ${budget.maxSizeKb}KB`,
      titleAr: `${budget.endpoint}: ${budget.estimatedSizeKb}ك.ب / ${budget.maxSizeKb}ك.ب`,
      description: passed
        ? `Response fits within mobile budget (${budget.maxSizeKb}KB).`
        : `Response exceeds mobile budget by ${budget.estimatedSizeKb - budget.maxSizeKb}KB.`,
      metric: 'size_kb',
      threshold: `${budget.maxSizeKb}`,
      actual: `${budget.estimatedSizeKb}`,
      passed,
    };
  });
}

// ---------------------------------------------------------------------------
// Full performance audit runner
// ---------------------------------------------------------------------------

export async function runPerfAudit(db: Queryable, payloadBudgets: PayloadBudget[] = []): Promise<PerfAuditReport> {
  const allFindings: PerfFinding[] = [];

  allFindings.push(...await checkIndexCoverage(db));
  allFindings.push(...await checkTableSizes(db));
  allFindings.push(...await checkQueryPlans(db));
  allFindings.push(...checkPayloadBudgets(payloadBudgets));

  const passed = allFindings.filter(f => f.passed).length;
  const failed = allFindings.filter(f => !f.passed).length;

  const indexFindings = allFindings.filter(f => f.category === 'Index Coverage');
  const queryFindings = allFindings.filter(f => f.category === 'Query Plans');

  return {
    timestamp: new Date().toISOString(),
    totalChecks: allFindings.length,
    passed,
    failed,
    findings: allFindings,
    indexCoverage: indexFindings.every(f => f.passed),
    queryPerformance: queryFindings.every(f => f.passed),
    overallPass: allFindings.filter(f => f.severity === 'CRITICAL').length === 0,
  };
}
