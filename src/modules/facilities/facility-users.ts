import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';

/**
 * ZAMO-RBAC-018 — facility user management.
 *
 * [S2]: "دعوة + دور + فرع + إيقاف + فرض MFA"
 * Facility managers manage their own users, roles, and MFA policies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FacilityUserError =
  | 'USER_NOT_FOUND'
  | 'INVALID_ROLE'
  | 'CANNOT_ESCALATE'
  | 'USER_NOT_IN_FACILITY'
  | 'ROLE_ALREADY_ASSIGNED';

/** Roles that a facility_manager can assign (cannot assign platform-scoped roles). */
const FACILITY_ASSIGNABLE_ROLES = new Set([
  'facility_manager',
  'branch_manager',
  'receptionist',
  'doctor',
  'accountant',
]);

/** Roles that a branch_manager can assign (subset). */
const BRANCH_ASSIGNABLE_ROLES = new Set([
  'receptionist',
]);

export interface FacilityUserRow {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  role_code: string;
  branch_id: string | null;
  is_active: boolean;
  mfa_enabled: boolean;
}

export interface AssignRoleInput {
  userId: string;
  roleCode: string;
  facilityId: string;
  branchId?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface FacilityUserService {
  listUsers(facilityId: string): Promise<FacilityUserRow[]>;
  assignRole(input: AssignRoleInput, actorUserId: string, actorRole: string): Promise<Result<void, FacilityUserError>>;
  removeRole(userId: string, roleCode: string, facilityId: string, actorUserId: string): Promise<Result<void, FacilityUserError>>;
  deactivateUser(userId: string, facilityId: string, actorUserId: string): Promise<Result<void, FacilityUserError>>;
  enforceMfa(userId: string, facilityId: string, actorUserId: string): Promise<Result<void, FacilityUserError>>;
}

export function createFacilityUserService(db: Queryable): FacilityUserService {
  return {
    async listUsers(facilityId) {
      const res = await db.query<FacilityUserRow>(
        `SELECT u.id AS user_id, u.full_name, u.phone, u.email,
                ur.role_code, ur.branch_id, u.is_active, u.mfa_enabled
         FROM users u
         JOIN user_roles ur ON u.id = ur.user_id
         WHERE ur.facility_id = $1
         ORDER BY u.full_name`,
        [facilityId],
      );
      return res.rows;
    },

    async assignRole(input, actorUserId, actorRole) {
      // Validate the role is assignable
      if (actorRole === 'facility_manager') {
        if (!FACILITY_ASSIGNABLE_ROLES.has(input.roleCode)) {
          return err('INVALID_ROLE');
        }
      } else if (actorRole === 'branch_manager') {
        if (!BRANCH_ASSIGNABLE_ROLES.has(input.roleCode)) {
          return err('CANNOT_ESCALATE');
        }
      } else if (actorRole !== 'zamo_admin') {
        return err('CANNOT_ESCALATE');
      }

      try {
        await db.query(
          `INSERT INTO user_roles (user_id, role_code, facility_id, branch_id, granted_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [input.userId, input.roleCode, input.facilityId, input.branchId ?? null, actorUserId],
        );
      } catch (e: unknown) {
        const msg = (e as Error).message ?? '';
        // FK violation = user doesn't exist
        if (msg.includes('user_roles_user_id_fkey') || msg.includes('violates foreign key')) {
          return err('USER_NOT_FOUND');
        }
        // Unique violation = role already assigned
        if (msg.includes('user_roles_unique') || msg.includes('duplicate key') || msg.includes('unique constraint')) {
          return err('ROLE_ALREADY_ASSIGNED');
        }
        throw e;
      }

      await record(db, {
        action: AUDIT_ACTIONS.ROLE_GRANTED,
        entityType: 'user_role',
        entityId: input.userId,
        actorUserId,
        facilityId: input.facilityId,
        after: { roleCode: input.roleCode, branchId: input.branchId },
      });

      return ok(undefined);
    },

    async removeRole(userId, roleCode, facilityId, actorUserId) {
      const deleted = await db.query<{ user_id: string }>(
        `DELETE FROM user_roles
         WHERE user_id = $1 AND role_code = $2 AND facility_id = $3
         RETURNING user_id`,
        [userId, roleCode, facilityId],
      );

      if (deleted.rows.length === 0) return err('USER_NOT_IN_FACILITY');

      await record(db, {
        action: AUDIT_ACTIONS.ROLE_REVOKED,
        entityType: 'user_role',
        entityId: userId,
        actorUserId,
        facilityId,
        after: { roleCode, removed: true },
      });

      return ok(undefined);
    },

    async deactivateUser(userId, facilityId, actorUserId) {
      // Verify user belongs to the facility
      const userRole = await db.query<{ user_id: string }>(
        `SELECT user_id FROM user_roles WHERE user_id = $1 AND facility_id = $2 LIMIT 1`,
        [userId, facilityId],
      );
      if (userRole.rows.length === 0) return err('USER_NOT_IN_FACILITY');

      // Deactivate the user
      await db.query(
        `UPDATE users SET is_active = false WHERE id = $1`,
        [userId],
      );

      // Revoke all sessions (by deactivating — session validation checks is_active)
      await record(db, {
        action: AUDIT_ACTIONS.USER_DEACTIVATED,
        entityType: 'user',
        entityId: userId,
        actorUserId,
        facilityId,
        after: { is_active: false },
      });

      return ok(undefined);
    },

    async enforceMfa(userId, facilityId, actorUserId) {
      const userRole = await db.query<{ user_id: string }>(
        `SELECT user_id FROM user_roles WHERE user_id = $1 AND facility_id = $2 LIMIT 1`,
        [userId, facilityId],
      );
      if (userRole.rows.length === 0) return err('USER_NOT_IN_FACILITY');

      await db.query(
        `UPDATE users SET mfa_enabled = true WHERE id = $1`,
        [userId],
      );

      await record(db, {
        action: AUDIT_ACTIONS.MFA_ENFORCED,
        entityType: 'user',
        entityId: userId,
        actorUserId,
        facilityId,
        after: { mfa_enabled: true },
      });

      return ok(undefined);
    },
  };
}
