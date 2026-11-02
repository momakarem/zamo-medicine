/**
 * ZAMO-BILL-063 — Commission Priority Engine.
 *
 * Resolves which commission rule applies to a given booking based on
 * the three-level hierarchy (A-35):
 *   1. Service-level  (highest priority — most specific)
 *   2. Facility-level (middle)
 *   3. Platform-level (fallback — A-06: 10%)
 *
 * Time-bound: applies the rule active at the accrual date (DEC-008),
 * not the date the invoice is generated.
 *
 * This is a pure resolution function with no side effects.
 */

import type { Queryable } from '../../db/client.js';
import type { CommissionRule, CommissionScope } from './commission-rules.js';
import { getActiveRule } from './commission-rules.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedCommission {
  rule: CommissionRule;
  matchLevel: CommissionScope;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Resolve the applicable commission rule for a booking.
 *
 * Priority order (A-35): service → facility → platform.
 * Time-bound (DEC-008): uses the rule active at `accrualDate`.
 *
 * @param db        Database connection
 * @param serviceId The branch_service_id of the actual service performed
 * @param facilityId The facility that performed the service
 * @param accrualDate The date of accrual (B-12: moment of manager approval)
 * @returns The resolved rule and its match level, or null if no rule found
 */
export async function resolveCommissionRule(
  db: Queryable,
  serviceId: string,
  facilityId: string,
  accrualDate: Date,
): Promise<ResolvedCommission | null> {
  // 1. Try service-level rule (highest priority)
  const serviceRule = await getActiveRule(db, 'service', serviceId, accrualDate);
  if (serviceRule) {
    return { rule: serviceRule, matchLevel: 'service' };
  }

  // 2. Try facility-level rule
  const facilityRule = await getActiveRule(db, 'facility', facilityId, accrualDate);
  if (facilityRule) {
    return { rule: facilityRule, matchLevel: 'facility' };
  }

  // 3. Fallback to platform-level rule (A-06: 10%)
  const platformRule = await getActiveRule(db, 'platform', null, accrualDate);
  if (platformRule) {
    return { rule: platformRule, matchLevel: 'platform' };
  }

  // No rule found — this should never happen if platform default is seeded
  return null;
}
