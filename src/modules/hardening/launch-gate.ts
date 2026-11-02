/**
 * ZAMO-LAUNCH-083 — بوابة الإطلاق (Launch Gate).
 *
 * ❗ This is the FINAL gate before commercial launch.
 *
 * Aggregates results from all Phase 10 audits and external blockers
 * to produce a single GO / NO-GO decision.
 *
 * Launch criteria (from PHASES.md Phase Gate):
 *   - ❗ 0 critical bugs
 *   - ❗ Local legal review completed
 *   - ❗ Closed beta: 1–2 clinics tested
 *   - All acceptance indicators in [S2] §16.2 met
 *   - OQ-004 (legal framework) resolved
 *   - OQ-017 (hosting & data localisation) resolved
 *   - OQ-018 (retention & deletion policy) resolved
 *   - OQ-037 (policy texts) resolved
 */

import type { SecurityAuditReport } from './security-audit.ts';
import type { A11yAuditReport } from './accessibility-audit.ts';
import type { I18nAuditReport } from './i18n-audit.ts';
import type { JourneyReport } from './e2e-journey.ts';
import type { PerfAuditReport } from './performance-audit.ts';
import type { OpsReadinessReport } from './ops-readiness.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LaunchDecision = 'GO' | 'NO_GO' | 'CONDITIONAL';

export interface LaunchBlocker {
  id: string;
  title: string;
  titleAr: string;
  resolved: boolean;
  resolvedDate?: string;
  owner: string;
  notes?: string;
}

export interface ClosedBetaResult {
  clinicName: string;
  clinicNameAr: string;
  startDate: string;
  endDate: string | null;
  bookingsProcessed: number;
  criticalBugsFound: number;
  feedbackScore: number; // 1-10
  passed: boolean;
}

export interface LaunchGateReport {
  timestamp: string;
  decision: LaunchDecision;
  decisionAr: string;

  // Audit summaries
  securityPassed: boolean;
  accessibilityPassed: boolean;
  i18nPassed: boolean;
  e2ePassed: boolean;
  performancePassed: boolean;
  opsPassed: boolean;

  // External blockers
  blockers: LaunchBlocker[];
  unresolvedBlockers: number;

  // Closed beta
  closedBetaResults: ClosedBetaResult[];
  closedBetaPassed: boolean;

  // Critical bugs
  criticalBugCount: number;
  criticalBugsPassed: boolean;

  // Legal review
  legalReviewCompleted: boolean;

  // Summary
  totalCriteria: number;
  metCriteria: number;
  reasons: string[];
  reasonsAr: string[];
}

// ---------------------------------------------------------------------------
// Default blockers from PHASES.md
// ---------------------------------------------------------------------------

export function getDefaultBlockers(): LaunchBlocker[] {
  return [
    {
      id: 'OQ-004',
      title: 'Legal framework — entity registration, CITC, CBAHI approvals',
      titleAr: 'الإطار القانوني — تسجيل الكيان، هيئة الاتصالات، المجلس الصحي',
      resolved: false,
      owner: 'Legal / CEO',
    },
    {
      id: 'OQ-017',
      title: 'Hosting & data localisation — KSA-resident hosting confirmed',
      titleAr: 'الاستضافة وتوطين البيانات — تأكيد الاستضافة داخل المملكة',
      resolved: false,
      owner: 'CTO / DevOps',
    },
    {
      id: 'OQ-018',
      title: 'Retention & deletion policy — PDPL compliance schedule',
      titleAr: 'سياسة الاحتفاظ والحذف — جدول امتثال PDPL',
      resolved: false,
      owner: 'Legal / DPO',
    },
    {
      id: 'OQ-037',
      title: 'Policy texts — ToS, Privacy Policy, Medical Disclaimer finalised',
      titleAr: 'نصوص السياسات — شروط الاستخدام، الخصوصية، إخلاء المسؤولية',
      resolved: false,
      owner: 'Legal / Product',
    },
  ];
}

// ---------------------------------------------------------------------------
// Launch gate evaluation
// ---------------------------------------------------------------------------

export interface LaunchGateInput {
  securityReport: SecurityAuditReport;
  a11yReport: A11yAuditReport;
  i18nReport: I18nAuditReport;
  e2eReport: JourneyReport;
  perfReport: PerfAuditReport;
  opsReport: OpsReadinessReport;
  blockers: LaunchBlocker[];
  closedBetaResults: ClosedBetaResult[];
  criticalBugCount: number;
  legalReviewCompleted: boolean;
}

export function evaluateLaunchGate(input: LaunchGateInput): LaunchGateReport {
  const reasons: string[] = [];
  const reasonsAr: string[] = [];

  // Evaluate each audit
  const securityPassed = input.securityReport.overallPass;
  const accessibilityPassed = input.a11yReport.overallPass;
  const i18nPassed = input.i18nReport.overallPass;
  const e2ePassed = input.e2eReport.overallPass;
  const performancePassed = input.perfReport.overallPass;
  const opsPassed = input.opsReport.overallPass;

  if (!securityPassed) {
    reasons.push(`Security audit failed: ${input.securityReport.critical} critical, ${input.securityReport.high} high findings.`);
    reasonsAr.push(`المراجعة الأمنية فشلت: ${input.securityReport.critical} حرج، ${input.securityReport.high} عالي.`);
  }
  if (!accessibilityPassed) {
    reasons.push(`Accessibility audit failed: ${input.a11yReport.criticalFailures} critical failures.`);
    reasonsAr.push(`مراجعة إمكانية الوصول فشلت: ${input.a11yReport.criticalFailures} خلل حرج.`);
  }
  if (!i18nPassed) {
    reasons.push('Bilingual completeness audit failed.');
    reasonsAr.push('مراجعة اكتمال اللغتين فشلت.');
  }
  if (!e2ePassed) {
    reasons.push(`E2E journey failed at: ${input.e2eReport.firstFailure}.`);
    reasonsAr.push(`الرحلة الكاملة فشلت عند: ${input.e2eReport.firstFailure}.`);
  }
  if (!performancePassed) {
    reasons.push('Performance audit has critical findings.');
    reasonsAr.push('مراجعة الأداء بها نتائج حرجة.');
  }
  if (!opsPassed) {
    reasons.push('Operational readiness audit failed.');
    reasonsAr.push('مراجعة الجاهزية التشغيلية فشلت.');
  }

  // External blockers
  const unresolvedBlockers = input.blockers.filter(b => !b.resolved).length;
  if (unresolvedBlockers > 0) {
    const unresolved = input.blockers.filter(b => !b.resolved).map(b => b.id);
    reasons.push(`${unresolvedBlockers} unresolved blocker(s): ${unresolved.join(', ')}.`);
    reasonsAr.push(`${unresolvedBlockers} عائق غير محلول: ${unresolved.join(', ')}.`);
  }

  // Closed beta
  const closedBetaPassed = input.closedBetaResults.length > 0 &&
    input.closedBetaResults.every(r => r.passed);
  if (!closedBetaPassed) {
    if (input.closedBetaResults.length === 0) {
      reasons.push('No closed beta results — at least 1–2 clinics required.');
      reasonsAr.push('لا توجد نتائج تجربة مغلقة — مطلوب عيادة أو عيادتان.');
    } else {
      const failed = input.closedBetaResults.filter(r => !r.passed);
      reasons.push(`Closed beta: ${failed.length} clinic(s) did not pass.`);
      reasonsAr.push(`التجربة المغلقة: ${failed.length} عيادة لم تنجح.`);
    }
  }

  // Critical bugs
  const criticalBugsPassed = input.criticalBugCount === 0;
  if (!criticalBugsPassed) {
    reasons.push(`${input.criticalBugCount} critical bug(s) remain open.`);
    reasonsAr.push(`${input.criticalBugCount} خطأ حرج مفتوح.`);
  }

  // Legal review
  if (!input.legalReviewCompleted) {
    reasons.push('Local legal review not completed.');
    reasonsAr.push('المراجعة القانونية المحلية لم تكتمل.');
  }

  // Count criteria
  const criteria = [
    securityPassed,
    accessibilityPassed,
    i18nPassed,
    e2ePassed,
    performancePassed,
    opsPassed,
    unresolvedBlockers === 0,
    closedBetaPassed,
    criticalBugsPassed,
    input.legalReviewCompleted,
  ];

  const totalCriteria = criteria.length;
  const metCriteria = criteria.filter(Boolean).length;

  // Decision logic
  let decision: LaunchDecision;
  let decisionAr: string;

  if (metCriteria === totalCriteria) {
    decision = 'GO';
    decisionAr = '🚀 موافقة — جاهز للإطلاق التجاري';
  } else if (criticalBugsPassed && securityPassed && closedBetaPassed) {
    decision = 'CONDITIONAL';
    decisionAr = '⚠️ موافقة مشروطة — بعض المعايير غير مكتملة';
  } else {
    decision = 'NO_GO';
    decisionAr = '🛑 عدم موافقة — معايير حرجة غير مستوفاة';
  }

  return {
    timestamp: new Date().toISOString(),
    decision,
    decisionAr,
    securityPassed,
    accessibilityPassed,
    i18nPassed,
    e2ePassed,
    performancePassed,
    opsPassed,
    blockers: input.blockers,
    unresolvedBlockers,
    closedBetaResults: input.closedBetaResults,
    closedBetaPassed,
    criticalBugCount: input.criticalBugCount,
    criticalBugsPassed,
    legalReviewCompleted: input.legalReviewCompleted,
    totalCriteria,
    metCriteria,
    reasons,
    reasonsAr,
  };
}
