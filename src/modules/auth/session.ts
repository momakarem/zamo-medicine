import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../../db/client.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';
import { ok, err, type Result } from '../../shared/result.ts';

/**
 * ZAMO-AUTH-009 — server-side session management.
 *
 * Approved decisions:
 *  - A-47: role-based TTLs (admin=30min, staff=8h, patient=7d).
 *  - Sessions are opaque tokens (not JWT) — stored server-side.
 *  - Token is hashed before storage.
 *  - Revocation is immediate (set revoked_at).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionError =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED';

export interface SessionContext {
  sessionId: string;
  userId: string;
  roleCode: string;
  facilityId: string | null;
  branchId: string | null;
}

export interface SessionConfig {
  /** Session TTL in minutes by role category. */
  ttlPatientMin: number;
  ttlStaffMin: number;
  ttlAdminMin: number;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Map role code → TTL category. */
function getTtlMinutes(roleCode: string, config: SessionConfig): number {
  if (roleCode === 'zamo_admin') return config.ttlAdminMin;
  if (roleCode === 'patient') return config.ttlPatientMin;
  // All other roles (facility_manager, branch_manager, receptionist, doctor, accountant)
  return config.ttlStaffMin;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SessionService {
  create(input: {
    userId: string;
    roleCode: string;
    facilityId?: string;
    branchId?: string;
    ip?: string;
  }): Promise<{ token: string; session: SessionContext }>;

  validate(token: string): Promise<Result<SessionContext, SessionError>>;

  revoke(sessionId: string, actorUserId?: string, ip?: string): Promise<void>;

  revokeAllForUser(userId: string, actorUserId?: string, ip?: string): Promise<number>;
}

export function createSessionService(
  db: Queryable,
  config: SessionConfig,
): SessionService {
  return {
    async create(input) {
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const ttl = getTtlMinutes(input.roleCode, config);
      const expiresAt = new Date(Date.now() + ttl * 60 * 1000);

      const res = await db.query<{ id: string }>(
        `INSERT INTO sessions (user_id, token_hash, role_code, facility_id, branch_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          input.userId,
          tokenHash,
          input.roleCode,
          input.facilityId ?? null,
          input.branchId ?? null,
          expiresAt.toISOString(),
        ],
      );

      const sessionId = res.rows[0]!.id;

      // Update last_login_at
      await db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [input.userId]);

      await record(db, {
        action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
        entityType: 'session',
        entityId: sessionId,
        actorUserId: input.userId,
        actorIp: input.ip ?? null,
        after: { roleCode: input.roleCode, ttlMinutes: ttl },
      });

      return {
        token,
        session: {
          sessionId,
          userId: input.userId,
          roleCode: input.roleCode,
          facilityId: input.facilityId ?? null,
          branchId: input.branchId ?? null,
        },
      };
    },

    async validate(token) {
      const tokenHash = hashSessionToken(token);

      const res = await db.query<{
        id: string;
        user_id: string;
        role_code: string;
        facility_id: string | null;
        branch_id: string | null;
        expires_at: string;
        revoked_at: string | null;
      }>(
        `SELECT id, user_id, role_code, facility_id, branch_id, expires_at, revoked_at
         FROM sessions WHERE token_hash = $1`,
        [tokenHash],
      );

      if (res.rows.length === 0) {
        return err('NOT_FOUND');
      }

      const session = res.rows[0]!;

      if (session.revoked_at !== null) {
        return err('REVOKED');
      }

      if (new Date(session.expires_at).getTime() < Date.now()) {
        return err('EXPIRED');
      }

      // Touch last_active
      await db.query(
        `UPDATE sessions SET last_active = now() WHERE id = $1`,
        [session.id],
      );

      return ok({
        sessionId: session.id,
        userId: session.user_id,
        roleCode: session.role_code,
        facilityId: session.facility_id,
        branchId: session.branch_id,
      });
    },

    async revoke(sessionId, actorUserId, ip) {
      await db.query(
        `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
        [sessionId],
      );

      await record(db, {
        action: AUDIT_ACTIONS.SESSION_REVOKED,
        entityType: 'session',
        entityId: sessionId,
        actorUserId: actorUserId ?? null,
        actorIp: ip ?? null,
      });
    },

    async revokeAllForUser(userId, actorUserId, ip) {
      const res = await db.query<{ id: string }>(
        `UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [userId],
      );

      for (const row of res.rows) {
        await record(db, {
          action: AUDIT_ACTIONS.SESSION_REVOKED,
          entityType: 'session',
          entityId: row.id,
          actorUserId: actorUserId ?? null,
          actorIp: ip ?? null,
          after: { reason: 'revoke_all' },
        });
      }

      return res.rows.length;
    },
  };
}
