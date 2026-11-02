import type { Queryable } from '../../db/client.ts';

/**
 * ZAMO-AUDIT-004 — the single write path into the audit log.
 *
 * Approved decision A-46 requires an indelible record of financial changes,
 * and [S1] enumerates ten operations that must be recorded. Every module
 * writes through this module so the shape stays uniform and nothing can
 * quietly skip the log.
 *
 * The log is append-only at the database level; there is deliberately no
 * update or delete function here, and none can be added that would work.
 */

/** The ten operations [S1] requires to be recorded, plus the actions they cover. */
export const AUDIT_ACTIONS = {
  // 1. Sign-in activity
  LOGIN_SUCCEEDED: 'login.succeeded',
  LOGIN_FAILED: 'login.failed',
  LOGOUT: 'logout',
  SESSION_EXPIRED: 'session.expired',
  SESSION_REVOKED: 'session.revoked',

  // 2. Permission changes
  ROLE_GRANTED: 'role.granted',
  ROLE_REVOKED: 'role.revoked',
  PERMISSION_CHANGED: 'permission.changed',

  // 3. Facility approval
  FACILITY_SUBMITTED: 'facility.submitted',
  FACILITY_APPROVED: 'facility.approved',
  FACILITY_REJECTED: 'facility.rejected',
  FACILITY_SUSPENDED: 'facility.suspended',

  // 4. Price changes
  PRICE_CHANGED: 'price.changed',
  PRICE_APPROVED: 'price.approved',

  // 5. Commission changes
  COMMISSION_RULE_CHANGED: 'commission.rule_changed',

  // 6. Booking status changes
  BOOKING_STATUS_CHANGED: 'booking.status_changed',

  // 7. Collected-value approval
  VALUE_SUBMITTED: 'value.submitted',
  VALUE_APPROVED: 'value.approved',
  VALUE_REJECTED: 'value.rejected',

  // 8. Invoice changes
  INVOICE_ISSUED: 'invoice.issued',
  INVOICE_ADJUSTED: 'invoice.adjusted',

  // 9. Data export
  DATA_EXPORTED: 'data.exported',

  // 10. OTP / verification attempts
  OTP_REQUESTED: 'otp.requested',
  OTP_VERIFIED: 'otp.verified',
  OTP_FAILED: 'otp.failed',

  // Account lifecycle
  USER_CREATED: 'user.created',
  USER_DEACTIVATED: 'user.deactivated',
  MFA_ENABLED: 'mfa.enabled',
  MFA_ENFORCED: 'mfa.enforced',
  INVITATION_SENT: 'invitation.sent',
  INVITATION_ACCEPTED: 'invitation.accepted',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * Actions that touch money. A-46 singles these out, and `requireReason`
 * below refuses to record them without an explanation.
 */
const FINANCIAL_ACTIONS = new Set<string>([
  AUDIT_ACTIONS.PRICE_CHANGED,
  AUDIT_ACTIONS.PRICE_APPROVED,
  AUDIT_ACTIONS.COMMISSION_RULE_CHANGED,
  AUDIT_ACTIONS.VALUE_SUBMITTED,
  AUDIT_ACTIONS.VALUE_APPROVED,
  AUDIT_ACTIONS.VALUE_REJECTED,
  AUDIT_ACTIONS.INVOICE_ISSUED,
  AUDIT_ACTIONS.INVOICE_ADJUSTED,
]);

/**
 * Actions that may not be recorded without a stated reason.
 * A-21: Zamo may not change a confirmed booking without recording why.
 */
const REASON_REQUIRED = new Set<string>([
  AUDIT_ACTIONS.COMMISSION_RULE_CHANGED,
  AUDIT_ACTIONS.PRICE_CHANGED,
  AUDIT_ACTIONS.VALUE_REJECTED,
  AUDIT_ACTIONS.INVOICE_ADJUSTED,
  AUDIT_ACTIONS.FACILITY_REJECTED,
  AUDIT_ACTIONS.FACILITY_SUSPENDED,
]);

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;

  actorUserId?: string | null;
  actorRole?: string | null;
  actorIp?: string | null;
  requestId?: string | null;

  facilityId?: string | null;
  branchId?: string | null;

  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export class AuditReasonRequiredError extends Error {
  constructor(action: string) {
    super(`Audit action "${action}" requires a reason (approved decisions A-21 / A-46)`);
    this.name = 'AuditReasonRequiredError';
  }
}

export function isFinancialAction(action: string): boolean {
  return FINANCIAL_ACTIONS.has(action);
}

export function requiresReason(action: string): boolean {
  return REASON_REQUIRED.has(action);
}

/**
 * Append one entry. Returns the new entry's id.
 *
 * Pass the same `tx` as the operation being recorded so the write and its
 * audit entry commit or roll back together — an operation must never succeed
 * with its audit record missing.
 */
export async function record(db: Queryable, entry: AuditEntry): Promise<string> {
  const reason = entry.reason?.trim() ?? '';
  if (requiresReason(entry.action) && reason === '') {
    throw new AuditReasonRequiredError(entry.action);
  }

  const res = await db.query<{ id: string }>(
    `INSERT INTO audit_log (
       actor_user_id, actor_role, actor_ip, request_id,
       action, entity_type, entity_id,
       facility_id, branch_id,
       before_state, after_state, reason, is_financial
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      entry.actorUserId ?? null,
      entry.actorRole ?? null,
      entry.actorIp ?? null,
      entry.requestId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.facilityId ?? null,
      entry.branchId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      reason === '' ? null : reason,
      isFinancialAction(entry.action),
    ],
  );
  return String(res.rows[0]!.id);
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  facilityId?: string;
  financialOnly?: boolean;
  limit?: number;
}

export interface AuditRow {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  facility_id: string | null;
  before_state: unknown;
  after_state: unknown;
  reason: string | null;
  is_financial: boolean;
}

/** Read the trail. Filtering by facility is what makes an audit reviewable. */
export async function search(db: Queryable, q: AuditQuery = {}): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown): void => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  if (q.entityType !== undefined) add('entity_type = ?', q.entityType);
  if (q.entityId !== undefined) add('entity_id = ?', q.entityId);
  if (q.actorUserId !== undefined) add('actor_user_id = ?', q.actorUserId);
  if (q.facilityId !== undefined) add('facility_id = ?', q.facilityId);
  if (q.financialOnly === true) where.push('is_financial');

  const limit = Math.min(q.limit ?? 100, 1000);
  const sql = `SELECT * FROM audit_log
               ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY occurred_at DESC, id DESC
               LIMIT ${limit}`;

  const res = await db.query<AuditRow>(sql, params);
  return res.rows;
}
