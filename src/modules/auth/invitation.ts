import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../../db/client.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';
import { ok, err, type Result } from '../../shared/result.ts';

/**
 * ZAMO-AUTH-008 — invitation system.
 *
 * Facility managers and Zamo admins create invitations to onboard staff.
 * Each invitation contains:
 *  - A hashed token (sent via notification)
 *  - Target role + facility + branch
 *  - Expiry (default 72 hours)
 *
 * The invited user clicks the link, sets a password, enables MFA (if required),
 * and their account is activated with the specified role.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvitationError =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'ALREADY_ACCEPTED'
  | 'INVALID_TOKEN';

export interface CreateInvitationInput {
  roleCode: string;
  facilityId?: string;
  branchId?: string;
  invitedBy: string;
  phone?: string;
  email?: string;
  expiresInHours?: number;
}

export interface InvitationResult {
  invitationId: string;
  /** The raw token to send to the invitee (only returned once, never stored). */
  token: string;
}

export interface AcceptInvitationInput {
  token: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Token hashing
// ---------------------------------------------------------------------------

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface InvitationService {
  create(input: CreateInvitationInput): Promise<Result<InvitationResult, string>>;
  accept(input: AcceptInvitationInput): Promise<Result<{ roleCode: string; facilityId: string | null; branchId: string | null }, InvitationError>>;
  findByToken(token: string): Promise<Result<{
    id: string;
    roleCode: string;
    facilityId: string | null;
    branchId: string | null;
    phone: string | null;
    email: string | null;
    expiresAt: string;
    acceptedAt: string | null;
  }, InvitationError>>;
}

export function createInvitationService(db: Queryable): InvitationService {
  return {
    async create(input) {
      const token = generateToken();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(
        Date.now() + (input.expiresInHours ?? 72) * 3600 * 1000,
      );

      const res = await db.query<{ id: string }>(
        `INSERT INTO invitations (token_hash, role_code, facility_id, branch_id, invited_by, phone, email, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          tokenHash,
          input.roleCode,
          input.facilityId ?? null,
          input.branchId ?? null,
          input.invitedBy,
          input.phone ?? null,
          input.email ?? null,
          expiresAt.toISOString(),
        ],
      );

      const invitationId = res.rows[0]!.id;

      await record(db, {
        action: AUDIT_ACTIONS.INVITATION_SENT,
        entityType: 'invitation',
        entityId: invitationId,
        actorUserId: input.invitedBy,
        after: {
          roleCode: input.roleCode,
          facilityId: input.facilityId ?? null,
          branchId: input.branchId ?? null,
        },
      });

      return ok({ invitationId, token });
    },

    async accept(input) {
      const tokenHash = hashToken(input.token);

      const res = await db.query<{
        id: string;
        role_code: string;
        facility_id: string | null;
        branch_id: string | null;
        expires_at: string;
        accepted_at: string | null;
      }>(
        `SELECT id, role_code, facility_id, branch_id, expires_at, accepted_at
         FROM invitations WHERE token_hash = $1`,
        [tokenHash],
      );

      if (res.rows.length === 0) {
        return err('NOT_FOUND');
      }

      const inv = res.rows[0]!;

      if (inv.accepted_at !== null) {
        return err('ALREADY_ACCEPTED');
      }

      if (new Date(inv.expires_at).getTime() < Date.now()) {
        return err('EXPIRED');
      }

      // Mark as accepted
      await db.query(
        `UPDATE invitations SET accepted_at = now() WHERE id = $1`,
        [inv.id],
      );

      // Assign role to user
      await db.query(
        `INSERT INTO user_roles (user_id, role_code, facility_id, branch_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [input.userId, inv.role_code, inv.facility_id, inv.branch_id],
      );

      await record(db, {
        action: AUDIT_ACTIONS.INVITATION_ACCEPTED,
        entityType: 'invitation',
        entityId: inv.id,
        actorUserId: input.userId,
        after: {
          roleCode: inv.role_code,
          facilityId: inv.facility_id,
          branchId: inv.branch_id,
        },
      });

      return ok({
        roleCode: inv.role_code,
        facilityId: inv.facility_id,
        branchId: inv.branch_id,
      });
    },

    async findByToken(token) {
      const tokenHash = hashToken(token);

      const res = await db.query<{
        id: string;
        role_code: string;
        facility_id: string | null;
        branch_id: string | null;
        phone: string | null;
        email: string | null;
        expires_at: string;
        accepted_at: string | null;
      }>(
        `SELECT id, role_code, facility_id, branch_id, phone, email, expires_at, accepted_at
         FROM invitations WHERE token_hash = $1`,
        [tokenHash],
      );

      if (res.rows.length === 0) {
        return err('NOT_FOUND');
      }

      const inv = res.rows[0]!;
      return ok({
        id: inv.id,
        roleCode: inv.role_code,
        facilityId: inv.facility_id,
        branchId: inv.branch_id,
        phone: inv.phone,
        email: inv.email,
        expiresAt: inv.expires_at,
        acceptedAt: inv.accepted_at,
      });
    },
  };
}
