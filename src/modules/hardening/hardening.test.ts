/**
 * Phase 10 — التصلّب والإطلاق — unit tests.
 *
 * 7 tasks × multiple checks = 45 tests:
 *   ZAMO-SEC-077:   Security audit ................ 8 tests
 *   ZAMO-A11Y-078:  Accessibility audit ........... 8 tests
 *   ZAMO-I18N-079:  Bilingual audit ............... 7 tests
 *   ZAMO-E2E-080:   E2E journey validation ........ 4 tests
 *   ZAMO-PERF-081:  Performance audit ............. 6 tests
 *   ZAMO-OPS-082:   Ops readiness ................. 6 tests
 *   ZAMO-LAUNCH-083: Launch gate .................. 6 tests
 *                                        Total:  45 tests
 *
 * ❗ DB-dependent tests (SEC, I18N-DB, E2E, PERF) are run against PGlite.
 *    Pure-logic tests (A11Y, I18N-static, OPS, LAUNCH) run in-memory.
 *
 * PGlite WASM memory constraint: a single PGlite instance is shared across
 * all DB-needing describe blocks (vitest concurrency disabled).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMigratedTestDb } from '../../db/testing.ts';
import type { Db } from '../../db/client.ts';

// Security audit
import {
  checkRlsPolicies,
  checkSessionSecurity,
  checkAuditCompleteness,
  checkRateLimiting,
  checkEnvironmentSecurity,
  checkPasswordPolicy,
  checkDataRetention,
  runSecurityAudit,
} from './security-audit.ts';

// Accessibility audit
import {
  relativeLuminance,
  contrastRatio,
  checkDeafScenario,
  checkColourContrast,
  checkKeyboardNav,
  checkRtlSupport,
  runA11yAudit,
  type StatusBadgeSpec,
  type ColourPair,
  type KeyboardNavSpec,
} from './accessibility-audit.ts';

// I18n audit
import {
  checkTranslationParity,
  checkPlaceholderConsistency,
  checkLanguageCrossContamination,
  checkEmptyTranslations,
} from './i18n-audit.ts';

// Performance audit (pure-logic only)
import {
  checkPayloadBudgets,
  type PayloadBudget,
} from './performance-audit.ts';

// Ops readiness
import {
  checkBackupConfig,
  checkHealthEndpoint,
  checkMonitoringConfig,
  runOpsAudit,
  type BackupConfig,
  type HealthCheckConfig,
  type MonitoringConfig,
} from './ops-readiness.ts';

// Launch gate
import {
  evaluateLaunchGate,
  getDefaultBlockers,
  type LaunchGateInput,
} from './launch-gate.ts';

// Translations (for i18n testing)
import { translations as arTranslations } from '../../shared/translations/ar.ts';
import { translations as enTranslations } from '../../shared/translations/en.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Pure-logic env config used for rate-limit tests
// ═══════════════════════════════════════════════════════════════════════════
const safeEnv = {
  NODE_ENV: 'test' as const,
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'x'.repeat(32),
  OTP_PEPPER: 'y'.repeat(32),
  SESSION_TTL_PATIENT_MIN: 10080,
  SESSION_TTL_STAFF_MIN: 480,
  SESSION_TTL_ADMIN_MIN: 30,
  OTP_TTL_SECONDS: 300,
  OTP_MAX_ATTEMPTS: 5,
  OTP_REQUEST_WINDOW_SECONDS: 3600,
  OTP_MAX_REQUESTS_PER_WINDOW: 5,
  NOTIFICATION_ADAPTER: 'memory' as const,
  LLM_ADAPTER: 'mock' as const,
  OPENAI_MODEL_DEFAULT: 'gpt-4o-mini',
  OPENAI_MODEL_COMPLEX: 'gpt-4o',
  OPENAI_MONTHLY_CAP_USD: 500,
  APP_BASE_URL: 'http://localhost:3000',
  PORT: 3000,
  ALLOW_MOCK_PROVIDERS: 'false' as const,
  AUTO_MIGRATE: 'false' as const,
};

// ═══════════════════════════════════════════════════════════════════════════
// ZAMO-SEC-077 — Security Audit — pure logic tests (4 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-SEC-077 — Security Audit (pure)', () => {
  it('validates OTP rate limiting with safe defaults', () => {
    const findings = checkRateLimiting(safeEnv);
    expect(findings.length).toBe(3);
    expect(findings.every(f => f.passed)).toBe(true);
  });

  it('rejects too-permissive OTP settings', () => {
    const findings = checkRateLimiting({
      ...safeEnv,
      OTP_TTL_SECONDS: 900,     // 15 min — too long
      OTP_MAX_ATTEMPTS: 20,     // too many
      OTP_MAX_REQUESTS_PER_WINDOW: 50, // too many
    });
    expect(findings.some(f => !f.passed)).toBe(true);
  });

  it('checks password policy strength', () => {
    const findings = checkPasswordPolicy();
    expect(findings.length).toBe(3);
    expect(findings.every(f => f.passed)).toBe(true);
  });

  it('checks environment security defaults', () => {
    const findings = checkEnvironmentSecurity(safeEnv);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.category).toBe('Environment Security');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ZAMO-A11Y-078 — Accessibility Audit (8 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-A11Y-078 — Accessibility Audit', () => {
  it('calculates relative luminance correctly', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1.0, 1);
    expect(relativeLuminance('#000000')).toBeCloseTo(0.0, 1);
  });

  it('calculates contrast ratio correctly', () => {
    const ratio = contrastRatio('#000000', '#FFFFFF');
    expect(ratio).toBeCloseTo(21, 0);
    expect(contrastRatio('#FF0000', '#FF0000')).toBeCloseTo(1, 0);
  });

  it('validates deaf scenario — complete badges pass', () => {
    const badges: StatusBadgeSpec[] = [
      { status: 'CONFIRMED', label: 'مؤكد', icon: 'check-circle', color: '#22C55E', textColor: '#FFFFFF', description: 'الموعد مؤكد' },
      { status: 'CANCELLED', label: 'ملغى', icon: 'x-circle', color: '#EF4444', textColor: '#FFFFFF', description: 'تم الإلغاء' },
    ];
    const findings = checkDeafScenario(badges, ['booking.confirmed']);
    expect(findings.every(f => f.passed)).toBe(true);
  });

  it('fails deaf scenario when badge missing icon', () => {
    const badges: StatusBadgeSpec[] = [
      { status: 'BROKEN', label: 'Test', icon: '', color: '#FF0000', textColor: '#FFF', description: 'test' },
    ];
    const findings = checkDeafScenario(badges, []);
    const broken = findings.find(f => f.id === 'DEAF-BADGE-BROKEN');
    expect(broken).toBeDefined();
    expect(broken!.passed).toBe(false);
    expect(broken!.severity).toBe('CRITICAL');
  });

  it('checks colour contrast — good pair passes', () => {
    const pairs: ColourPair[] = [
      { name: 'body-text', foreground: '#1A1A1A', background: '#FFFFFF' },
    ];
    const findings = checkColourContrast(pairs);
    expect(findings[0]!.passed).toBe(true);
  });

  it('checks colour contrast — bad pair fails', () => {
    const pairs: ColourPair[] = [
      { name: 'low-contrast', foreground: '#CCCCCC', background: '#FFFFFF' },
    ];
    const findings = checkColourContrast(pairs);
    expect(findings[0]!.passed).toBe(false);
  });

  it('validates keyboard navigation specs', () => {
    const specs: KeyboardNavSpec[] = [
      { component: 'BookButton', tabStop: true, enterAction: true, escapeAction: false },
      { component: 'SearchInput', tabStop: true, enterAction: true, escapeAction: true },
    ];
    const findings = checkKeyboardNav(specs);
    expect(findings.every(f => f.passed)).toBe(true);
  });

  it('runs the full a11y audit', () => {
    const report = runA11yAudit({
      statusBadges: [
        { status: 'CONFIRMED', label: 'Confirmed', icon: 'check', color: '#22C55E', textColor: '#FFF', description: 'Confirmed' },
      ],
      notificationTypes: ['booking.confirmed', 'sla.warning'],
      colourPairs: [
        { name: 'heading', foreground: '#111827', background: '#FFFFFF' },
      ],
      keyboardNavSpecs: [
        { component: 'BookButton', tabStop: true, enterAction: true, escapeAction: false },
      ],
    });
    expect(report.totalChecks).toBeGreaterThan(0);
    expect(report.deafScenarioPassed).toBe(true);
    expect(report.rtlSupportPassed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ZAMO-I18N-079 — Bilingual Audit — static tests (7 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-I18N-079 — Bilingual Audit', () => {
  it('detects translation parity — matching keys pass', () => {
    const findings = checkTranslationParity(
      { 'hello': 'مرحبا', 'bye': 'مع السلامة' },
      { 'hello': 'Hello', 'bye': 'Goodbye' },
    );
    expect(findings.every(f => f.passed)).toBe(true);
  });

  it('detects missing keys in English', () => {
    const findings = checkTranslationParity(
      { 'hello': 'مرحبا', 'extra': 'إضافي' },
      { 'hello': 'Hello' },
    );
    const missingEn = findings.find(f => f.id === 'I18N-MISSING-EN');
    expect(missingEn!.passed).toBe(false);
  });

  it('validates placeholder consistency', () => {
    const findings = checkPlaceholderConsistency(
      { 'greeting': 'مرحبا {name}!' },
      { 'greeting': 'Hello {name}!' },
    );
    expect(findings[0]!.passed).toBe(true);
  });

  it('detects placeholder mismatches', () => {
    const findings = checkPlaceholderConsistency(
      { 'greeting': 'مرحبا {name} {age}!' },
      { 'greeting': 'Hello {name}!' },
    );
    expect(findings[0]!.passed).toBe(false);
  });

  it('detects Arabic characters in English translations', () => {
    const findings = checkLanguageCrossContamination(
      { 'hello': 'Hello', 'broken': 'Some مرحبا mixed' },
    );
    expect(findings[0]!.passed).toBe(false);
  });

  it('exempts nav.language from Arabic-in-English check', () => {
    const findings = checkLanguageCrossContamination(
      { 'nav.language': 'العربية' },
      ['nav.language'],
    );
    expect(findings[0]!.passed).toBe(true);
  });

  it('validates actual project translations are in parity', () => {
    const findings = checkTranslationParity(arTranslations, enTranslations);
    for (const f of findings) {
      expect(f.passed).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ZAMO-PERF-081 — Performance Audit — pure payload tests (2 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-PERF-081 — Performance Audit (pure)', () => {
  it('validates payload budgets — within budget passes', () => {
    const budgets: PayloadBudget[] = [
      { endpoint: '/api/search', maxSizeKb: 50, estimatedSizeKb: 30 },
      { endpoint: '/api/booking', maxSizeKb: 20, estimatedSizeKb: 10 },
    ];
    const findings = checkPayloadBudgets(budgets);
    expect(findings.every(f => f.passed)).toBe(true);
  });

  it('validates payload budgets — over budget fails', () => {
    const budgets: PayloadBudget[] = [
      { endpoint: '/api/heavy', maxSizeKb: 50, estimatedSizeKb: 120 },
    ];
    const findings = checkPayloadBudgets(budgets);
    expect(findings[0]!.passed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ZAMO-OPS-082 — Ops Readiness (6 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-OPS-082 — Ops Readiness', () => {
  const goodBackup: BackupConfig = {
    strategy: 'pitr',
    frequencyHours: 1,
    retentionDays: 90,
    encrypted: true,
    crossRegion: true,
    rtoMinutes: 30,
    rpoMinutes: 5,
    lastTestDate: new Date().toISOString(),
  };

  const goodHealth: HealthCheckConfig = {
    path: '/health',
    checksDb: true,
    returnsVersion: true,
    isProtected: false,
    checksDependencies: true,
  };

  const goodMonitoring: MonitoringConfig = {
    metricsExported: true,
    errorTrackingEnabled: true,
    uptimeMonitoring: true,
    alertChannels: ['slack', 'pagerduty'],
    slaAlerts: true,
    financialAlerts: true,
  };

  it('passes with proper backup configuration', () => {
    const checks = checkBackupConfig(goodBackup);
    expect(checks.every(c => c.passed)).toBe(true);
  });

  it('fails with no backup strategy', () => {
    const checks = checkBackupConfig({ ...goodBackup, strategy: 'none' });
    const strategy = checks.find(c => c.id === 'BACKUP-STRATEGY');
    expect(strategy!.passed).toBe(false);
    expect(strategy!.severity).toBe('CRITICAL');
  });

  it('fails with unencrypted backups', () => {
    const checks = checkBackupConfig({ ...goodBackup, encrypted: false });
    const enc = checks.find(c => c.id === 'BACKUP-ENCRYPTION');
    expect(enc!.passed).toBe(false);
    expect(enc!.severity).toBe('HIGH');
  });

  it('validates health check configuration', () => {
    const checks = checkHealthEndpoint(goodHealth);
    expect(checks.length).toBe(3);
    expect(checks.every(c => c.passed)).toBe(true);
  });

  it('validates monitoring configuration', () => {
    const checks = checkMonitoringConfig(goodMonitoring);
    expect(checks.every(c => c.passed)).toBe(true);
  });

  it('runs the full ops audit', () => {
    const report = runOpsAudit({
      backup: goodBackup,
      healthCheck: goodHealth,
      monitoring: goodMonitoring,
    });
    expect(report.backupReady).toBe(true);
    expect(report.monitoringReady).toBe(true);
    expect(report.healthCheckReady).toBe(true);
    expect(report.overallPass).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ZAMO-LAUNCH-083 — Launch Gate (6 tests)
// ═══════════════════════════════════════════════════════════════════════════

describe('ZAMO-LAUNCH-083 — Launch Gate', () => {
  function makePassing(): LaunchGateInput {
    return {
      securityReport: { timestamp: '', environment: 'test', totalChecks: 10, passed: 10, failed: 0, critical: 0, high: 0, medium: 0, low: 0, findings: [], overallPass: true },
      a11yReport: { timestamp: '', totalChecks: 5, passed: 5, failed: 0, criticalFailures: 0, findings: [], deafScenarioPassed: true, colourContrastPassed: true, keyboardNavPassed: true, rtlSupportPassed: true, overallPass: true },
      i18nReport: { timestamp: '', totalChecks: 5, passed: 5, failed: 0, findings: [], translationParity: true, dbFieldParity: true, overallPass: true },
      e2eReport: { timestamp: '', totalSteps: 21, passedSteps: 21, failedSteps: 0, steps: [], totalDurationMs: 100, overallPass: true, firstFailure: null },
      perfReport: { timestamp: '', totalChecks: 5, passed: 5, failed: 0, findings: [], indexCoverage: true, queryPerformance: true, overallPass: true },
      opsReport: { timestamp: '', totalChecks: 5, passed: 5, failed: 0, findings: [], backupReady: true, monitoringReady: true, healthCheckReady: true, overallPass: true },
      blockers: getDefaultBlockers().map(b => ({ ...b, resolved: true })),
      closedBetaResults: [{ clinicName: 'Test Clinic', clinicNameAr: 'عيادة اختبار', startDate: '2026-09-01', endDate: '2026-09-15', bookingsProcessed: 50, criticalBugsFound: 0, feedbackScore: 9, passed: true }],
      criticalBugCount: 0,
      legalReviewCompleted: true,
    };
  }

  it('returns GO when all criteria met', () => {
    const report = evaluateLaunchGate(makePassing());
    expect(report.decision).toBe('GO');
    expect(report.metCriteria).toBe(report.totalCriteria);
    expect(report.reasons.length).toBe(0);
  });

  it('returns NO_GO when security audit fails', () => {
    const input = makePassing();
    input.securityReport = { ...input.securityReport, overallPass: false, critical: 2 };
    const report = evaluateLaunchGate(input);
    expect(report.decision).toBe('NO_GO');
    expect(report.securityPassed).toBe(false);
  });

  it('returns NO_GO when critical bugs exist', () => {
    const input = makePassing();
    input.criticalBugCount = 3;
    const report = evaluateLaunchGate(input);
    expect(report.decision).toBe('NO_GO');
    expect(report.criticalBugsPassed).toBe(false);
  });

  it('returns NO_GO when no closed beta results', () => {
    const input = makePassing();
    input.closedBetaResults = [];
    const report = evaluateLaunchGate(input);
    expect(['NO_GO', 'CONDITIONAL']).toContain(report.decision);
    expect(report.closedBetaPassed).toBe(false);
  });

  it('tracks unresolved blockers', () => {
    const input = makePassing();
    input.blockers = getDefaultBlockers(); // all unresolved
    const report = evaluateLaunchGate(input);
    expect(report.unresolvedBlockers).toBe(4);
    expect(report.reasons.length).toBeGreaterThan(0);
  });

  it('provides Arabic reasons alongside English', () => {
    const input = makePassing();
    input.legalReviewCompleted = false;
    const report = evaluateLaunchGate(input);
    expect(report.reasons.length).toBe(report.reasonsAr.length);
    expect(report.reasonsAr.some(r => r.includes('القانونية'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DB-dependent tests (SEC-077 DB, E2E-080, PERF-081 DB, I18N-079 DB)
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 10 — DB integration', () => {
  let db: Db;

  beforeAll(async () => {
    db = await createMigratedTestDb();
  }, 90_000);

  afterAll(async () => {
    if (db) await db.close();
  });

  // SEC-077 DB checks
  it('SEC-077: checks RLS policies', async () => {
    const findings = await checkRlsPolicies(db);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.category).toBe('Row-Level Security');
    }
  });

  it('SEC-077: validates session token hashing', async () => {
    const findings = await checkSessionSecurity(db);
    expect(findings.length).toBe(3);
    const hashFinding = findings.find(f => f.id === 'SESSION-HASH');
    expect(hashFinding).toBeDefined();
    expect(hashFinding!.passed).toBe(true);
  });

  it('SEC-077: confirms audit trail has financial flag', async () => {
    const findings = await checkAuditCompleteness(db);
    expect(findings.length).toBe(4);
    const financialFinding = findings.find(f => f.id === 'AUDIT-FINANCIAL');
    expect(financialFinding).toBeDefined();
    expect(financialFinding!.passed).toBe(true);
  });

  it('SEC-077: checks data retention patterns', async () => {
    const findings = await checkDataRetention(db);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.category).toBe('Data Retention');
  });

  // E2E-080
  it('E2E-080: produces a 21-step journey report', async () => {
    const { validateFullJourney } = await import('./e2e-journey.ts');
    const report = await validateFullJourney(db);
    expect(report.totalSteps).toBe(21);
    expect(report.steps.length).toBe(21);
  });

  it('E2E-080: steps have required fields', async () => {
    const { validateFullJourney } = await import('./e2e-journey.ts');
    const report = await validateFullJourney(db);
    for (const step of report.steps) {
      expect(step.stepNumber).toBeGreaterThan(0);
      expect(step.stepNumber).toBeLessThanOrEqual(21);
      expect(step.name).toBeTruthy();
      expect(['discovery', 'booking', 'service', 'billing', 'reporting']).toContain(step.phase);
    }
  });

  it('E2E-080: steps 1–5 cover the discovery phase', async () => {
    const { validateFullJourney } = await import('./e2e-journey.ts');
    const report = await validateFullJourney(db);
    const discoverySteps = report.steps.filter(s => s.phase === 'discovery');
    expect(discoverySteps.length).toBe(5);
  });

  it('E2E-080: reports firstFailure when steps fail', async () => {
    const { validateFullJourney } = await import('./e2e-journey.ts');
    const report = await validateFullJourney(db);
    if (report.failedSteps > 0) {
      expect(report.firstFailure).toBeTruthy();
      expect(report.firstFailure).toContain('Step');
    }
  });

  // PERF-081 DB checks
  it('PERF-081: checks index coverage', async () => {
    const { checkIndexCoverage } = await import('./performance-audit.ts');
    const findings = await checkIndexCoverage(db);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.category).toBe('Index Coverage');
    }
  });

  it('PERF-081: checks table sizes', async () => {
    const { checkTableSizes } = await import('./performance-audit.ts');
    const findings = await checkTableSizes(db);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.category).toBe('Table Sizes');
  });

  it('PERF-081: checks query plans', async () => {
    const { checkQueryPlans } = await import('./performance-audit.ts');
    const findings = await checkQueryPlans(db);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.category).toBe('Query Plans');
    }
  });

  it('PERF-081: runs the full performance audit', async () => {
    const { runPerfAudit } = await import('./performance-audit.ts');
    const report = await runPerfAudit(db, [
      { endpoint: '/api/search', maxSizeKb: 50, estimatedSizeKb: 25 },
    ]);
    expect(report.totalChecks).toBeGreaterThan(0);
    expect(report.timestamp).toBeDefined();
  });

  // SEC-077 full audit (requires DB + config)
  it('SEC-077: runs the full security audit', async () => {
    const report = await runSecurityAudit({ db, config: safeEnv });
    expect(report.totalChecks).toBeGreaterThan(10);
    expect(report.timestamp).toBeDefined();
    expect(report.environment).toBe('test');
  });
});
