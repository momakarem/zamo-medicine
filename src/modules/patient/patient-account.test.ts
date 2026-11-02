/**
 * ZAMO-BOOK-032/033 — Patient account unit tests.
 */
import { describe, it, expect } from 'vitest';
import { buildTimeline } from './patient-account.js';

// ---------------------------------------------------------------------------
// buildTimeline
// ---------------------------------------------------------------------------
describe('buildTimeline', () => {
  it('shows 6 steps for standard happy path at PENDING_CONFIRMATION', () => {
    const timeline = buildTimeline('PENDING_CONFIRMATION', {
      NEW: new Date('2026-09-20T09:00:00Z'),
      PENDING_CONFIRMATION: new Date('2026-09-20T09:01:00Z'),
    });

    expect(timeline).toHaveLength(6);

    // First two should be active
    expect(timeline[0]!.isActive).toBe(true); // NEW
    expect(timeline[1]!.isActive).toBe(true); // PENDING_CONFIRMATION
    expect(timeline[1]!.isCurrent).toBe(true);

    // Rest should be inactive
    expect(timeline[2]!.isActive).toBe(false); // CONFIRMED
    expect(timeline[3]!.isActive).toBe(false); // ATTENDED
  });

  it('shows 6 steps for CONFIRMED status', () => {
    const timeline = buildTimeline('CONFIRMED', {
      NEW: new Date('2026-09-20T09:00:00Z'),
      PENDING_CONFIRMATION: new Date('2026-09-20T09:01:00Z'),
      CONFIRMED: new Date('2026-09-20T09:15:00Z'),
    });

    expect(timeline).toHaveLength(6);
    expect(timeline[2]!.isCurrent).toBe(true);
    expect(timeline[2]!.status).toBe('CONFIRMED');
    expect(timeline[2]!.isActive).toBe(true);
  });

  it('adds terminal state (CANCELLED) as 7th entry', () => {
    const timeline = buildTimeline('CANCELLED', {
      NEW: new Date('2026-09-20T09:00:00Z'),
      PENDING_CONFIRMATION: new Date('2026-09-20T09:01:00Z'),
      CANCELLED: new Date('2026-09-20T10:00:00Z'),
    });

    // 6 standard + 1 terminal
    expect(timeline).toHaveLength(7);
    const last = timeline.at(-1)!;
    expect(last.status).toBe('CANCELLED');
    expect(last.isCurrent).toBe(true);
  });

  it('adds terminal state (REJECTED) as 7th entry (B-07)', () => {
    const timeline = buildTimeline('REJECTED', {
      NEW: new Date('2026-09-20T09:00:00Z'),
      PENDING_CONFIRMATION: new Date('2026-09-20T09:01:00Z'),
      REJECTED: new Date('2026-09-20T09:20:00Z'),
    });

    expect(timeline).toHaveLength(7);
    const last = timeline.at(-1)!;
    expect(last.status).toBe('REJECTED');
    expect(last.isCurrent).toBe(true);
  });

  it('all entries have icon and color (A-61: not color alone)', () => {
    const timeline = buildTimeline('CONFIRMED', {});
    for (const entry of timeline) {
      expect(entry.icon).toBeTruthy();
      expect(entry.color).toBeTruthy();
      expect(entry.label.ar).toBeTruthy();
      expect(entry.label.en).toBeTruthy();
    }
  });

  it('COLLECTED is shown as final step in happy path', () => {
    const timeline = buildTimeline('COLLECTED', {
      NEW: new Date(),
      PENDING_CONFIRMATION: new Date(),
      CONFIRMED: new Date(),
      ATTENDED: new Date(),
      SERVICE_DONE: new Date(),
      COLLECTED: new Date(),
    });

    expect(timeline).toHaveLength(6);
    expect(timeline[5]!.status).toBe('COLLECTED');
    expect(timeline[5]!.isCurrent).toBe(true);
    expect(timeline.every(e => e.isActive)).toBe(true);
  });
});
