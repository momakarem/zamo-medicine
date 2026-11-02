/**
 * Auth middleware — extracts session token from cookie/header,
 * validates it, and injects SessionContext + RLS vars into the request.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createSessionService, type SessionContext, type SessionConfig } from '../../modules/auth/session.ts';
import { SESSION_VARS, type Queryable } from '../../db/client.ts';

/**
 * Extracts the bearer token from Authorization header or `zamo_session` cookie.
 */
function extractToken(req: FastifyRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookieToken = (req as unknown as { cookies?: Record<string, string> }).cookies?.zamo_session;
  return cookieToken ?? null;
}

/**
 * Sets RLS session variables on the database connection.
 */
async function setRlsVars(db: Queryable, ctx: SessionContext): Promise<void> {
  await db.query(
    `SELECT
       set_config($1, $2, true),
       set_config($3, $4, true),
       set_config($5, $6, true),
       set_config($7, $8, true)`,
    [
      SESSION_VARS.userId, ctx.userId,
      SESSION_VARS.facilityId, ctx.facilityId ?? '',
      SESSION_VARS.branchIds, ctx.branchId ?? '',
      SESSION_VARS.roleCode, ctx.roleCode,
    ],
  );
}

/**
 * Fastify preHandler that validates the session and decorates request.
 */
export function requireAuth(sessionConfig: SessionConfig) {
  return async function authHook(req: FastifyRequest, reply: FastifyReply) {
    const token = extractToken(req);
    if (!token) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing session token' });
    }

    // @ts-expect-error — db is decorated on the app
    const db = req.server.db as Queryable;
    const sessionService = createSessionService(db, sessionConfig);

    const result = await sessionService.validate(token);
    if (!result.ok) {
      const statusMap = { NOT_FOUND: 401, EXPIRED: 401, REVOKED: 401 } as const;
      return reply.status(statusMap[result.error] ?? 401).send({
        error: result.error,
        message: `Session ${result.error.toLowerCase().replace('_', ' ')}`,
      });
    }

    // Set RLS vars for this request
    await setRlsVars(db, result.value);

    // Decorate request with session context
    // @ts-expect-error — custom decoration
    req.session = result.value;
  };
}

/**
 * Helper: extract session from request (after auth middleware ran).
 */
export function getSession(req: FastifyRequest): SessionContext {
  // @ts-expect-error — custom decoration
  return req.session as SessionContext;
}
