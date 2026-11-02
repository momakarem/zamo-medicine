/**
 * ZAMO-GROW-072 — Campaign Service (الحملات وهامش المساهمة).
 *
 * Campaign management with the 15 fields from [S1]:
 *   1-9: Stored fields (name, platform, facility, branch, service,
 *         budget, start_date, end_date, utm_campaign)
 *   10-15: Computed fields from the full funnel
 *         (bookings, attendance, services, revenue, commission,
 *          cost_per_completed_service, contribution_margin)
 *
 * Full funnel [S1]:
 *   الإعلان ← الجلسة ← المحادثة ← الطلب ← التأكيد ← الحضور
 *   ← الخدمة ← الإيراد ← العمولة ← هامش المساهمة
 *
 * This funnel is the CORE VALUE PROPOSITION of the platform
 * for the business owner [PROJECT_UNDERSTANDING §15].
 */

import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';
import type { RoleCode } from '../booking/state-machine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'ended';

/** The 9 stored campaign fields. */
export interface Campaign {
  id: string;
  name: string;                     // 1. اسم الحملة
  platform: string;                 // 2. المنصة الإعلانية
  facilityId: string | null;        // 3. العيادة
  branchId: string | null;          // 4. الفرع
  serviceId: string | null;         // 5. الخدمة
  budget: number;                   // 6. الميزانية (SAR)
  startDate: Date;                  // 7. تاريخ البداية
  endDate: Date | null;             // 8. تاريخ النهاية
  utmCampaign: string;              // 9. معرّف UTM
  status: CampaignStatus;
  createdBy: string;
  createdAt: Date;
}

/** The 6 computed funnel fields (10-15). */
export interface CampaignFunnel {
  totalBookings: number;             // 10. الحجوزات
  totalAttended: number;             // 11. الحضور
  totalServicesDone: number;         // 12. الخدمات المنفذة
  totalRevenue: number;              // 13. الإيراد
  totalCommission: number;           // 14. العمولة
  costPerCompletedService: number | null; // 15. تكلفة الخدمة المكتملة
  contributionMargin: number;        // هامش المساهمة
}

/** Combined campaign with its funnel stats. */
export interface CampaignWithStats extends Campaign {
  funnel: CampaignFunnel;
}

/** Parameters for creating a new campaign. */
export interface CreateCampaignParams {
  name: string;
  platform: string;
  utmCampaign: string;
  facilityId?: string | null;
  branchId?: string | null;
  serviceId?: string | null;
  budget: number;
  startDate: Date;
  endDate?: Date | null;
  actorId: string;
  actorRole: RoleCode;
}

/** Parameters for updating campaign status. */
export interface UpdateCampaignStatusParams {
  campaignId: string;
  newStatus: CampaignStatus;
  actorRole: RoleCode;
}

export type CampaignError =
  | 'NOT_AUTHORIZED'
  | 'NAME_REQUIRED'
  | 'PLATFORM_REQUIRED'
  | 'UTM_REQUIRED'
  | 'BUDGET_NEGATIVE'
  | 'INVALID_DATES'
  | 'INVALID_STATUS_TRANSITION'
  | 'CAMPAIGN_NOT_FOUND';

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/** Only zamo_admin can create/manage campaigns. */
const CAMPAIGN_ADMIN_ROLES: readonly RoleCode[] = ['zamo_admin', 'zamo_ops'] as const;

export function canManageCampaigns(actorRole: RoleCode): boolean {
  return (CAMPAIGN_ADMIN_ROLES as readonly string[]).includes(actorRole);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate campaign creation parameters.
 */
export function validateCreateCampaign(
  params: CreateCampaignParams,
): Result<CreateCampaignParams, CampaignError> {
  if (!canManageCampaigns(params.actorRole)) {
    return err('NOT_AUTHORIZED');
  }

  if (!params.name?.trim()) {
    return err('NAME_REQUIRED');
  }

  if (!params.platform?.trim()) {
    return err('PLATFORM_REQUIRED');
  }

  if (!params.utmCampaign?.trim()) {
    return err('UTM_REQUIRED');
  }

  if (params.budget < 0) {
    return err('BUDGET_NEGATIVE');
  }

  if (params.endDate && params.endDate < params.startDate) {
    return err('INVALID_DATES');
  }

  return ok({
    ...params,
    name: params.name.trim(),
    platform: params.platform.trim(),
    utmCampaign: params.utmCampaign.trim(),
  });
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['active'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],  // terminal state
};

/**
 * Validate campaign status transition.
 */
export function validateStatusTransition(
  currentStatus: CampaignStatus,
  newStatus: CampaignStatus,
  actorRole: RoleCode,
): Result<CampaignStatus, CampaignError> {
  if (!canManageCampaigns(actorRole)) {
    return err('NOT_AUTHORIZED');
  }

  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    return err('INVALID_STATUS_TRANSITION');
  }

  return ok(newStatus);
}

// ---------------------------------------------------------------------------
// Contribution margin computation
// ---------------------------------------------------------------------------

/**
 * ❗ Compute the contribution margin for a campaign.
 *
 * هامش المساهمة = إيراد - (ميزانية + عمولة)
 *
 * costPerCompletedService = budget / completed services
 */
export function computeContributionMargin(
  budget: number,
  totalRevenue: number,
  totalCommission: number,
  completedServices: number,
): { contributionMargin: number; costPerCompletedService: number | null } {
  const contributionMargin = totalRevenue - budget - totalCommission;
  const costPerCompletedService = completedServices > 0
    ? Math.round((budget / completedServices) * 100) / 100
    : null;

  return { contributionMargin, costPerCompletedService };
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw SQL row from campaign_stats_view into CampaignWithStats.
 */
export function parseCampaignStatsRow(
  row: Record<string, string | undefined>,
): CampaignWithStats {
  const budget = parseFloat(row.budget ?? '0') || 0;
  const totalRevenue = parseFloat(row.total_revenue ?? '0') || 0;
  const totalCommission = parseFloat(row.total_commission ?? '0') || 0;
  const totalServicesDone = parseInt(row.total_services_done ?? '0', 10) || 0;

  const { contributionMargin, costPerCompletedService } = computeContributionMargin(
    budget, totalRevenue, totalCommission, totalServicesDone,
  );

  return {
    id: row.campaign_id ?? '',
    name: row.campaign_name ?? '',
    platform: row.platform ?? '',
    facilityId: row.facility_id ?? null,
    branchId: row.branch_id ?? null,
    serviceId: row.service_id ?? null,
    budget,
    startDate: new Date(row.start_date ?? Date.now()),
    endDate: row.end_date ? new Date(row.end_date) : null,
    utmCampaign: row.utm_campaign ?? '',
    status: (row.status as CampaignStatus) ?? 'draft',
    createdBy: row.created_by ?? '',
    createdAt: new Date(row.created_at ?? Date.now()),
    funnel: {
      totalBookings: parseInt(row.total_bookings ?? '0', 10) || 0,
      totalAttended: parseInt(row.total_attended ?? '0', 10) || 0,
      totalServicesDone,
      totalRevenue,
      totalCommission,
      costPerCompletedService,
      contributionMargin,
    },
  };
}
