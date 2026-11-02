import { describe, it, expect } from 'vitest';
import {
  BOOKING_STATUSES,
  STATUS_META,
  getStatusMeta,
  getStatusLabel,
  getStatusDescription,
  isBookingStatus,
  computeLateFlag,
  LATE_FLAG,
  type BookingStatus,
} from './booking-status.ts';

describe('ZAMO-DS-006 :: booking status', () => {
  // --- All 9 states defined ---------------------------------------------------

  it('defines exactly 9 statuses (8 original + REJECTED per B-07)', () => {
    expect(BOOKING_STATUSES).toHaveLength(9);
    expect(BOOKING_STATUSES).toContain('REJECTED');
  });

  it('every status has metadata', () => {
    for (const s of BOOKING_STATUSES) {
      const meta = STATUS_META[s];
      expect(meta).toBeDefined();
      expect(meta.status).toBe(s);
    }
  });

  // --- Text + icon + colour (not colour alone) ---------------------------------

  it('every status has a non-empty Arabic label', () => {
    for (const s of BOOKING_STATUSES) {
      expect(STATUS_META[s].labelAr.length).toBeGreaterThan(0);
    }
  });

  it('every status has a non-empty English label', () => {
    for (const s of BOOKING_STATUSES) {
      expect(STATUS_META[s].labelEn.length).toBeGreaterThan(0);
    }
  });

  it('every status has an icon name', () => {
    for (const s of BOOKING_STATUSES) {
      expect(STATUS_META[s].icon.length).toBeGreaterThan(0);
    }
  });

  it('every status has a colour', () => {
    for (const s of BOOKING_STATUSES) {
      expect(STATUS_META[s].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  // --- Greyscale test: statuses are distinguishable without colour --------
  // The key guarantee: each status has a UNIQUE combination of (icon + label),
  // so even in pure greyscale (no colour), every status is distinguishable.

  it('statuses are distinguishable by icon alone (greyscale test)', () => {
    const icons = BOOKING_STATUSES.map((s) => STATUS_META[s].icon);
    const unique = new Set(icons);
    expect(unique.size).toBe(BOOKING_STATUSES.length);
  });

  it('statuses are distinguishable by English label alone', () => {
    const labels = BOOKING_STATUSES.map((s) => STATUS_META[s].labelEn);
    const unique = new Set(labels);
    expect(unique.size).toBe(BOOKING_STATUSES.length);
  });

  it('statuses are distinguishable by Arabic label alone', () => {
    const labels = BOOKING_STATUSES.map((s) => STATUS_META[s].labelAr);
    const unique = new Set(labels);
    expect(unique.size).toBe(BOOKING_STATUSES.length);
  });

  // --- Screen reader accessibility -------------------------------------------

  it('every status has an Arabic screen reader description', () => {
    for (const s of BOOKING_STATUSES) {
      expect(STATUS_META[s].descriptionAr.length).toBeGreaterThan(0);
    }
  });

  it('every status has an English screen reader description', () => {
    for (const s of BOOKING_STATUSES) {
      expect(STATUS_META[s].descriptionEn.length).toBeGreaterThan(0);
    }
  });

  // --- Bilingual labels -------------------------------------------------------

  it('getStatusLabel returns Arabic by default', () => {
    expect(getStatusLabel('CONFIRMED')).toBe('مؤكد');
  });

  it('getStatusLabel returns English when requested', () => {
    expect(getStatusLabel('CONFIRMED', 'en')).toBe('Confirmed');
  });

  it('getStatusDescription works in both languages', () => {
    expect(getStatusDescription('REJECTED', 'ar')).toContain('رفضت');
    expect(getStatusDescription('REJECTED', 'en')).toContain('rejected');
  });

  // --- Type guard --------------------------------------------------------------

  it('isBookingStatus accepts valid statuses', () => {
    for (const s of BOOKING_STATUSES) {
      expect(isBookingStatus(s)).toBe(true);
    }
  });

  it('isBookingStatus rejects invalid strings', () => {
    expect(isBookingStatus('INVALID')).toBe(false);
    expect(isBookingStatus('')).toBe(false);
    expect(isBookingStatus('confirmed')).toBe(false); // case-sensitive
  });

  // --- Late flag (DEC-006) ----------------------------------------------------

  it('"late" is a flag, not a state — LATE_FLAG has its own label and icon', () => {
    expect(LATE_FLAG.labelAr).toBe('متأخر');
    expect(LATE_FLAG.labelEn).toBe('Late');
    expect(LATE_FLAG.icon).toBeTruthy();
  });

  it('computeLateFlag returns isLate=true when SLA deadline has passed on PENDING_CONFIRMATION', () => {
    const pastDeadline = new Date(Date.now() - 60_000);
    const flag = computeLateFlag('PENDING_CONFIRMATION', pastDeadline);
    expect(flag.isLate).toBe(true);
  });

  it('computeLateFlag returns isLate=false when SLA deadline is still in future', () => {
    const futureDeadline = new Date(Date.now() + 60_000);
    const flag = computeLateFlag('PENDING_CONFIRMATION', futureDeadline);
    expect(flag.isLate).toBe(false);
  });

  it('computeLateFlag returns isLate=false for non-PENDING statuses even if deadline passed', () => {
    const pastDeadline = new Date(Date.now() - 60_000);
    const statuses: BookingStatus[] = ['CONFIRMED', 'ATTENDED', 'CANCELLED', 'REJECTED'];
    for (const s of statuses) {
      const flag = computeLateFlag(s, pastDeadline);
      expect(flag.isLate).toBe(false);
    }
  });

  it('computeLateFlag returns isLate=false when no SLA deadline is set', () => {
    const flag = computeLateFlag('PENDING_CONFIRMATION', null);
    expect(flag.isLate).toBe(false);
  });

  it('"late" flag visible with PENDING_CONFIRMATION (IMPLEMENTATION_CHECKLIST requirement)', () => {
    const pastDeadline = new Date(Date.now() - 60_000);
    const flag = computeLateFlag('PENDING_CONFIRMATION', pastDeadline);
    expect(flag.isLate).toBe(true);
    expect(flag.labelAr).toBe('متأخر');
  });

  // --- Lookup ---------------------------------------------------------------

  it('getStatusMeta returns metadata for valid statuses', () => {
    const meta = getStatusMeta('NEW');
    expect(meta).toBeDefined();
    expect(meta!.status).toBe('NEW');
  });

  it('getStatusMeta returns undefined for invalid statuses', () => {
    expect(getStatusMeta('INVALID')).toBeUndefined();
  });

  // --- Order for timeline rendering -----------------------------------------

  it('statuses have a logical order for timeline rendering', () => {
    const ordered = [...BOOKING_STATUSES].sort(
      (a, b) => STATUS_META[a].order - STATUS_META[b].order,
    );
    expect(ordered[0]).toBe('NEW');
    expect(ordered[ordered.length - 1]).toBe('REJECTED');
  });
});
