/**
 * ZAMO-NOTIF-061 — operational alerts.
 *
 * Generates alerts for:
 *   1. LICENSE_EXPIRING — licenses expiring within threshold (30/7 days)
 *   2. STALLED_BOOKINGS_ALERT — bookings stuck in one state too long
 *
 * Integrates with:
 *   - compliance/licensing.ts → checkExpiringLicenses
 *   - booking status queries
 *
 * Recipients: facility_manager + zamo_admin
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpiringLicense {
  licenseId: string;
  facilityId: string;
  facilityName: string;
  licenseType: string;
  expiryDate: string;     // YYYY-MM-DD
  daysUntilExpiry: number;
}

export interface StalledBookingSummary {
  branchId: string;
  branchName: string;
  facilityId: string;
  facilityName: string;
  stalledCount: number;
  oldestStalledAt: Date;
}

export type AlertThreshold = {
  /** Days before license expiry to send first alert */
  licenseFirstAlert: number;
  /** Days before license expiry to send urgent alert */
  licenseUrgentAlert: number;
  /** Hours a booking can stay in one state before being considered stalled */
  stalledBookingHours: number;
};

export const DEFAULT_THRESHOLDS: AlertThreshold = {
  licenseFirstAlert: 30,
  licenseUrgentAlert: 7,
  stalledBookingHours: 48,
};

// ---------------------------------------------------------------------------
// License expiry detection
// ---------------------------------------------------------------------------

/**
 * Check licenses and return those expiring within the threshold.
 *
 * Two levels:
 *   - First alert: 30 days before expiry
 *   - Urgent alert: 7 days before expiry
 */
export function findExpiringLicenses(
  licenses: ExpiringLicense[],
  thresholds: AlertThreshold = DEFAULT_THRESHOLDS,
): { first: ExpiringLicense[]; urgent: ExpiringLicense[] } {
  const first: ExpiringLicense[] = [];
  const urgent: ExpiringLicense[] = [];

  for (const license of licenses) {
    if (license.daysUntilExpiry <= thresholds.licenseUrgentAlert) {
      urgent.push(license);
    } else if (license.daysUntilExpiry <= thresholds.licenseFirstAlert) {
      first.push(license);
    }
  }

  return { first, urgent };
}

/**
 * Determine if a stalled booking summary warrants an alert.
 */
export function isStalledAlertNeeded(
  summary: StalledBookingSummary,
  thresholds: AlertThreshold = DEFAULT_THRESHOLDS,
): boolean {
  if (summary.stalledCount === 0) return false;

  const hoursStalled =
    (Date.now() - summary.oldestStalledAt.getTime()) / (1000 * 60 * 60);

  return hoursStalled >= thresholds.stalledBookingHours;
}

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

/**
 * Build SQL to find licenses expiring within N days.
 */
export function buildExpiringLicensesSQL(daysThreshold: number): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      SELECT
        l.id as license_id,
        l.facility_id,
        f.name_ar as facility_name,
        l.license_type,
        l.expiry_date,
        (l.expiry_date::date - CURRENT_DATE) as days_until_expiry
      FROM facility_licenses l
      JOIN facilities f ON f.id = l.facility_id
      WHERE l.status = 'approved'
        AND l.expiry_date IS NOT NULL
        AND l.expiry_date::date <= CURRENT_DATE + $1 * interval '1 day'
        AND l.expiry_date::date >= CURRENT_DATE
      ORDER BY l.expiry_date ASC
    `,
    values: [daysThreshold],
  };
}

/**
 * Build SQL to find branches with stalled bookings.
 *
 * A booking is "stalled" if it has been in the same non-terminal status
 * for longer than the threshold.
 */
export function buildStalledBookingsSQL(hoursThreshold: number): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      SELECT
        b.branch_id,
        br.name_ar as branch_name,
        b.facility_id,
        f.name_ar as facility_name,
        COUNT(*) as stalled_count,
        MIN(b.updated_at) as oldest_stalled_at
      FROM bookings b
      JOIN branches br ON br.id = b.branch_id
      JOIN facilities f ON f.id = b.facility_id
      WHERE b.status NOT IN ('COLLECTED', 'NO_SHOW', 'CANCELLED', 'REJECTED')
        AND b.updated_at < now() - $1 * interval '1 hour'
      GROUP BY b.branch_id, br.name_ar, b.facility_id, f.name_ar
      HAVING COUNT(*) > 0
      ORDER BY MIN(b.updated_at) ASC
    `,
    values: [hoursThreshold],
  };
}

/**
 * Build SQL to check if an alert has already been sent today
 * (prevent duplicate daily alerts).
 */
export function buildCheckAlertSentTodaySQL(
  alertType: string,
  entityId: string,
): { sql: string; values: unknown[] } {
  return {
    sql: `
      SELECT EXISTS (
        SELECT 1 FROM notification_log
        WHERE notification_type = $1
          AND idempotency_key LIKE '%' || $2 || '%'
          AND created_at >= CURRENT_DATE
      ) as already_sent
    `,
    values: [alertType, entityId],
  };
}
