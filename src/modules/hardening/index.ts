/**
 * ZAMO Phase 10 — Hardening & Launch module barrel.
 *
 * Re-exports all Phase 10 audit and launch-gate services:
 *   - M15: Security Audit (ZAMO-SEC-077)
 *   - M16: Accessibility Audit (ZAMO-A11Y-078)
 *   - M17: I18n Audit (ZAMO-I18N-079)
 *   - M18: E2E Journey (ZAMO-E2E-080)
 *   - M19: Performance Audit (ZAMO-PERF-081)
 *   - M20: Ops Readiness (ZAMO-OPS-082)
 *   - M21: Launch Gate (ZAMO-LAUNCH-083)
 */

export {
  runSecurityAudit,
  checkRlsPolicies,
  checkSessionSecurity,
  checkAuditCompleteness,
  checkRateLimiting,
  checkEnvironmentSecurity,
  checkPasswordPolicy,
  checkDataRetention,
  type SecurityAuditReport,
  type AuditFinding,
  type AuditSeverity,
  type SecurityAuditDeps,
} from './security-audit.ts';

export {
  runA11yAudit,
  checkDeafScenario,
  checkColourContrast,
  checkKeyboardNav,
  checkRtlSupport,
  relativeLuminance,
  contrastRatio,
  type A11yAuditReport,
  type A11yFinding,
  type A11yLevel,
  type A11ySeverity,
  type StatusBadgeSpec,
  type ColourPair,
  type KeyboardNavSpec,
} from './accessibility-audit.ts';

export {
  runI18nAudit,
  checkTranslationParity,
  checkPlaceholderConsistency,
  checkLanguageCrossContamination,
  checkDbFieldParity,
  checkEmptyTranslations,
  type I18nAuditReport,
  type I18nFinding,
  type I18nSeverity,
  type I18nAuditDeps,
} from './i18n-audit.ts';

export {
  validateFullJourney,
  type JourneyReport,
  type JourneyStep,
} from './e2e-journey.ts';

export {
  runPerfAudit,
  checkIndexCoverage,
  checkTableSizes,
  checkQueryPlans,
  checkPayloadBudgets,
  type PerfAuditReport,
  type PerfFinding,
  type PerfSeverity,
  type PayloadBudget,
} from './performance-audit.ts';

export {
  runOpsAudit,
  checkBackupConfig,
  checkHealthEndpoint,
  checkMonitoringConfig,
  type OpsReadinessReport,
  type OpsCheck,
  type OpsCheckSeverity,
  type BackupConfig,
  type HealthCheckConfig,
  type MonitoringConfig,
  type OpsAuditDeps,
} from './ops-readiness.ts';

export {
  evaluateLaunchGate,
  getDefaultBlockers,
  type LaunchGateReport,
  type LaunchGateInput,
  type LaunchDecision,
  type LaunchBlocker,
  type ClosedBetaResult,
} from './launch-gate.ts';
