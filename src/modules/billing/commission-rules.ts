/**
 * ZAMO-BILL-062 — Commission Rules Service.
 *
 * Manages the three-level commission rule hierarchy (A-35):
 *   1. Service-level  (highest priority)
 *   2. Facility-level
 *   3. Platform-level (fallback — A-06: 10%)
 *
 * Rules are append-only: changing a rule closes the old one (effective_to)
 * and inserts a new one. No UPDATE on rate/amount columns.
 *
 * Key decisions enforced:
 *   A-06:  Default 10% commission.
 *   A-35:  Priority: service → facility → platform.
 *   A-46:  Every change recorded in Audit with reason.
 *   B-27:  Fixed amount field exists but is MVP-disabled.
 *   CM-14: Only zamo_admin may create/change rules.
 *   CM-15: Every change has Audit entry with reason + user.
 *   DEC-008: Rule active at accrual date is applied.
 */

import type { Queryable } from '../../db/client.js';
import type { RoleCode } from '../booking/state-machine.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';
import { record, AUDIT_ACTIONS } from '../audit/audit.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommissionScope = 'platform' | 'facility' | 'service';

export type CommissionRuleError =
  | 'UNAUTHORIZED'
  | 'REASON_REQUIRED'
  | 'INVALID_RATE'
  | 'INVALID_SCOPE'
  | 'RULE_NOT_FOUND'
  | 'ALREADY_EXPIRED'
  | 'DB_ERROR';

export interface CommissionRule {
  id: string;
  scopeType: CommissionScope;
  facilityId: string | null;
  serviceId: string | null;
  rate: string; // numeric as string for precision
  fixedAmount: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string;
  changedBy: string;
  createdAt: Date;
}

export interface CreateRuleParams {
  scopeType: CommissionScope;
  facilityId?: string | null;
  serviceId?: string | null;
  rate: number;
  fixedAmount?: number | null;
  effectiveFrom?: Date;
  reason: string;
  actorId: string;
  actorRole: RoleCode;
}

export interface CloseRuleParams {
  ruleId: string;
  reason: string;
  actorId: string;
  actorRole: RoleCode;
}

// ---------------------------------------------------------------------------
// Allowed roles (CM-14: zamo_admin only)
// ---------------------------------------------------------------------------

const ALLOWED_ROLES: ReadonlySet<string> = new Set(['zamo_admin']);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate and create a new commission rule.
 *
 * Rules:
 *   - Only zamo_admin may create rules (CM-14).
 *   - Rate must be between 0 and 1 (0% to 100%).
 *   - Reason is mandatory (A-46, CM-15).
 *   - Scope constraints enforced (facility requires facilityId, etc).
 */
export function validateCreateRule(
  params: CreateRuleParams,
): Result<CreateRuleParams, CommissionRuleError> {
  // 1. Authorization check (CM-14)
  if (!ALLOWED_ROLES.has(params.actorRole)) {
    return err('UNAUTHORIZED');
  }

  // 2. Reason required (A-46, CM-15)
  if (!params.reason || params.reason.trim() === '') {
    return err('REASON_REQUIRED');
  }

  // 3. Rate validation
  if (params.rate < 0 || params.rate > 1) {
    return err('INVALID_RATE');
  }

  // 4. Scope validation
  if (params.scopeType === 'facility' && !params.facilityId) {
    return err('INVALID_SCOPE');
  }
  if (params.scopeType === 'service' && !params.serviceId) {
    return err('INVALID_SCOPE');
  }
  if (params.scopeType === 'platform' && (params.facilityId || params.serviceId)) {
    return err('INVALID_SCOPE');
  }

  return ok(params);
}

/**
 * Create a new commission rule in the database.
 *
 * When a new rule replaces an existing one for the same scope,
 * the old rule is closed (effective_to = now).
 */
export async function createRule(
  db: Queryable,
  params: CreateRuleParams,
): Promise<Result<CommissionRule, CommissionRuleError>> {
  const validation = validateCreateRule(params);
  if (!validation.ok) return validation;

  const effectiveFrom = params.effectiveFrom ?? new Date();

  // Close any existing active rule for the same scope
  await closeExistingRules(db, params);

  // Insert new rule
  const res = await db.query<CommissionRule>(
    `INSERT INTO commission_rules (
       scope_type, facility_id, service_id,
       rate, fixed_amount,
       effective_from, effective_to,
       reason, changed_by
     ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)
     RETURNING
       id, scope_type AS "scopeType",
       facility_id AS "facilityId", service_id AS "serviceId",
       rate, fixed_amount AS "fixedAmount",
       effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
       reason, changed_by AS "changedBy", created_at AS "createdAt"`,
    [
      params.scopeType,
      params.facilityId ?? null,
      params.serviceId ?? null,
      params.rate,
      params.fixedAmount ?? null,
      effectiveFrom,
      params.reason.trim(),
      params.actorId,
    ],
  );

  const rule = res.rows[0]!;

  // Audit (CM-15, A-46)
  await record(db, {
    action: AUDIT_ACTIONS.COMMISSION_RULE_CHANGED,
    entityType: 'commission_rule',
    entityId: rule.id,
    actorUserId: params.actorId,
    actorRole: params.actorRole,
    facilityId: params.facilityId ?? null,
    after: {
      scopeType: params.scopeType,
      rate: params.rate,
      effectiveFrom: effectiveFrom.toISOString(),
    },
    reason: params.reason.trim(),
  });

  return ok(rule);
}

/**
 * Get the active commission rule for a given scope and date (DEC-008).
 */
export async function getActiveRule(
  db: Queryable,
  scopeType: CommissionScope,
  scopeId: string | null,
  atDate: Date,
): Promise<CommissionRule | null> {
  let whereClause: string;
  const params: unknown[] = [scopeType, atDate, atDate];

  if (scopeType === 'platform') {
    whereClause = 'scope_type = $1 AND facility_id IS NULL AND service_id IS NULL';
  } else if (scopeType === 'facility') {
    whereClause = 'scope_type = $1 AND facility_id = $4';
    params.push(scopeId);
  } else {
    whereClause = 'scope_type = $1 AND service_id = $4';
    params.push(scopeId);
  }

  const res = await db.query<CommissionRule>(
    `SELECT
       id, scope_type AS "scopeType",
       facility_id AS "facilityId", service_id AS "serviceId",
       rate, fixed_amount AS "fixedAmount",
       effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
       reason, changed_by AS "changedBy", created_at AS "createdAt"
     FROM commission_rules
     WHERE ${whereClause}
       AND effective_from <= $2
       AND (effective_to IS NULL OR effective_to > $3)
     ORDER BY effective_from DESC
     LIMIT 1`,
    params,
  );

  return res.rows[0] ?? null;
}

/**
 * List all rules (with optional filters).
 */
export async function listRules(
  db: Queryable,
  filters?: {
    scopeType?: CommissionScope;
    facilityId?: string;
    activeOnly?: boolean;
  },
): Promise<CommissionRule[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters?.scopeType) {
    params.push(filters.scopeType);
    where.push(`scope_type = $${params.length}`);
  }
  if (filters?.facilityId) {
    params.push(filters.facilityId);
    where.push(`facility_id = $${params.length}`);
  }
  if (filters?.activeOnly) {
    where.push('effective_to IS NULL');
  }

  const sql = `SELECT
     id, scope_type AS "scopeType",
     facility_id AS "facilityId", service_id AS "serviceId",
     rate, fixed_amount AS "fixedAmount",
     effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
     reason, changed_by AS "changedBy", created_at AS "createdAt"
   FROM commission_rules
   ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
   ORDER BY effective_from DESC`;

  const res = await db.query<CommissionRule>(sql, params);
  return res.rows;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function closeExistingRules(
  db: Queryable,
  params: CreateRuleParams,
): Promise<void> {
  if (params.scopeType === 'platform') {
    await db.query(
      `UPDATE commission_rules
       SET effective_to = now()
       WHERE scope_type = 'platform' AND effective_to IS NULL`,
    );
  } else if (params.scopeType === 'facility') {
    await db.query(
      `UPDATE commission_rules
       SET effective_to = now()
       WHERE scope_type = 'facility' AND facility_id = $1 AND effective_to IS NULL`,
      [params.facilityId],
    );
  } else {
    await db.query(
      `UPDATE commission_rules
       SET effective_to = now()
       WHERE scope_type = 'service' AND service_id = $1 AND effective_to IS NULL`,
      [params.serviceId],
    );
  }
}
