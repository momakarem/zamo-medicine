/**
 * M12 Growth Module — Public API.
 *
 * Phase 9 — النمو. UTM attribution capture and campaign management
 * with full-funnel tracking and contribution margin.
 */

// Attribution Service (ZAMO-GROW-071)
export {
  type AttributionChannel,
  type UtmParams,
  type AttributionTouch,
  type CaptureAttributionParams,
  type LinkPatientParams,
  type LinkConversationParams,
  type LinkToBookingParams,
  type AttributionError,
  deriveChannel,
  validateCapture,
  validateLinkToBooking,
  parseAttributionRow,
} from './attribution-service.js';

// Campaign Service (ZAMO-GROW-072)
export {
  type CampaignStatus,
  type Campaign,
  type CampaignFunnel,
  type CampaignWithStats,
  type CreateCampaignParams,
  type UpdateCampaignStatusParams,
  type CampaignError,
  canManageCampaigns,
  validateCreateCampaign,
  validateStatusTransition,
  computeContributionMargin,
  parseCampaignStatsRow,
} from './campaign-service.js';
