/**
 * SVG path parser unit tests. Goal: prove that the common engineering
 * 2D shapes (L bracket, U channel, rectangle with chamfered corner)
 * survive a roundtrip through parseSvgPath into a valid polygon
 * vertex list.
 */

import { describe, it, expect } from 'vitest';
import { parseSvgPath } from './_svg.js';

describe('parseSvgPath — happy path', () => {
  it('parses a simple absolute rectangle', () => {
    const out = parseSvgPath('M 0,0 L 10,0 L 10,5 L 0,5 Z');
    expect(out.closed).toBe(true);
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('parses an L bracket (6 vertices)', () => {
    const out = parseSvgPath('M 0,0 L 10,0 L 10,3 L 3,3 L 3,10 L 0,10 Z');
    expect(out.points).toHaveLength(6);
  });

  it('handles H / V shortcuts', () => {
    const out = parseSvgPath('M 0,0 H 10 V 5 H 0 Z');
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('handles relative l', () => {
    const out = parseSvgPath('M 5,5 l 10,0 l 0,10 l -10,0 Z');
    expect(out.points).toEqual([[5, 5], [15, 5], [15, 15], [5, 15]]);
  });

  it('handles relative m at start (treated as absolute M)', () => {
    const out = parseSvgPath('m 2,2 l 5,0 l 0,5 l -5,0 z');
    expect(out.points).toEqual([[2, 2], [7, 2], [7, 7], [2, 7]]);
  });

  it('handles implicit-L pairs after M', () => {
    // SVG spec: pairs after the initial M coords are implicit L.
    const out = parseSvgPath('M 0,0 10,0 10,5 0,5 Z');
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('drops trailing explicit close-duplicate vertex', () => {
    const out = parseSvgPath('M 0,0 L 10,0 L 10,5 L 0,5 L 0,0 Z');
    // The trailing L 0,0 duplicates the start; we drop it so the
    // polygon validator's "first != last" rule passes.
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('accepts comma + whitespace separators interchangeably', () => {
    const out = parseSvgPath('M0,0 L 10 0 L10,5 L 0 5 Z');
    expect(out.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });
});

describe('parseSvgPath — Bezier flattening', () => {
  it('flattens a cubic Bezier into multiple vertices', () => {
    // Half-circle-ish via single cubic — 20mm radius, default 0.1mm
    // tolerance should produce dozens of vertices, NOT throw.
    const out = parseSvgPath('M 0,0 C 0,20 40,20 40,0 L 40,-5 L 0,-5 Z');
    expect(out.closed).toBe(true);
    // Cubic curve from (0,0) to (40,0) should subdivide into ≥ 4
    // segments at 0.1mm tolerance (in practice ~10-20).
    expect(out.points.length).toBeGreaterThan(5);
  });

  it('flattens a quadratic Bezier', () => {
    const out = parseSvgPath('M 0,0 Q 5,10 10,0 L 10,-2 L 0,-2 Z');
    expect(out.closed).toBe(true);
    expect(out.points.length).toBeGreaterThan(4);
  });

  it('honours custom tolerance (coarser = fewer vertices)', () => {
    const fine = parseSvgPath('M 0,0 C 0,20 40,20 40,0 Z', { tolerance: 0.05 });
    const coarse = parseSvgPath('M 0,0 C 0,20 40,20 40,0 Z', { tolerance: 2.0 });
    expect(coarse.points.length).toBeLessThan(fine.points.length);
  });

  it('handles relative cubic c', () => {
    const out = parseSvgPath('M 0,0 c 0,20 40,20 40,0 L 40,-2 L 0,-2 Z');
    expect(out.points.length).toBeGreaterThan(4);
  });

  it('handles smooth cubic S after C (reflects prev control)', () => {
    // C ends at (40,0) with last control (40,20). S's implicit P1 =
    // reflection of (40,20) across (40,0) = (40,-20).
    const out = parseSvgPath('M 0,0 C 0,20 40,20 40,0 S 80,-20 80,0 L 80,-2 L 0,-2 Z');
    expect(out.points.length).toBeGreaterThan(8);
  });

  it('handles smooth quadratic T after Q', () => {
    const out = parseSvgPath('M 0,0 Q 5,10 10,0 T 20,0 L 20,-2 L 0,-2 Z');
    expect(out.points.length).toBeGreaterThan(5);
  });

  it('S with no prior cubic uses current point as control', () => {
    // No preceding C → degenerate cubic (linear) — produces few vertices.
    const out = parseSvgPath('M 0,0 S 10,5 20,0 L 20,-2 L 0,-2 Z');
    expect(out.points.length).toBeGreaterThanOrEqual(4);
  });
});

describe('parseSvgPath — error paths', () => {
  it('rejects empty path', () => {
    expect(() => parseSvgPath('')).toThrow(/non-empty/);
    expect(() => parseSvgPath('   ')).toThrow(/non-empty/);
  });

  it('rejects path with no M', () => {
    expect(() => parseSvgPath('L 0,0 L 10,0 Z')).toThrow(/missing initial M/);
  });

  it('rejects unclosed path', () => {
    expect(() => parseSvgPath('M 0,0 L 10,0 L 10,5'))
      .toThrow(/must end with Z/);
  });

  it('flattens an elliptical arc (W14 D3-5)', () => {
    // Quarter circle: (10,0) → (0,10) via arc radii 10. Default 0.1mm
    // tolerance produces 8+ vertices.
    const out = parseSvgPath('M 10,0 A 10,10 0 0,0 0,10 L 0,0 Z');
    expect(out.closed).toBe(true);
    expect(out.points.length).toBeGreaterThan(5);
  });

  it('rejects arc with non-binary flag', () => {
    expect(() => parseSvgPath('M 0,0 A 5,5 0 2,1 10,0 L 10,5 L 0,5 Z'))
      .toThrow(/large-arc-flag must be 0 or 1/);
  });

  it('handles relative arc command', () => {
    const out = parseSvgPath('M 0,0 a 5,5 0 0,1 10,0 L 10,-2 L 0,-2 Z');
    expect(out.points.length).toBeGreaterThan(4);
  });

  it('rejects invalid tolerance', () => {
    expect(() => parseSvgPath('M 0,0 L 10,0 L 10,5 Z', { tolerance: 0 }))
      .toThrow(/positive finite/);
    expect(() => parseSvgPath('M 0,0 L 10,0 L 10,5 Z', { tolerance: -1 }))
      .toThrow(/positive finite/);
  });

  it('rejects multi-subpath', () => {
    expect(() => parseSvgPath('M 0,0 L 10,0 L 10,5 Z M 20,20 L 30,20 L 30,25 Z'))
      .toThrow(/multi-subpath/);
  });

  it('rejects degenerate (< 3 vertices after closure)', () => {
    expect(() => parseSvgPath('M 0,0 L 10,0 Z')).toThrow(/≥ 3/);
  });
});
