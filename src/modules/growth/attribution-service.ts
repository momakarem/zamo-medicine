/**
 * ZAMO-GROW-071 — Attribution Service (التقاط المصدر).
 *
 * Captures UTM parameters and referral source BEFORE user registration.
 * The attribution persists across the session and is linked to the booking.
 *
 * Rules:
 *   ❗ Captured **before any interaction** — must not be lost across session [S1]
 *   ❗ Source transfers from conversation to booking
 *   Direct visits are recorded as channel 'direct'
 *
 * Flow:
 *   Ad click → capture UTM → session → agent conversation → booking
 *        └─ attribution_touches row created here
 *             └─ linked to booking via bookings.attribution_id
 */

import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported acquisition channels. */
export type AttributionChannel = 'paid' | 'organic' | 'direct' | 'referral' | 'social';

/** UTM parameters captured from the landing URL. */
export interface UtmParams {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
}

/** Full attribution touch record. */
export interface AttributionTouch {
  id: string;
  sessionId: string;
  patientId: string | null;

  // UTM
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;

  // Extra
  referrer: string | null;
  landingPage: string | null;
  channel: AttributionChannel;

  // Conversation link
  conversationId: string | null;

  // Lifecycle
  linkedToBookingAt: Date | null;
  capturedAt: Date;
}

/** Parameters for capturing a new attribution touch. */
export interface CaptureAttributionParams {
  sessionId: string;
  utm?: UtmParams;
  referrer?: string | null;
  landingPage?: string | null;
}

/** Parameters for linking a patient to an existing attribution. */
export interface LinkPatientParams {
  attributionId: string;
  patientId: string;
}

/** Parameters for linking a conversation to an attribution. */
export interface LinkConversationParams {
  attributionId: string;
  conversationId: string;
}

/** Parameters for linking an attribution to a booking. */
export interface LinkToBookingParams {
  attributionId: string;
  bookingId: string;
}

export type AttributionError =
  | 'SESSION_REQUIRED'
  | 'ATTRIBUTION_NOT_FOUND'
  | 'ALREADY_LINKED_TO_BOOKING';

// ---------------------------------------------------------------------------
// Channel derivation
// ---------------------------------------------------------------------------

/**
 * Derive the acquisition channel from UTM params and referrer.
 *
 * Priority:
 *   1. utm_medium 'cpc' or 'ppc' → 'paid'
 *   2. utm_source present → 'social' if social platform, else 'organic'
 *   3. referrer present → 'referral'
 *   4. else → 'direct'
 */
export function deriveChannel(
  utm: UtmParams | undefined,
  referrer: string | null | undefined,
): AttributionChannel {
  if (utm?.utmMedium) {
    const medium = utm.utmMedium.toLowerCase();
    if (medium === 'cpc' || medium === 'ppc' || medium === 'paid') {
      return 'paid';
    }
    if (medium === 'social') {
      return 'social';
    }
    if (medium === 'organic') {
      return 'organic';
    }
  }

  if (utm?.utmSource) {
    const source = utm.utmSource.toLowerCase();
    const socialPlatforms = ['facebook', 'instagram', 'twitter', 'tiktok', 'snapchat', 'linkedin', 'x'];
    if (socialPlatforms.some(p => source.includes(p))) {
      return 'social';
    }
    return 'organic';
  }

  if (referrer?.trim()) {
    return 'referral';
  }

  return 'direct';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * ❗ Validate attribution capture — sessionId is required.
 *
 * [S1]: UTM must be captured **before any interaction**.
 */
export function validateCapture(
  params: CaptureAttributionParams,
): Result<{
  sessionId: string;
  channel: AttributionChannel;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  landingPage: string | null;
}, AttributionError> {
  if (!params.sessionId?.trim()) {
    return err('SESSION_REQUIRED');
  }

  const channel = deriveChannel(params.utm, params.referrer);

  return ok({
    sessionId: params.sessionId.trim(),
    channel,
    utmSource: params.utm?.utmSource?.trim() ?? null,
    utmMedium: params.utm?.utmMedium?.trim() ?? null,
    utmCampaign: params.utm?.utmCampaign?.trim() ?? null,
    utmTerm: params.utm?.utmTerm?.trim() ?? null,
    utmContent: params.utm?.utmContent?.trim() ?? null,
    referrer: params.referrer?.trim() ?? null,
    landingPage: params.landingPage?.trim() ?? null,
  });
}

/**
 * ❗ Validate linking an attribution to a booking.
 *
 * [S1]: Source transfers from conversation to booking.
 * An attribution can only be linked to one booking (first-touch).
 */
export function validateLinkToBooking(
  attribution: Pick<AttributionTouch, 'id' | 'linkedToBookingAt'>,
): Result<true, AttributionError> {
  if (attribution.linkedToBookingAt) {
    return err('ALREADY_LINKED_TO_BOOKING');
  }
  return ok(true);
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw SQL row into an AttributionTouch.
 */
export function parseAttributionRow(
  row: Record<string, string | undefined>,
): AttributionTouch {
  return {
    id: row.id ?? '',
    sessionId: row.session_id ?? '',
    patientId: row.patient_id ?? null,
    utmSource: row.utm_source ?? null,
    utmMedium: row.utm_medium ?? null,
    utmCampaign: row.utm_campaign ?? null,
    utmTerm: row.utm_term ?? null,
    utmContent: row.utm_content ?? null,
    referrer: row.referrer ?? null,
    landingPage: row.landing_page ?? null,
    channel: (row.channel as AttributionChannel) ?? 'direct',
    conversationId: row.conversation_id ?? null,
    linkedToBookingAt: row.linked_to_booking_at ? new Date(row.linked_to_booking_at) : null,
    capturedAt: new Date(row.captured_at ?? Date.now()),
  };
}
