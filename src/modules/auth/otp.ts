import { createHash, randomInt } from 'node:crypto';
import type { Queryable } from '../../db/client.ts';
import type { NotificationPort } from './notification-port.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';
import { ok, err, type Result } from '../../shared/result.ts';

/**
 * ZAMO-AUTH-007 — patient authentication (phone + OTP).
 *
 * Approved decisions implemented:
 *  - A-33: patients have NO password, they authenticate with OTP only.
 *  - A-34: conversation starts before sign-in, OTP required at booking.
 *  - DEC-009: SMS/WhatsApp provider is abstracted behind NotificationPort.
 *
 * Security measures:
 *  - OTP codes are hashed (SHA-256 + pepper) before storage.
 *  - OTP has a TTL (default 300s from env).
 *  - Max attempts per OTP (default 5 from env).
 *  - Rate limiting: max N requests per window per phone.
 *  - Failed attempts are recorded in Audit (A-46).
 *  - Phone numbers are partially masked in responses.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OtpConfig {
  /** Pepper mixed into the hash — from OTP_PEPPER env var. */
  pepper: string;
  /** OTP validity in seconds (default 300). */
  ttlSeconds: number;
  /** Max verification attempts per OTP (default 5). */
  maxAttempts: number;
  /** Window for rate limiting in seconds (default 3600). */
  requestWindowSeconds: number;
  /** Max OTP requests per phone per window (default 5). */
  maxRequestsPerWindow: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type OtpError =
  | 'RATE_LIMITED'
  | 'INVALID_PHONE'
  | 'INVALID_OTP'
  | 'EXPIRED'
  | 'ALREADY_USED'
  | 'MAX_ATTEMPTS'
  | 'NOT_FOUND';

// ---------------------------------------------------------------------------
// Phone masking
// ---------------------------------------------------------------------------

/**
 * Mask a phone number for display: `+966 5** *** *12`
 * Only the country code and last 2 digits are visible.
 */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  const visible = phone.slice(0, 4);
  const lastTwo = phone.slice(-2);
  const masked = phone.slice(4, -2).replace(/\d/g, '*');
  // Group for readability
  return `${visible} ${masked.slice(0, 3)} ${masked.slice(3, 6)} ${masked.slice(6)}${lastTwo}`.trim();
}

/**
 * Basic E.164 validation for Saudi numbers.
 */
export function isValidPhone(phone: string): boolean {
  return /^\+9665\d{8}$/.test(phone);
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function hashOtp(code: string, pepper: string): string {
  return createHash('sha256').update(`${code}:${pepper}`).digest('hex');
}

function generateOtpCode(): string {
  // 6-digit code, zero-padded.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface OtpService {
  requestOtp(phone: string, ip?: string): Promise<Result<{ maskedPhone: string }, OtpError>>;
  verifyOtp(
    phone: string,
    code: string,
    ip?: string,
  ): Promise<Result<{ userId: string }, OtpError>>;
}

export function createOtpService(
  db: Queryable,
  config: OtpConfig,
  notifications: NotificationPort,
): OtpService {
  return {
    async requestOtp(phone, ip) {
      // Validate phone
      if (!isValidPhone(phone)) {
        return err('INVALID_PHONE');
      }

      // Rate limit: count recent requests for this phone
      const windowStart = new Date(Date.now() - config.requestWindowSeconds * 1000);
      const countRes = await db.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM otp_requests
         WHERE phone = $1 AND created_at > $2`,
        [phone, windowStart.toISOString()],
      );
      const recentCount = parseInt(countRes.rows[0]!.cnt, 10);
      if (recentCount >= config.maxRequestsPerWindow) {
        await record(db, {
          action: AUDIT_ACTIONS.OTP_REQUESTED,
          entityType: 'otp',
          entityId: phone,
          actorIp: ip ?? null,
          after: { denied: true, reason: 'rate_limited' },
        });
        return err('RATE_LIMITED');
      }

      // Generate OTP
      const code = generateOtpCode();
      const hash = hashOtp(code, config.pepper);
      const expiresAt = new Date(Date.now() + config.ttlSeconds * 1000);

      // Store hashed OTP
      await db.query(
        `INSERT INTO otp_requests (phone, code_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [phone, hash, expiresAt.toISOString()],
      );

      // Send via notification port
      await notifications.send(phone, `رمز التحقق لزامو: ${code}\nZamo verification code: ${code}`);

      // Audit
      await record(db, {
        action: AUDIT_ACTIONS.OTP_REQUESTED,
        entityType: 'otp',
        entityId: phone,
        actorIp: ip ?? null,
      });

      return ok({ maskedPhone: maskPhone(phone) });
    },

    async verifyOtp(phone, code, ip) {
      if (!isValidPhone(phone)) {
        return err('INVALID_PHONE');
      }

      const hash = hashOtp(code, config.pepper);

      // Find the most recent unused, non-expired OTP for this phone
      const otpRes = await db.query<{
        id: string;
        code_hash: string;
        expires_at: string;
        attempts: number;
        used: boolean;
      }>(
        `SELECT id, code_hash, expires_at, attempts, used FROM otp_requests
         WHERE phone = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [phone],
      );

      if (otpRes.rows.length === 0) {
        await record(db, {
          action: AUDIT_ACTIONS.OTP_FAILED,
          entityType: 'otp',
          entityId: phone,
          actorIp: ip ?? null,
          after: { reason: 'not_found' },
        });
        return err('NOT_FOUND');
      }

      const otp = otpRes.rows[0]!;

      // Already used?
      if (otp.used) {
        await record(db, {
          action: AUDIT_ACTIONS.OTP_FAILED,
          entityType: 'otp',
          entityId: phone,
          actorIp: ip ?? null,
          after: { reason: 'already_used' },
        });
        return err('ALREADY_USED');
      }

      // Expired?
      if (new Date(otp.expires_at).getTime() < Date.now()) {
        await record(db, {
          action: AUDIT_ACTIONS.OTP_FAILED,
          entityType: 'otp',
          entityId: phone,
          actorIp: ip ?? null,
          after: { reason: 'expired' },
        });
        return err('EXPIRED');
      }

      // Max attempts?
      if (otp.attempts >= config.maxAttempts) {
        await record(db, {
          action: AUDIT_ACTIONS.OTP_FAILED,
          entityType: 'otp',
          entityId: phone,
          actorIp: ip ?? null,
          after: { reason: 'max_attempts' },
        });
        return err('MAX_ATTEMPTS');
      }

      // Increment attempts
      await db.query(`UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);

      // Wrong code?
      if (otp.code_hash !== hash) {
        await record(db, {
          action: AUDIT_ACTIONS.OTP_FAILED,
          entityType: 'otp',
          entityId: phone,
          actorIp: ip ?? null,
          after: { reason: 'invalid_code', attempt: otp.attempts + 1 },
        });
        return err('INVALID_OTP');
      }

      // Mark as used
      await db.query(`UPDATE otp_requests SET used = true WHERE id = $1`, [otp.id]);

      // Find or create user
      let userRes = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE phone = $1`,
        [phone],
      );

      if (userRes.rows.length === 0) {
        userRes = await db.query<{ id: string }>(
          `INSERT INTO users (phone) VALUES ($1) RETURNING id`,
          [phone],
        );
        await record(db, {
          action: AUDIT_ACTIONS.USER_CREATED,
          entityType: 'user',
          entityId: userRes.rows[0]!.id,
          after: { phone: maskPhone(phone), method: 'otp' },
        });
      }

      const userId = userRes.rows[0]!.id;

      // Update last_login_at
      await db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);

      // Audit success
      await record(db, {
        action: AUDIT_ACTIONS.OTP_VERIFIED,
        entityType: 'otp',
        entityId: phone,
        actorUserId: userId,
        actorIp: ip ?? null,
      });

      await record(db, {
        action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
        entityType: 'user',
        entityId: userId,
        actorUserId: userId,
        actorIp: ip ?? null,
        after: { method: 'otp' },
      });

      return ok({ userId });
    },
  };
}
