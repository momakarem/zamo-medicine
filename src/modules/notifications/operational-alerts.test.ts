/**
 * ZAMO-NOTIF-061 — operational alerts tests.
 *
 * Validates:
 *   - License expiry alert at 30-day and 7-day thresholds
 *   - Stalled bookings alert
 */

import { describe, it, expect } from 'vitest';
import {
  findExpiringLicenses,
  isStalledAlertNeeded,
  buildExpiringLicensesSQL,
  buildStalledBookingsSQL,
  DEFAULT_THRESHOLDS,
  type ExpiringLicense,
  type StalledBookingSummary,
} from './operational-alerts.js';

// ---------------------------------------------------------------------------
// License expiry alerts
// ---------------------------------------------------------------------------

describe('findExpiringLicenses', () => {
  it('categorizes license expiring in 5 days as urgent', () => {
    const licenses: ExpiringLicense[] = [
      {
        licenseId: 'lic-1',
        facilityId: 'fac-1',
        facilityName: 'عيادات النور',
        licenseType: 'commercial_registration',
        expiryDate: '2026-10-01',
        daysUntilExpiry: 5,
      },
    ];

    const { first, urgent } = findExpiringLicenses(licenses);

    expect(urgent).toHaveLength(1);
    expect(first).toHaveLength(0);
    expect(urgent[0]?.licenseId).toBe('lic-1');
  });

  it('categorizes license expiring in 20 days as first alert', () => {
    const licenses: ExpiringLicense[] = [
      {
        licenseId: 'lic-2',
        facilityId: 'fac-1',
        facilityName: 'عيادات النور',
        licenseType: 'medical_practice',
        expiryDate: '2026-10-15',
        daysUntilExpiry: 20,
      },
    ];

    const { first, urgent } = findExpiringLicenses(licenses);

    expect(first).toHaveLength(1);
    expect(urgent).toHaveLength(0);
  });

  it('ignores licenses expiring in 60 days (outside threshold)', () => {
    const licenses: ExpiringLicense[] = [
      {
        licenseId: 'lic-3',
        facilityId: 'fac-1',
        facilityName: 'عيادات النور',
        licenseType: 'ministry_health',
        expiryDate: '2026-11-20',
        daysUntilExpiry: 60,
      },
    ];

    const { first, urgent } = findExpiringLicenses(licenses);

    expect(first).toHaveLength(0);
    expect(urgent).toHaveLength(0);
  });

  it('handles mixed urgencies correctly', () => {
    const licenses: ExpiringLicense[] = [
      { licenseId: 'lic-a', facilityId: 'f1', facilityName: 'A', licenseType: 'commercial_registration', expiryDate: '2026-10-01', daysUntilExpiry: 3 },
      { licenseId: 'lic-b', facilityId: 'f2', facilityName: 'B', licenseType: 'medical_practice', expiryDate: '2026-10-15', daysUntilExpiry: 15 },
      { licenseId: 'lic-c', facilityId: 'f3', facilityName: 'C', licenseType: 'ministry_health', expiryDate: '2026-12-01', daysUntilExpiry: 90 },
    ];

    const { first, urgent } = findExpiringLicenses(licenses);

    expect(urgent).toHaveLength(1);
    expect(urgent[0]?.licenseId).toBe('lic-a');
    expect(first).toHaveLength(1);
    expect(first[0]?.licenseId).toBe('lic-b');
    // lic-c is outside threshold → neither
  });

  it('uses custom thresholds', () => {
    const licenses: ExpiringLicense[] = [
      { licenseId: 'lic-1', facilityId: 'f1', facilityName: 'A', licenseType: 'commercial_registration', expiryDate: '2026-10-01', daysUntilExpiry: 10 },
    ];

    // Custom: first alert at 15 days, urgent at 3 days
    const { first, urgent } = findExpiringLicenses(licenses, {
      ...DEFAULT_THRESHOLDS,
      licenseFirstAlert: 15,
      licenseUrgentAlert: 3,
    });

    expect(first).toHaveLength(1);
    expect(urgent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stalled bookings alert
// ---------------------------------------------------------------------------

describe('isStalledAlertNeeded', () => {
  it('returns true when bookings stalled beyond threshold', () => {
    const summary: StalledBookingSummary = {
      branchId: 'branch-1',
      branchName: 'فرع الملقا',
      facilityId: 'fac-1',
      facilityName: 'عيادات النور',
      stalledCount: 5,
      oldestStalledAt: new Date(Date.now() - 72 * 60 * 60 * 1000), // 72 hours ago
    };

    expect(isStalledAlertNeeded(summary)).toBe(true);
  });

  it('returns false when bookings are within threshold', () => {
    const summary: StalledBookingSummary = {
      branchId: 'branch-1',
      branchName: 'فرع الملقا',
      facilityId: 'fac-1',
      facilityName: 'عيادات النور',
      stalledCount: 2,
      oldestStalledAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
    };

    expect(isStalledAlertNeeded(summary)).toBe(false);
  });

  it('returns false when stalledCount is 0', () => {
    const summary: StalledBookingSummary = {
      branchId: 'branch-1',
      branchName: 'فرع الملقا',
      facilityId: 'fac-1',
      facilityName: 'عيادات النور',
      stalledCount: 0,
      oldestStalledAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
    };

    expect(isStalledAlertNeeded(summary)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SQL builders
// ---------------------------------------------------------------------------

describe('Operational alerts SQL builders', () => {
  it('buildExpiringLicensesSQL queries with day threshold', () => {
    const { sql, values } = buildExpiringLicensesSQL(30);
    expect(sql).toContain("status = 'approved'");
    expect(sql).toContain('expiry_date');
    expect(values).toEqual([30]);
  });

  it('buildStalledBookingsSQL excludes terminal states', () => {
    const { sql, values } = buildStalledBookingsSQL(48);
    expect(sql).toContain("NOT IN ('COLLECTED', 'NO_SHOW', 'CANCELLED', 'REJECTED')");
    expect(values).toEqual([48]);
  });
});
