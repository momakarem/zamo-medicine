/**
 * ZAMO-SCHED-028 — slot hold (soft reservation).
 *
 * Implements B-30: Soft Reserve for 30 minutes then auto-release.
 * The EXCLUDE USING gist constraint on slot_holds enforces conflict
 * prevention at the database level (A-20).
 *
 * This module provides:
 *   - acquireHold(): reserve a slot for 30 minutes
 *   - releaseHold(): manually release a hold
 *   - releaseExpiredHolds(): cron job to release expired holds
 *   - convertHoldToBooking(): mark a hold as converted
 */

import type { Result } from '../../shared/result.js';
import { ok, err } from '../../shared/result.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** B-30: Soft reserve duration in minutes */
export const HOLD_DURATION_MINUTES = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlotHold {
  id: string;
  doctorId: string;
  branchId: string;
  slotStart: Date;
  slotEnd: Date;
  heldBy: string | null;
  expiresAt: Date;
  released: boolean;
  releasedAt: Date | null;
  bookingId: string | null;
  createdAt: Date;
}

export interface AcquireHoldParams {
  doctorId: string;
  branchId: string;
  slotStart: Date;
  slotEnd: Date;
  heldBy?: string;    // patient user_id (nullable per A-34 guest flow)
}

export type HoldError =
  | 'SLOT_CONFLICT'        // EXCLUDE constraint violation (A-20)
  | 'INVALID_TIME_RANGE'   // slot_start >= slot_end
  | 'SLOT_IN_PAST'         // slot starts before now
  | 'DB_ERROR';            // unexpected database error

// ---------------------------------------------------------------------------
// Hold SQL builders (for use with any pg-compatible client)
// ---------------------------------------------------------------------------

/**
 * Build the SQL + params for acquiring a hold.
 *
 * The caller is responsible for executing this within a transaction
 * and handling the EXCLUDE constraint violation (23P01 = exclusion_violation).
 */
export function buildAcquireHoldSQL(params: AcquireHoldParams): {
  sql: string;
  values: unknown[];
} {
  const { doctorId, branchId, slotStart, slotEnd, heldBy } = params;
  const expiresAt = new Date(Date.now() + HOLD_DURATION_MINUTES * 60 * 1000);

  return {
    sql: `
      INSERT INTO slot_holds (doctor_id, branch_id, slot_start, slot_end, held_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, doctor_id, branch_id, slot_start, slot_end, held_by,
                expires_at, released, released_at, booking_id, created_at
    `,
    values: [doctorId, branchId, slotStart, slotEnd, heldBy ?? null, expiresAt],
  };
}

/**
 * Build the SQL for releasing a hold (manual release).
 */
export function buildReleaseHoldSQL(holdId: string): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      UPDATE slot_holds
      SET released = true, released_at = now()
      WHERE id = $1 AND released = false
      RETURNING id
    `,
    values: [holdId],
  };
}

/**
 * Build the SQL for releasing all expired holds (cron job).
 * DEC-019: idempotent — running twice doesn't double the effect.
 */
export function buildReleaseExpiredHoldsSQL(): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      UPDATE slot_holds
      SET released = true, released_at = now()
      WHERE released = false AND expires_at < now()
      RETURNING id
    `,
    values: [],
  };
}

/**
 * Build the SQL for converting a hold to a booking reference.
 */
export function buildConvertHoldSQL(holdId: string, bookingId: string): {
  sql: string;
  values: unknown[];
} {
  return {
    sql: `
      UPDATE slot_holds
      SET booking_id = $2
      WHERE id = $1 AND released = false
      RETURNING id
    `,
    values: [holdId, bookingId],
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate hold parameters before attempting insertion.
 */
export function validateHoldParams(
  params: AcquireHoldParams,
  now: Date = new Date(),
): Result<void, HoldError> {
  if (params.slotStart >= params.slotEnd) {
    return err('INVALID_TIME_RANGE');
  }
  if (params.slotStart < now) {
    return err('SLOT_IN_PAST');
  }
  return ok(undefined);
}

/**
 * Check if a PostgreSQL error is an exclusion constraint violation.
 * This means the slot is already held by another booking (A-20).
 */
export function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23P01'
  );
}
