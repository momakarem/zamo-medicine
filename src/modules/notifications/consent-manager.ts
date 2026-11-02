/**
 * ZAMO-NOTIF-057 — consent manager ❗
 *
 * Manages notification consent with strict separation between
 * operational and marketing categories.
 *
 * ❗ Phase Gate Rule:
 *   "لا تُرسل رسالة تسويقية لمن وافق على التشغيلية فقط"
 *   Operational consent does NOT imply marketing consent.
 *
 * Rules:
 *   - Consent revocation takes effect IMMEDIATELY
 *   - All consent changes are timestamped and logged
 *   - Operational notifications (booking lifecycle) only need operational consent
 *   - Marketing notifications need explicit marketing consent
 */

import type { NotificationType, ConsentCategory } from './notification-types.js';
import { NOTIFICATION_TYPE_META } from './notification-types.js';
import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsentRecord {
  userId: string;
  consentType: ConsentCategory;
  granted: boolean;
  grantedAt: Date | null;
  revokedAt: Date | null;
}

export type ConsentCheckResult =
  | 'ALLOWED'           // Consent granted
  | 'DENIED_NO_CONSENT' // Never consented
  | 'DENIED_REVOKED';   // Previously revoked

export type ConsentError =
  | 'USER_NOT_FOUND'
  | 'INVALID_CONSENT_TYPE';

// ---------------------------------------------------------------------------
// ConsentManager — pure logic
// ---------------------------------------------------------------------------

/**
 * Check if a notification can be sent to a user.
 *
 * ❗ The consent check is based on the notification type's category.
 * Marketing notifications REQUIRE explicit marketing consent —
 * operational consent is NOT sufficient.
 */
export function checkConsent(
  notificationType: NotificationType,
  consents: ConsentRecord[],
): ConsentCheckResult {
  const meta = NOTIFICATION_TYPE_META[notificationType];
  const requiredCategory = meta.consentCategory;

  // Find the consent record for the required category
  const consent = consents.find((c) => c.consentType === requiredCategory);

  if (!consent) {
    return 'DENIED_NO_CONSENT';
  }

  // ❗ Revoked consent = denied, regardless of granted history
  if (!consent.granted) {
    return 'DENIED_REVOKED';
  }

  return 'ALLOWED';
}

/**
 * ❗ Core rule: operational consent does NOT imply marketing consent.
 *
 * Given a set of consents, determine which categories are actually granted.
 */
export function getGrantedCategories(
  consents: ConsentRecord[],
): ConsentCategory[] {
  return consents
    .filter((c) => c.granted)
    .map((c) => c.consentType);
}

/**
 * Check if a specific consent type is granted.
 */
export function isConsentGranted(
  consents: ConsentRecord[],
  category: ConsentCategory,
): boolean {
  const consent = consents.find((c) => c.consentType === category);
  return consent?.granted === true;
}

// ---------------------------------------------------------------------------
// Consent record builders (for creating/updating)
// ---------------------------------------------------------------------------

/**
 * Create a consent grant record.
 */
export function grantConsent(
  userId: string,
  consentType: ConsentCategory,
  now: Date = new Date(),
): ConsentRecord {
  return {
    userId,
    consentType,
    granted: true,
    grantedAt: now,
    revokedAt: null,
  };
}

/**
 * Revoke a consent — takes effect IMMEDIATELY.
 */
export function revokeConsent(
  userId: string,
  consentType: ConsentCategory,
  now: Date = new Date(),
): ConsentRecord {
  return {
    userId,
    consentType,
    granted: false,
    grantedAt: null,
    revokedAt: now,
  };
}

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

/**
 * Build SQL to upsert a consent record.
 *
 * Uses ON CONFLICT to handle both insert and update.
 * Consent changes are always timestamped.
 */
export function buildUpsertConsentSQL(record: ConsentRecord): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      INSERT INTO notification_consents (
        user_id, consent_type, granted, granted_at, revoked_at
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, consent_type) DO UPDATE SET
        granted = EXCLUDED.granted,
        granted_at = CASE WHEN EXCLUDED.granted THEN EXCLUDED.granted_at ELSE notification_consents.granted_at END,
        revoked_at = CASE WHEN NOT EXCLUDED.granted THEN EXCLUDED.revoked_at ELSE NULL END,
        updated_at = now()
      RETURNING *
    `,
    values: [
      record.userId,
      record.consentType,
      record.granted,
      record.grantedAt,
      record.revokedAt,
    ],
  };
}

/**
 * Build SQL to get all consents for a user.
 */
export function buildGetConsentsSQL(userId: string): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      SELECT user_id, consent_type, granted, granted_at, revoked_at
      FROM notification_consents
      WHERE user_id = $1
    `,
    values: [userId],
  };
}

/**
 * Build SQL to log a consent change in audit_log.
 */
export function buildConsentAuditSQL(params: {
  userId: string;
  consentType: ConsentCategory;
  newValue: boolean;
  actorId: string;
}): { sql: string; values: unknown[] } {
  return {
    sql: `
      INSERT INTO audit_log (
        actor_user_id, actor_role, action, entity_type, entity_id,
        before_state, after_state
      ) VALUES ($1, 'patient', $2, 'consent', $3, $4, $5)
    `,
    values: [
      params.actorId,
      params.newValue ? 'consent.grant' : 'consent.revoke',
      params.userId,
      JSON.stringify({ consentType: params.consentType, granted: !params.newValue }),
      JSON.stringify({ consentType: params.consentType, granted: params.newValue }),
    ],
  };
}
