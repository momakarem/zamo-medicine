/**
 * ZAMO-NOTIF-057 — consent manager tests.
 *
 * Validates:
 *   - ❗ Operational consent does NOT grant marketing permission
 *   - Revocation takes effect immediately
 *   - Consents are timestamped
 */

import { describe, it, expect } from 'vitest';
import {
  checkConsent,
  getGrantedCategories,
  isConsentGranted,
  grantConsent,
  revokeConsent,
  buildUpsertConsentSQL,
  buildGetConsentsSQL,
  type ConsentRecord,
} from './consent-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-20T10:00:00Z');

function makeConsents(opts: {
  operational?: boolean;
  marketing?: boolean;
}): ConsentRecord[] {
  const records: ConsentRecord[] = [];
  if (opts.operational !== undefined) {
    records.push({
      userId: 'patient-1',
      consentType: 'operational',
      granted: opts.operational,
      grantedAt: opts.operational ? NOW : null,
      revokedAt: opts.operational ? null : NOW,
    });
  }
  if (opts.marketing !== undefined) {
    records.push({
      userId: 'patient-1',
      consentType: 'marketing',
      granted: opts.marketing,
      grantedAt: opts.marketing ? NOW : null,
      revokedAt: opts.marketing ? null : NOW,
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// ❗ Core Rule: operational ≠ marketing
// ---------------------------------------------------------------------------

describe('Consent Manager — operational ≠ marketing', () => {
  it('❗ patient with operational-only consent does NOT get marketing notifications', () => {
    const consents = makeConsents({ operational: true }); // no marketing
    // BOOKING_CONFIRMED is operational → allowed
    expect(checkConsent('BOOKING_CONFIRMED', consents)).toBe('ALLOWED');

    // Marketing-type notifications should be denied (if any existed)
    // All 15 current types are operational, but the rule is enforced structurally
    const grantedCats = getGrantedCategories(consents);
    expect(grantedCats).toContain('operational');
    expect(grantedCats).not.toContain('marketing');
  });

  it('marketing consent alone does NOT grant operational notifications', () => {
    const consents = makeConsents({ marketing: true }); // no operational
    // BOOKING_CONFIRMED is operational → denied
    expect(checkConsent('BOOKING_CONFIRMED', consents)).toBe('DENIED_NO_CONSENT');
  });

  it('both consents grant both types', () => {
    const consents = makeConsents({ operational: true, marketing: true });
    expect(checkConsent('BOOKING_CONFIRMED', consents)).toBe('ALLOWED');
    const grantedCats = getGrantedCategories(consents);
    expect(grantedCats).toContain('operational');
    expect(grantedCats).toContain('marketing');
  });
});

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

describe('Consent Manager — revocation', () => {
  it('revocation takes effect immediately', () => {
    // Start with granted
    const consents = makeConsents({ operational: true });
    expect(checkConsent('BOOKING_CONFIRMED', consents)).toBe('ALLOWED');

    // Revoke
    const revokedConsents = makeConsents({ operational: false });
    expect(checkConsent('BOOKING_CONFIRMED', revokedConsents)).toBe('DENIED_REVOKED');
  });

  it('revoking one category does NOT affect the other', () => {
    const consents = makeConsents({ operational: true, marketing: false });
    expect(checkConsent('BOOKING_CONFIRMED', consents)).toBe('ALLOWED');
    expect(isConsentGranted(consents, 'operational')).toBe(true);
    expect(isConsentGranted(consents, 'marketing')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No consent records
// ---------------------------------------------------------------------------

describe('Consent Manager — no consent', () => {
  it('returns DENIED_NO_CONSENT when no records exist', () => {
    expect(checkConsent('BOOKING_CONFIRMED', [])).toBe('DENIED_NO_CONSENT');
  });
});

// ---------------------------------------------------------------------------
// Consent record builders
// ---------------------------------------------------------------------------

describe('grantConsent / revokeConsent', () => {
  it('grantConsent creates a record with grantedAt', () => {
    const record = grantConsent('patient-1', 'operational', NOW);
    expect(record.granted).toBe(true);
    expect(record.grantedAt).toBe(NOW);
    expect(record.revokedAt).toBeNull();
  });

  it('revokeConsent creates a record with revokedAt', () => {
    const record = revokeConsent('patient-1', 'operational', NOW);
    expect(record.granted).toBe(false);
    expect(record.grantedAt).toBeNull();
    expect(record.revokedAt).toBe(NOW);
  });

  it('consent records are timestamped', () => {
    const grant = grantConsent('patient-1', 'marketing', NOW);
    const revoke = revokeConsent('patient-1', 'marketing', new Date('2026-09-21T10:00:00Z'));

    expect(grant.grantedAt).toEqual(NOW);
    expect(revoke.revokedAt).toEqual(new Date('2026-09-21T10:00:00Z'));
  });
});

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

describe('SQL builders', () => {
  it('buildUpsertConsentSQL produces valid SQL with ON CONFLICT', () => {
    const record = grantConsent('patient-1', 'operational', NOW);
    const { sql, values } = buildUpsertConsentSQL(record);

    expect(sql).toContain('INSERT INTO notification_consents');
    expect(sql).toContain('ON CONFLICT');
    expect(values).toHaveLength(5);
    expect(values[0]).toBe('patient-1');
    expect(values[1]).toBe('operational');
    expect(values[2]).toBe(true);
  });

  it('buildGetConsentsSQL queries by userId', () => {
    const { sql, values } = buildGetConsentsSQL('patient-1');
    expect(sql).toContain('WHERE user_id = $1');
    expect(values).toEqual(['patient-1']);
  });
});
