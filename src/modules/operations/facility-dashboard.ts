/**
 * ZAMO-OPS-044 — Facility Dashboard.
 *
 * Provides facility_manager with:
 *   - 10 performance indicators across ALL branches
 *   - Branch performance comparison
 *   - License/compliance alerts
 *   - Pending value approvals
 *
 * Key rules:
 *   - ❗ facility_manager sees ONLY their own facility's data
 *   - ❗ No data from other facilities (enforced by RBAC + RLS)
 *   - Includes all branches under the facility
 */

import type { RoleCode } from '../booking/state-machine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FacilityDashboardStats {
  /** Today's booking counts */
  totalToday: number;
  pending: number;
  late: number;
  confirmed: number;
  attended: number;
  serviceDone: number;
  collected: number;
  noShow: number;
  cancelled: number;
  /** Facility-level metrics */
  activeBranches: number;
}

export interface BranchPerformance {
  branchId: string;
  branchName?: string;
  totalBookings: number;
  confirmedRate: number;  // percentage
  attendanceRate: number; // percentage
  avgResponseMinutes: number | null;
  lateCount: number;
}

export interface ComplianceAlert {
  type: 'license_expiring' | 'license_expired' | 'missing_document';
  entityType: 'facility' | 'branch' | 'doctor';
  entityId: string;
  entityName?: string;
  expiresAt?: Date;
  message: string;
  severity: 'warning' | 'critical';
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * Roles that can access the facility dashboard.
 */
export const FACILITY_DASHBOARD_ROLES: readonly RoleCode[] = [
  'facility_manager',
] as const;

/**
 * ❗ Validate that the actor can view this facility's dashboard.
 */
export function canAccessFacilityDashboard(
  actorRole: RoleCode,
  actorFacilityId: string | null,
  requestedFacilityId: string,
): boolean {
  // Only facility_manager
  if (!FACILITY_DASHBOARD_ROLES.includes(actorRole)) {
    return false;
  }

  // ❗ Must be the same facility
  if (actorFacilityId !== requestedFacilityId) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Stats parsing
// ---------------------------------------------------------------------------

/**
 * Parse raw SQL stats row into FacilityDashboardStats.
 */
export function parseFacilityStats(row: Record<string, string | undefined>): FacilityDashboardStats {
  return {
    totalToday: parseInt(row.total_today ?? '0', 10) || 0,
    pending: parseInt(row.pending ?? '0', 10) || 0,
    late: parseInt(row.late ?? '0', 10) || 0,
    confirmed: parseInt(row.confirmed ?? '0', 10) || 0,
    attended: parseInt(row.attended ?? '0', 10) || 0,
    serviceDone: parseInt(row.service_done ?? '0', 10) || 0,
    collected: parseInt(row.collected ?? '0', 10) || 0,
    noShow: parseInt(row.no_show ?? '0', 10) || 0,
    cancelled: parseInt(row.cancelled ?? '0', 10) || 0,
    activeBranches: parseInt(row.active_branches ?? '0', 10) || 0,
  };
}
