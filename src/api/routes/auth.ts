/**
 * Auth routes — /api/auth/*
 *
 * POST /api/auth/otp/request    — request OTP for phone number
 * POST /api/auth/otp/verify     — verify OTP and create session
 * POST /api/auth/logout         — revoke current session
 * GET  /api/auth/me             — get current user info
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';
import type { AppConfig } from '../../config/env.ts';
import { createOtpService } from '../../modules/auth/otp.ts';
import { createNotificationAdapter } from '../../modules/auth/notification-port.ts';
import { createSessionService } from '../../modules/auth/session.ts';
import { requireAuth, getSession } from '../middleware/auth.ts';

// eslint-disable-next-line @typescript-eslint/require-await
export async function authRoutes(app: FastifyInstance) {
  // @ts-expect-error — decorated
  const db = app.db as Db;
  // @ts-expect-error — decorated  
  const config = app.config as AppConfig;

  const sessionConfig = {
    ttlPatientMin: config.SESSION_TTL_PATIENT_MIN,
    ttlStaffMin: config.SESSION_TTL_STAFF_MIN,
    ttlAdminMin: config.SESSION_TTL_ADMIN_MIN,
  };

  const sessionService = createSessionService(db, sessionConfig);

  const notifications = createNotificationAdapter(config.NOTIFICATION_ADAPTER);
  const otpService = createOtpService(db, {
    pepper: config.OTP_PEPPER,
    ttlSeconds: config.OTP_TTL_SECONDS,
    maxAttempts: config.OTP_MAX_ATTEMPTS,
    requestWindowSeconds: config.OTP_REQUEST_WINDOW_SECONDS,
    maxRequestsPerWindow: config.OTP_MAX_REQUESTS_PER_WINDOW,
  }, notifications);

  // ─── Request OTP ──────────────────────────────────────────
  app.post('/otp/request', async (req, reply) => {
    const { phone } = req.body as { phone: string };
    if (!phone) {
      return reply.status(400).send({ error: 'VALIDATION', message: 'Phone number is required' });
    }

    const result = await otpService.requestOtp(phone, req.ip);

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        INVALID_PHONE: 400,
        RATE_LIMITED: 429,
      };
      return reply.status(statusMap[result.error] ?? 400).send({ error: result.error });
    }

    return {
      message: 'OTP sent',
      expiresInSeconds: config.OTP_TTL_SECONDS,
      maskedPhone: result.value.maskedPhone,
    };
  });

  // ─── Verify OTP ───────────────────────────────────────────
  app.post('/otp/verify', async (req, reply) => {
    const { phone, code } = req.body as { phone: string; code: string };
    if (!phone || !code) {
      return reply.status(400).send({ error: 'VALIDATION', message: 'Phone and code are required' });
    }

    const result = await otpService.verifyOtp(phone, code, req.ip);

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        EXPIRED: 410,
        INVALID_OTP: 401,
        MAX_ATTEMPTS: 429,
        ALREADY_USED: 400,
        INVALID_PHONE: 400,
      };
      return reply.status(statusMap[result.error] ?? 400).send({ error: result.error });
    }

    // Look up the user's role for session creation
    const userRoleRes = await db.query<{
      role_code: string;
      facility_id: string | null;
      branch_id: string | null;
    }>(
      `SELECT ur.role_code, ur.facility_id, ur.branch_id
       FROM user_roles ur WHERE ur.user_id = $1
       ORDER BY ur.granted_at DESC LIMIT 1`,
      [result.value.userId],
    );

    const roleCode = userRoleRes.rows[0]?.role_code ?? 'patient';
    const facilityId = userRoleRes.rows[0]?.facility_id ?? undefined;
    const branchId = userRoleRes.rows[0]?.branch_id ?? undefined;

    // Create session
    const { token, session } = await sessionService.create({
      userId: result.value.userId,
      roleCode,
      facilityId,
      branchId,
      ip: req.ip,
    });

    // Set session cookie
    reply.setCookie('zamo_session', token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: sessionConfig.ttlPatientMin * 60,
    });

    return {
      token,
      session: {
        userId: session.userId,
        roleCode: session.roleCode,
        facilityId: session.facilityId,
      },
    };
  });

  // ─── Get current user ─────────────────────────────────────
  app.get('/me', { preHandler: requireAuth(sessionConfig) }, async (req) => {
    const session = getSession(req);

    const user = await db.query<{
      id: string;
      phone: string;
      full_name_ar: string;
      full_name_en: string | null;
      role_code: string;
    }>(
      `SELECT id, phone, full_name_ar, full_name_en, role_code FROM users WHERE id = $1`,
      [session.userId],
    );

    if (user.rows.length === 0) {
      return { error: 'USER_NOT_FOUND' };
    }

    const u = user.rows[0]!;
    return {
      user: {
        id: u.id,
        phone: u.phone,
        fullNameAr: u.full_name_ar,
        fullNameEn: u.full_name_en,
        roleCode: u.role_code,
      },
      session: {
        facilityId: session.facilityId,
        branchId: session.branchId,
      },
    };
  });

  // ─── Logout ───────────────────────────────────────────────
  app.post('/logout', { preHandler: requireAuth(sessionConfig) }, async (req, reply) => {
    const session = getSession(req);
    await sessionService.revoke(session.sessionId, session.userId, req.ip);

    reply.clearCookie('zamo_session', { path: '/' });
    return { message: 'Logged out' };
  });
}
