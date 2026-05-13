import { describe, it, expect } from 'vitest';
import { cleanupProfile } from '../profileCleanup';
import type { SketchProfile, SketchSegment } from '../types';

function line(x1: number, y1: number, x2: number, y2: number, construction = false): SketchSegment {
  return { type: 'line', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], ...(construction ? { construction: true } : {}) };
}

function profile(...segs: SketchSegment[]): SketchProfile {
  return { segments: segs, closed: false };
}

describe('cleanupProfile', () => {
  it('strips zero-length lines silently', () => {
    const p = profile(line(0, 0, 0, 0), line(0, 0, 10, 0));
    const { profile: out, summary } = cleanupProfile(p);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0].points[1].x).toBe(10);
    expect(summary.duplicatesRemoved).toBe(1);
  });

  it('removes exact duplicate line (same direction)', () => {
    const p = profile(line(0, 0, 10, 0), line(0, 0, 10, 0));
    const { profile: out, summary } = cleanupProfile(p);
    expect(out.segments).toHaveLength(1);
    expect(summary.duplicatesRemoved).toBe(1);
  });

  it('removes exact duplicate line (reversed direction)', () => {
    const p = profile(line(0, 0, 10, 0), line(10, 0, 0, 0));
    const { profile: out, summary } = cleanupProfile(p);
    expect(out.segments).toHaveLength(1);
    expect(summary.duplicatesRemoved).toBe(1);
  });

  it('does NOT touch arcs or circles', () => {
    const arcSeg: SketchSegment = { type: 'arc', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }] };
    const circleSeg: SketchSegment = { type: 'circle', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] };
    const p = profile(arcSeg, arcSeg, circleSeg, circleSeg);
    const { profile: out } = cleanupProfile(p);
    expect(out.segments).toHaveLength(4); // duplicates preserved on non-lines
  });

  it('merges two collinear horizontal lines that overlap', () => {
    const p = profile(line(0, 0, 10, 0), line(5, 0, 15, 0));
    const { profile: out, summary } = cleanupProfile(p);
    expect(out.segments).toHaveLength(1);
    const [a, b] = out.segments[0].points;
    expect(Math.min(a.x, b.x)).toBeCloseTo(0);
    expect(Math.max(a.x, b.x)).toBeCloseTo(15);
    expect(summary.overlapsCollapsed).toBe(1);
  });

  it('merges three chained overlapping lines into one', () => {
    const p = profile(line(0, 0, 10, 0), line(5, 0, 15, 0), line(12, 0, 20, 0));
    const { profile: out } = cleanupProfile(p);
    expect(out.segments).toHaveLength(1);
    const [a, b] = out.segments[0].points;
    expect(Math.min(a.x, b.x)).toBeCloseTo(0);
    expect(Math.max(a.x, b.x)).toBeCloseTo(20);
  });

  it('swallows a fully-contained inner segment', () => {
    const p = profile(line(0, 0, 100, 0), line(20, 0, 40, 0));
    const { profile: out } = cleanupProfile(p);
    expect(out.segments).toHaveLength(1);
    const [a, b] = out.segments[0].points;
    expect(Math.min(a.x, b.x)).toBeCloseTo(0);
    expect(Math.max(a.x, b.x)).toBeCloseTo(100);
  });

  it('leaves end-to-end chained segments alone (no overlap)', () => {
    // Two segments sharing exactly one endpoint, no overlap — these are
    // intentional polyline chains and must not be merged.
    const p = profile(line(0, 0, 10, 0), line(10, 0, 20, 0));
    const { profile: out, summary } = cleanupProfile(p);
    expect(out.segments).toHaveLength(2);
    expect(summary.overlapsCollapsed).toBe(0);
  });

  it('does NOT merge collinear segments of different construction flag', () => {
    const p = profile(line(0, 0, 10, 0), line(5, 0, 15, 0, true /* construction */));
    const { profile: out } = cleanupProfile(p);
    expect(out.segments).toHaveLength(2);
  });

  it('handles non-axis-aligned collinear overlap', () => {
    // Two collinear segments along y = x
    const p = profile(line(0, 0, 10, 10), line(5, 5, 15, 15));
    const { profile: out } = cleanupProfile(p);
    expect(out.segments).toHaveLength(1);
    const [a, b] = out.segments[0].points;
    const minP = a.x < b.x ? a : b;
    const maxP = a.x < b.x ? b : a;
    expect(minP.x).toBeCloseTo(0);
    expect(minP.y).toBeCloseTo(0);
    expect(maxP.x).toBeCloseTo(15);
    expect(maxP.y).toBeCloseTo(15);
  });

  it('reports summary counts correctly', () => {
    const p = profile(
      line(0, 0, 0, 0),         // zero-length → stripped
      line(0, 0, 10, 0),        // kept
      line(10, 0, 0, 0),        // duplicate (reversed) → removed
      line(5, 0, 20, 0),        // overlap → merges with first
    );
    const { profile: out, summary } = cleanupProfile(p);
    expect(out.segments).toHaveLength(1);
    expect(summary.segmentsBefore).toBe(4);
    expect(summary.segmentsAfter).toBe(1);
    expect(summary.duplicatesRemoved).toBeGreaterThanOrEqual(2);
    expect(summary.overlapsCollapsed).toBe(1);
  });
});
