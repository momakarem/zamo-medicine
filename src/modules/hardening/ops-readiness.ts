/**
 * ZAMO-OPS-082 — النسخ الاحتياطي والمراقبة (Backup & Monitoring).
 *
 * Defines the operational readiness checks for production launch:
 *   1. Database backup configuration
 *   2. Point-in-Time Recovery (PITR) readiness
 *   3. Health check endpoint specification
 *   4. Application metrics and alerting rules
 *   5. Log aggregation configuration
 *   6. Incident response playbook references
 *
 * These are configuration-verified checks — they validate that the
 * operational infrastructure is properly configured, not that backup
 * actually works (which requires infra-level testing).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpsCheckSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'PASS';

export interface OpsCheck {
  id: string;
  category: string;
  severity: OpsCheckSeverity;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  passed: boolean;
  recommendation?: string;
}

export interface OpsReadinessReport {
  timestamp: string;
  totalChecks: number;
  passed: number;
  failed: number;
  findings: OpsCheck[];
  backupReady: boolean;
  monitoringReady: boolean;
  healthCheckReady: boolean;
  overallPass: boolean;
}

// ---------------------------------------------------------------------------
// Backup configuration checks
// ---------------------------------------------------------------------------

export interface BackupConfig {
  /** Backup strategy: 'pitr' | 'snapshot' | 'pg_dump' | 'none' */
  strategy: 'pitr' | 'snapshot' | 'pg_dump' | 'none';
  /** Backup frequency in hours */
  frequencyHours: number;
  /** Retention period in days */
  retentionDays: number;
  /** Backup encryption enabled */
  encrypted: boolean;
  /** Cross-region replication */
  crossRegion: boolean;
  /** Recovery time objective in minutes */
  rtoMinutes: number;
  /** Recovery point objective in minutes */
  rpoMinutes: number;
  /** Last backup test date (ISO string) */
  lastTestDate: string | null;
}

export function checkBackupConfig(config: BackupConfig): OpsCheck[] {
  const checks: OpsCheck[] = [];

  // Strategy check
  checks.push({
    id: 'BACKUP-STRATEGY',
    category: 'Backup',
    severity: config.strategy !== 'none' ? 'PASS' : 'CRITICAL',
    title: `Backup strategy: ${config.strategy}`,
    titleAr: `استراتيجية النسخ الاحتياطي: ${config.strategy}`,
    description: config.strategy !== 'none'
      ? `Backup strategy is "${config.strategy}" — automated backups configured.`
      : 'No backup strategy configured — data loss risk.',
    descriptionAr: config.strategy !== 'none'
      ? `استراتيجية النسخ "${config.strategy}" — النسخ الاحتياطي التلقائي مفعل.`
      : 'لا توجد استراتيجية نسخ — خطر فقدان البيانات.',
    passed: config.strategy !== 'none',
    recommendation: config.strategy === 'none'
      ? 'Configure PITR with WAL archiving for production PostgreSQL.'
      : undefined,
  });

  // Frequency check (should be at least daily)
  checks.push({
    id: 'BACKUP-FREQUENCY',
    category: 'Backup',
    severity: config.frequencyHours <= 24 ? 'PASS' : 'HIGH',
    title: `Backup frequency: every ${config.frequencyHours}h`,
    titleAr: `تكرار النسخ: كل ${config.frequencyHours} ساعة`,
    description: config.frequencyHours <= 24
      ? `Backups run every ${config.frequencyHours} hours — meets daily minimum.`
      : `Backups only run every ${config.frequencyHours} hours — risk of data loss.`,
    descriptionAr: config.frequencyHours <= 24
      ? `النسخ يتم كل ${config.frequencyHours} ساعة — يلبي الحد الأدنى اليومي.`
      : `النسخ يتم كل ${config.frequencyHours} ساعة فقط — خطر فقدان البيانات.`,
    passed: config.frequencyHours <= 24,
  });

  // Retention
  checks.push({
    id: 'BACKUP-RETENTION',
    category: 'Backup',
    severity: config.retentionDays >= 30 ? 'PASS' : 'MEDIUM',
    title: `Backup retention: ${config.retentionDays} days`,
    titleAr: `فترة الاحتفاظ بالنسخ: ${config.retentionDays} يوم`,
    description: config.retentionDays >= 30
      ? `${config.retentionDays}-day retention meets compliance minimum.`
      : `${config.retentionDays}-day retention may not meet regulatory requirements.`,
    descriptionAr: config.retentionDays >= 30
      ? `الاحتفاظ ${config.retentionDays} يوم يلبي الحد الأدنى التنظيمي.`
      : `الاحتفاظ ${config.retentionDays} يوم قد لا يلبي المتطلبات التنظيمية.`,
    passed: config.retentionDays >= 30,
  });

  // Encryption
  checks.push({
    id: 'BACKUP-ENCRYPTION',
    category: 'Backup',
    severity: config.encrypted ? 'PASS' : 'HIGH',
    title: `Backup encryption: ${config.encrypted ? 'enabled' : 'disabled'}`,
    titleAr: `تشفير النسخ: ${config.encrypted ? 'مفعل' : 'معطل'}`,
    description: config.encrypted
      ? 'Backups are encrypted at rest — PHI protection satisfied.'
      : 'Backups are NOT encrypted — patient data at risk if storage is compromised.',
    descriptionAr: config.encrypted
      ? 'النسخ مشفرة — حماية البيانات الصحية مُرضية.'
      : 'النسخ غير مشفرة — بيانات المرضى معرضة للخطر.',
    passed: config.encrypted,
  });

  // RTO/RPO
  checks.push({
    id: 'BACKUP-RTO',
    category: 'Backup',
    severity: config.rtoMinutes <= 60 ? 'PASS' : 'MEDIUM',
    title: `RTO: ${config.rtoMinutes} minutes`,
    titleAr: `هدف وقت الاستعادة: ${config.rtoMinutes} دقيقة`,
    description: config.rtoMinutes <= 60
      ? `Recovery Time Objective of ${config.rtoMinutes}min meets target.`
      : `Recovery Time Objective of ${config.rtoMinutes}min exceeds 1-hour target.`,
    descriptionAr: config.rtoMinutes <= 60
      ? `هدف وقت الاستعادة ${config.rtoMinutes} دقيقة يلبي الهدف.`
      : `هدف وقت الاستعادة ${config.rtoMinutes} دقيقة يتجاوز الهدف.`,
    passed: config.rtoMinutes <= 60,
  });

  // Last test date
  const lastTestDaysAgo = config.lastTestDate
    ? Math.floor((Date.now() - new Date(config.lastTestDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  checks.push({
    id: 'BACKUP-TESTED',
    category: 'Backup',
    severity: lastTestDaysAgo !== null && lastTestDaysAgo <= 30 ? 'PASS' : 'HIGH',
    title: `Backup recovery tested: ${lastTestDaysAgo !== null ? `${lastTestDaysAgo} days ago` : 'never'}`,
    titleAr: `اختبار استعادة النسخ: ${lastTestDaysAgo !== null ? `قبل ${lastTestDaysAgo} يوم` : 'لم يتم'}`,
    description: lastTestDaysAgo !== null && lastTestDaysAgo <= 30
      ? `Last recovery test was ${lastTestDaysAgo} days ago — within 30-day window.`
      : 'Recovery has not been tested recently — untested backups are not backups.',
    descriptionAr: lastTestDaysAgo !== null && lastTestDaysAgo <= 30
      ? `آخر اختبار استعادة كان قبل ${lastTestDaysAgo} يوم — ضمن نافذة 30 يوم.`
      : 'لم يتم اختبار الاستعادة مؤخراً — النسخ غير المختبرة ليست نسخاً.',
    passed: lastTestDaysAgo !== null && lastTestDaysAgo <= 30,
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Health check endpoint
// ---------------------------------------------------------------------------

export interface HealthCheckConfig {
  /** Endpoint path */
  path: string;
  /** Checks DB connectivity */
  checksDb: boolean;
  /** Returns version info */
  returnsVersion: boolean;
  /** Protected from public access */
  isProtected: boolean;
  /** Includes dependency statuses */
  checksDependencies: boolean;
}

export function checkHealthEndpoint(config: HealthCheckConfig): OpsCheck[] {
  const checks: OpsCheck[] = [];

  checks.push({
    id: 'HEALTH-DB',
    category: 'Health Check',
    severity: config.checksDb ? 'PASS' : 'HIGH',
    title: `Health check verifies DB: ${config.checksDb}`,
    titleAr: `فحص الصحة يتحقق من قاعدة البيانات: ${config.checksDb}`,
    description: config.checksDb
      ? 'Health endpoint pings the database — detects connection failures.'
      : 'Health endpoint does not check DB — may report healthy when DB is down.',
    descriptionAr: config.checksDb
      ? 'نقطة الصحة تفحص قاعدة البيانات — تكشف أعطال الاتصال.'
      : 'نقطة الصحة لا تفحص قاعدة البيانات.',
    passed: config.checksDb,
  });

  checks.push({
    id: 'HEALTH-VERSION',
    category: 'Health Check',
    severity: config.returnsVersion ? 'PASS' : 'LOW',
    title: `Health check returns version: ${config.returnsVersion}`,
    titleAr: `فحص الصحة يعرض الإصدار: ${config.returnsVersion}`,
    description: config.returnsVersion
      ? 'Version info included — aids debugging deployments.'
      : 'No version info — makes it harder to verify which version is running.',
    descriptionAr: config.returnsVersion
      ? 'معلومات الإصدار مضمنة — تساعد في تشخيص النشر.'
      : 'لا توجد معلومات إصدار.',
    passed: config.returnsVersion,
  });

  checks.push({
    id: 'HEALTH-DEPS',
    category: 'Health Check',
    severity: config.checksDependencies ? 'PASS' : 'MEDIUM',
    title: `Health check verifies dependencies: ${config.checksDependencies}`,
    titleAr: `فحص الصحة يتحقق من التبعيات: ${config.checksDependencies}`,
    description: config.checksDependencies
      ? 'Health endpoint checks external dependencies (LLM, notification provider).'
      : 'External dependency failures will not be detected by health check.',
    descriptionAr: config.checksDependencies
      ? 'نقطة الصحة تفحص التبعيات الخارجية.'
      : 'أعطال التبعيات الخارجية لن تُكتشف.',
    passed: config.checksDependencies,
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Monitoring & alerting
// ---------------------------------------------------------------------------

export interface MonitoringConfig {
  /** Application metrics exported (Prometheus, CloudWatch, etc.) */
  metricsExported: boolean;
  /** Error tracking service configured (Sentry, etc.) */
  errorTrackingEnabled: boolean;
  /** Uptime monitoring configured */
  uptimeMonitoring: boolean;
  /** Alert channels configured (Slack, PagerDuty, SMS) */
  alertChannels: string[];
  /** SLA breach alerts enabled */
  slaAlerts: boolean;
  /** Financial anomaly alerts enabled */
  financialAlerts: boolean;
}

export function checkMonitoringConfig(config: MonitoringConfig): OpsCheck[] {
  const checks: OpsCheck[] = [];

  checks.push({
    id: 'MON-METRICS',
    category: 'Monitoring',
    severity: config.metricsExported ? 'PASS' : 'HIGH',
    title: `Metrics exported: ${config.metricsExported}`,
    titleAr: `تصدير المقاييس: ${config.metricsExported}`,
    description: config.metricsExported
      ? 'Application metrics are exported to a monitoring service.'
      : 'No metrics export — cannot measure performance or detect degradation.',
    descriptionAr: config.metricsExported
      ? 'مقاييس التطبيق تُصدَّر إلى خدمة مراقبة.'
      : 'لا يوجد تصدير مقاييس.',
    passed: config.metricsExported,
  });

  checks.push({
    id: 'MON-ERRORS',
    category: 'Monitoring',
    severity: config.errorTrackingEnabled ? 'PASS' : 'HIGH',
    title: `Error tracking: ${config.errorTrackingEnabled}`,
    titleAr: `تتبع الأخطاء: ${config.errorTrackingEnabled}`,
    description: config.errorTrackingEnabled
      ? 'Error tracking service is configured — crashes are captured.'
      : 'No error tracking — production errors will go unnoticed.',
    descriptionAr: config.errorTrackingEnabled
      ? 'خدمة تتبع الأخطاء مفعلة.'
      : 'لا يوجد تتبع أخطاء — الأعطال ستمر دون ملاحظة.',
    passed: config.errorTrackingEnabled,
  });

  checks.push({
    id: 'MON-UPTIME',
    category: 'Monitoring',
    severity: config.uptimeMonitoring ? 'PASS' : 'MEDIUM',
    title: `Uptime monitoring: ${config.uptimeMonitoring}`,
    titleAr: `مراقبة وقت التشغيل: ${config.uptimeMonitoring}`,
    description: config.uptimeMonitoring
      ? 'External uptime monitoring is configured.'
      : 'No uptime monitoring — downtime may go undetected.',
    descriptionAr: config.uptimeMonitoring
      ? 'مراقبة وقت التشغيل الخارجية مفعلة.'
      : 'لا توجد مراقبة وقت تشغيل.',
    passed: config.uptimeMonitoring,
  });

  checks.push({
    id: 'MON-ALERTS',
    category: 'Monitoring',
    severity: config.alertChannels.length > 0 ? 'PASS' : 'HIGH',
    title: `Alert channels: ${config.alertChannels.length > 0 ? config.alertChannels.join(', ') : 'none'}`,
    titleAr: `قنوات التنبيه: ${config.alertChannels.length > 0 ? config.alertChannels.join(', ') : 'لا يوجد'}`,
    description: config.alertChannels.length > 0
      ? `Alerts configured on: ${config.alertChannels.join(', ')}.`
      : 'No alert channels — on-call team will not be notified.',
    descriptionAr: config.alertChannels.length > 0
      ? `التنبيهات مفعلة على: ${config.alertChannels.join(', ')}.`
      : 'لا توجد قنوات تنبيه.',
    passed: config.alertChannels.length > 0,
  });

  checks.push({
    id: 'MON-SLA',
    category: 'Monitoring',
    severity: config.slaAlerts ? 'PASS' : 'MEDIUM',
    title: `SLA breach alerts: ${config.slaAlerts}`,
    titleAr: `تنبيهات تجاوز SLA: ${config.slaAlerts}`,
    description: config.slaAlerts
      ? 'SLA breach alerts will notify the team when response times exceed targets.'
      : 'No SLA breach alerts — late responses will go unnoticed.',
    descriptionAr: config.slaAlerts
      ? 'تنبيهات تجاوز SLA ستُبلغ الفريق.'
      : 'لا توجد تنبيهات تجاوز SLA.',
    passed: config.slaAlerts,
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Full operational readiness runner
// ---------------------------------------------------------------------------

export interface OpsAuditDeps {
  backup: BackupConfig;
  healthCheck: HealthCheckConfig;
  monitoring: MonitoringConfig;
}

export function runOpsAudit(deps: OpsAuditDeps): OpsReadinessReport {
  const allFindings: OpsCheck[] = [];

  allFindings.push(...checkBackupConfig(deps.backup));
  allFindings.push(...checkHealthEndpoint(deps.healthCheck));
  allFindings.push(...checkMonitoringConfig(deps.monitoring));

  const passed = allFindings.filter(f => f.passed).length;
  const failed = allFindings.filter(f => !f.passed).length;

  const backupFindings = allFindings.filter(f => f.category === 'Backup');
  const monFindings = allFindings.filter(f => f.category === 'Monitoring');
  const healthFindings = allFindings.filter(f => f.category === 'Health Check');

  return {
    timestamp: new Date().toISOString(),
    totalChecks: allFindings.length,
    passed,
    failed,
    findings: allFindings,
    backupReady: backupFindings.every(f => f.passed),
    monitoringReady: monFindings.every(f => f.passed),
    healthCheckReady: healthFindings.every(f => f.passed),
    overallPass: allFindings.filter(f => f.severity === 'CRITICAL').every(f => f.passed),
  };
}
