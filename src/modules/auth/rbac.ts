import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';

/**
 * ZAMO-RBAC-010 — three-layer authorization.
 *
 * DEC-004 mandates dual enforcement:
 *   Layer 1 (this module): Role check — does the user have the required role?
 *   Layer 2 (this module): Tenant scope — is the user accessing their own facility?
 *   Layer 3 (database):    RLS policies — safety net if code bypasses Layer 1/2.
 *
 * Every request handler MUST call `authorize()` before performing any action.
 * There are no exceptions. An unauthenticated request must fail at session
 * validation (AUTH-009) before it even reaches this module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthzError =
  | 'NO_SESSION'
  | 'INSUFFICIENT_ROLE'
  | 'WRONG_FACILITY'
  | 'WRONG_BRANCH'
  | 'PERMISSION_DENIED';

export interface AuthzContext {
  userId: string;
  roleCode: string;
  facilityId: string | null;
  branchId: string | null;
  /** All branch IDs the user has access to. */
  branchIds: string[];
}

export interface AuthzRequirement {
  /** Roles that are allowed to perform this action. */
  allowedRoles: string[];
  /** If set, the action is scoped to this facility. */
  facilityId?: string;
  /** If set, the action is scoped to this branch. */
  branchId?: string;
  /** Named permission code (e.g., 'manage_prices'). If set, checked against role_permissions. */
  permission?: string;
}

// ---------------------------------------------------------------------------
// Role hierarchy (for inheritance checks)
// ---------------------------------------------------------------------------

/**
 * Roles ordered by privilege level (highest first).
 * zamo_admin > facility_manager > branch_manager > others.
 */
const ROLE_HIERARCHY: Record<string, number> = {
  zamo_admin: 100,
  facility_manager: 80,
  branch_manager: 60,
  accountant: 40,
  doctor: 40,
  receptionist: 30,
  patient: 10,
};

function roleLevel(roleCode: string): number {
  return ROLE_HIERARCHY[roleCode] ?? 0;
}

// ---------------------------------------------------------------------------
// Authorization service
// ---------------------------------------------------------------------------

export interface AuthzService {
  /**
   * Check if the current user is authorized to perform an action.
   * Returns the AuthzContext if authorized, or an error if not.
   */
  authorize(
    ctx: AuthzContext,
    requirement: AuthzRequirement,
  ): Promise<Result<AuthzContext, AuthzError>>;

  /**
   * Set RLS session variables on the database connection.
   * Must be called before any database query in a request handler.
   */
  setSessionVars(db: Queryable, ctx: AuthzContext): Promise<void>;
}

export function createAuthzService(db: Queryable): AuthzService {
  return {
    async authorize(ctx, requirement) {
      // Layer 1: Role check
      if (!requirement.allowedRoles.includes(ctx.roleCode)) {
        // Check if the user has a higher-privilege role that implicitly includes access
        const userLevel = roleLevel(ctx.roleCode);
        const maxRequired = Math.max(
          ...requirement.allowedRoles.map(roleLevel),
        );
        if (userLevel <= maxRequired) {
          return err('INSUFFICIENT_ROLE');
        }
      }

      // Layer 2a: Facility scope
      if (requirement.facilityId !== undefined) {
        // zamo_admin can access any facility
        if (ctx.roleCode !== 'zamo_admin') {
          if (ctx.facilityId !== requirement.facilityId) {
            return err('WRONG_FACILITY');
          }
        }
      }

      // Layer 2b: Branch scope
      if (requirement.branchId !== undefined) {
        if (ctx.roleCode !== 'zamo_admin' && ctx.roleCode !== 'facility_manager') {
          if (!ctx.branchIds.includes(requirement.branchId)) {
            return err('WRONG_BRANCH');
          }
        }
      }

      // Layer 2c: Permission check (if specified)
      if (requirement.permission !== undefined) {
        const hasPermission = await db.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM role_permissions
           WHERE role_code = $1 AND permission_code = $2`,
          [ctx.roleCode, requirement.permission],
        );
        const cnt = parseInt(hasPermission.rows[0]!.cnt, 10);
        if (cnt === 0) {
          return err('PERMISSION_DENIED');
        }
      }

      return ok(ctx);
    },

    async setSessionVars(targetDb, ctx) {
      // SECURITY: Use parameterized queries to prevent SQL injection.
      // SET ROLE cannot be parameterized, but uses a fixed literal.
      await targetDb.exec('SET ROLE zamo_app');
      await targetDb.query(
        `SELECT
           set_config('zamo.user_id',     $1, false),
           set_config('zamo.facility_id', $2, false),
           set_config('zamo.branch_ids',  $3, false),
           set_config('zamo.role_code',   $4, false)`,
        [ctx.userId, ctx.facilityId ?? '', ctx.branchIds.join(','), ctx.roleCode],
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Permission constants (matching the seeded permissions in 0001)
// ---------------------------------------------------------------------------

export const PERMISSIONS = {
  // Booking
  CREATE_BOOKING: 'create_booking',
  CONFIRM_BOOKING: 'confirm_booking',
  REJECT_BOOKING: 'reject_booking',
  CANCEL_BOOKING: 'cancel_booking',

  // Service & collection
  RECORD_ATTENDANCE: 'record_attendance',
  RECORD_SERVICE: 'record_service',
  COLLECT_PAYMENT: 'collect_payment',
  APPROVE_VALUE: 'approve_value',

  // Pricing & commission
  MANAGE_PRICES: 'manage_prices',
  APPROVE_PRICES: 'approve_prices',
  MANAGE_COMMISSION: 'manage_commission',

  // Facility management
  MANAGE_FACILITY: 'manage_facility',
  MANAGE_BRANCHES: 'manage_branches',
  MANAGE_STAFF: 'manage_staff',
  VIEW_REPORTS: 'view_reports',

  // Platform admin
  APPROVE_FACILITY: 'approve_facility',
  MANAGE_PLATFORM: 'manage_platform',
} as const;
