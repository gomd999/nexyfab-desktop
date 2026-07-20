/**
 * projectViewOps.test.ts — W4-C view operations (detail clip + broken
 * collapse) and the BrokenProjection IR validation.
 *
 * All clipping is exact (analytic line/circle and line/band intersections);
 * the tests assert coordinates at 1e-9, not "roughly right".
 */
import { describe, it, expect } from 'vitest';
import {
  clipSegmentsToCircle,
  applyViewBreak,
  type Segment2D,
} from '@/lib/drawing/projectView';
import { validateSheet, type Sheet, type Viewport } from '@/lib/drawing/sheet';

const seg = (x1: number, y1: number, x2: number, y2: number): Segment2D => ({ x1, y1, x2, y2 });

// ─── clipSegmentsToCircle ────────────────────────────────────────────────

describe('clipSegmentsToCircle', () => {
  const c = { x: 0, y: 0 };

  it('cuts a through-segment at the exact circle intersections', () => {
    const [out] = clipSegmentsToCircle([seg(-10, 0, 10, 0)], c, 5);
    expect(out.x1).toBeCloseTo(-5, 9);
    expect(out.x2).toBeCloseTo(5, 9);
    expect(out.y1).toBeCloseTo(0, 9);
  });

  it('keeps fully-inside segments verbatim and drops fully-outside ones', () => {
    const inside = seg(-1, -1, 1, 1);
    expect(clipSegmentsToCircle([inside], c, 5)).toEqual([inside]);
    expect(clipSegmentsToCircle([seg(10, 10, 20, 10)], c, 5)).toEqual([]);
    // Line through the circle's disk extended — but the SEGMENT stays outside.
    expect(clipSegmentsToCircle([seg(6, 0, 10, 0)], c, 5)).toEqual([]);
  });

  it('clips a segment that starts inside and exits', () => {
    const [out] = clipSegmentsToCircle([seg(0, 0, 10, 0)], c, 5);
    expect(out.x1).toBeCloseTo(0, 9);
    expect(out.x2).toBeCloseTo(5, 9);
  });

  it('refuses a non-positive radius', () => {
    expect(() => clipSegmentsToCircle([seg(0, 0, 1, 1)], c, 0)).toThrow(/radius/);
  });
});

// ─── applyViewBreak ──────────────────────────────────────────────────────

describe('applyViewBreak', () => {
  const opts = { axis: 'x' as const, breakStart: 10, breakEnd: 20, gap: 2 };

  it('splits a crossing segment and slides the far piece by band−gap', () => {
    const { segments, nearBreakAt, farBreakAt, shift } = applyViewBreak(
      [seg(0, 0, 30, 0)], opts,
    );
    expect(shift).toBeCloseTo(8, 9);
    expect(nearBreakAt).toBeCloseTo(10, 9);
    expect(farBreakAt).toBeCloseTo(12, 9);
    expect(segments).toHaveLength(2);
    const [near, far] = segments;
    expect(near.x1).toBeCloseTo(0, 9);
    expect(near.x2).toBeCloseTo(10, 9);
    expect(far.x1).toBeCloseTo(12, 9); // 20 − 8
    expect(far.x2).toBeCloseTo(22, 9); // 30 − 8
  });

  it('drops segments entirely inside the band; shifts axis-constant far segments', () => {
    const { segments } = applyViewBreak(
      [seg(12, 0, 18, 5), seg(25, 0, 25, 9)], opts,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].x1).toBeCloseTo(17, 9);
    expect(segments[0].x2).toBeCloseTo(17, 9);
    expect(segments[0].y2).toBeCloseTo(9, 9);
  });

  it('handles reversed-direction segments identically', () => {
    const { segments } = applyViewBreak([seg(30, 0, 0, 0)], opts);
    expect(segments).toHaveLength(2);
    const xs = segments.flatMap((s) => [s.x1, s.x2]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0, 9);
    expect(xs[3]).toBeCloseTo(22, 9);
  });

  it("axis 'y' collapses a horizontal band", () => {
    const { segments } = applyViewBreak(
      [seg(0, 0, 0, 30)], { axis: 'y', breakStart: 10, breakEnd: 20, gap: 2 },
    );
    expect(segments).toHaveLength(2);
    expect(segments[1].y1).toBeCloseTo(12, 9);
    expect(segments[1].y2).toBeCloseTo(22, 9);
  });

  it('refuses an empty band and a gap not smaller than the band', () => {
    expect(() => applyViewBreak([], { ...opts, breakEnd: 10 })).toThrow(/breakEnd/);
    expect(() => applyViewBreak([], { ...opts, gap: 10 })).toThrow(/gap/);
    expect(() => applyViewBreak([], { ...opts, gap: 0 })).toThrow(/gap/);
  });
});

// ─── BrokenProjection validation ─────────────────────────────────────────

describe('validateSheet — broken projection', () => {
  const brokenVp = (over: Partial<{ breakStart: number; breakEnd: number; gap: number }>): Viewport => ({
    id: 'broken-1',
    sourceId: 'p1',
    projection: {
      kind: 'broken',
      view: 'front',
      axis: 'x',
      breakStart: over.breakStart ?? 10,
      breakEnd: over.breakEnd ?? 20,
      ...(over.gap !== undefined ? { gap: over.gap } : {}),
    },
    centerOnSheet: { x: 100, y: 100 },
    widthOnSheet: 50,
    scale: 1,
    label: 'BROKEN 1',
  });
  const sheetWith = (vp: Viewport): Sheet => ({
    id: 's1', name: 'broken', paperSize: 'A3', viewports: [vp],
  });

  it('accepts a valid band (with and without gap)', () => {
    expect(() => validateSheet(sheetWith(brokenVp({})))).not.toThrow();
    expect(() => validateSheet(sheetWith(brokenVp({ gap: 4 })))).not.toThrow();
  });

  it('rejects an empty/inverted band and an oversized gap', () => {
    expect(() => validateSheet(sheetWith(brokenVp({ breakEnd: 10 })))).toThrow(/breakEnd/);
    expect(() => validateSheet(sheetWith(brokenVp({ gap: 10 })))).toThrow(/gap/);
  });
});
