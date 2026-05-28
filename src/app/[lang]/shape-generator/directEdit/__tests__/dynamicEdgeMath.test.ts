/**
 * dynamicEdgeMath.test.ts — Wave 2 Phase 3 Track E2 pure-math suite.
 *
 * No THREE.js, no React. Locks:
 *   - Drag projection sign / magnitude for fillet (perpendicular) and
 *     chamfer (parallel) components.
 *   - Validation refusal cases for both ops.
 *   - Edge-id encoding symmetry (start/end swap → same id).
 *   - findNearestTriangleEdge: which edge wins for a click on a known
 *     triangle.
 */

import { describe, it, expect } from 'vitest';
import {
  computeFilletRadiusFromDrag,
  computeChamferDistanceFromDrag,
  validateDynamicFillet,
  validateDynamicChamfer,
  dragSnapToGrid,
  encodeEdgeId,
  decodeEdgeId,
  edgeLength,
  findNearestTriangleEdge,
  DYNAMIC_EDGE_EPSILON_MM,
  DYNAMIC_EDGE_MAX_MM,
  type Vec3,
} from '../dynamicEdgeMath';

describe('computeFilletRadiusFromDrag', () => {
  const start: Vec3 = [0, 0, 0];
  const end: Vec3 = [10, 0, 0]; // edge along +X

  it('returns drag magnitude when drag is perpendicular to the edge', () => {
    expect(computeFilletRadiusFromDrag(start, end, [0, 5, 0])).toBeCloseTo(5, 6);
  });

  it('returns 0 when drag is fully parallel to the edge', () => {
    expect(computeFilletRadiusFromDrag(start, end, [3, 0, 0])).toBe(0);
  });

  it('projects the perpendicular component of an oblique drag', () => {
    // Drag (3, 4, 0) on an edge along +X: perpendicular component = 4.
    expect(computeFilletRadiusFromDrag(start, end, [3, 4, 0])).toBeCloseTo(4, 6);
  });

  it('handles 3D perpendicular drag (+Y and +Z)', () => {
    const r = computeFilletRadiusFromDrag(start, end, [0, 3, 4]);
    expect(r).toBeCloseTo(5, 6);
  });

  it('returns zero for sub-epsilon perpendicular component', () => {
    expect(
      computeFilletRadiusFromDrag(start, end, [5, DYNAMIC_EDGE_EPSILON_MM / 10, 0]),
    ).toBe(0);
  });

  it('falls back to full drag magnitude for a zero-length edge', () => {
    expect(
      computeFilletRadiusFromDrag([0, 0, 0], [0, 0, 0], [3, 4, 0]),
    ).toBeCloseTo(5, 6);
  });

  it('handles arbitrary edge direction', () => {
    // Edge along (1, 1, 0)/√2, drag along (1, -1, 0)/√2 * 5 (perpendicular).
    const s: Vec3 = [0, 0, 0];
    const e: Vec3 = [10, 10, 0];
    const r = computeFilletRadiusFromDrag(s, e, [5 / Math.SQRT2, -5 / Math.SQRT2, 0]);
    expect(r).toBeCloseTo(5, 6);
  });
});

describe('computeChamferDistanceFromDrag', () => {
  const start: Vec3 = [0, 0, 0];
  const end: Vec3 = [10, 0, 0];

  it('returns abs of parallel component', () => {
    expect(computeChamferDistanceFromDrag(start, end, [5, 0, 0])).toBeCloseTo(5, 6);
  });

  it('returns abs of parallel component (negative drag)', () => {
    expect(computeChamferDistanceFromDrag(start, end, [-3, 0, 0])).toBeCloseTo(3, 6);
  });

  it('returns 0 when drag is fully perpendicular', () => {
    expect(computeChamferDistanceFromDrag(start, end, [0, 5, 0])).toBe(0);
  });

  it('projects only the parallel component of oblique drag', () => {
    expect(computeChamferDistanceFromDrag(start, end, [3, 4, 0])).toBeCloseTo(3, 6);
  });

  it('returns zero for sub-epsilon parallel component', () => {
    expect(
      computeChamferDistanceFromDrag(start, end, [DYNAMIC_EDGE_EPSILON_MM / 10, 5, 0]),
    ).toBe(0);
  });

  it('falls back to full drag magnitude for a zero-length edge', () => {
    expect(
      computeChamferDistanceFromDrag([0, 0, 0], [0, 0, 0], [3, 4, 0]),
    ).toBeCloseTo(5, 6);
  });
});

describe('validateDynamicFillet', () => {
  const okCtx = { edgeLengthMm: 100, shortestAdjacentFaceExtentMm: 100 };

  it('accepts a reasonable radius', () => {
    expect(validateDynamicFillet(5, okCtx)).toEqual({ ok: true });
  });

  it('refuses zero radius', () => {
    expect(validateDynamicFillet(0, okCtx)).toEqual({ ok: false, reason: 'invalid_radius' });
  });

  it('refuses negative radius', () => {
    expect(validateDynamicFillet(-1, okCtx)).toEqual({ ok: false, reason: 'invalid_radius' });
  });

  it('refuses NaN radius', () => {
    expect(validateDynamicFillet(NaN, okCtx)).toEqual({ ok: false, reason: 'invalid_radius' });
  });

  it('refuses radius exceeding hard cap', () => {
    expect(validateDynamicFillet(DYNAMIC_EDGE_MAX_MM + 1, okCtx)).toEqual({
      ok: false, reason: 'too_large',
    });
  });

  it('refuses when edge is shorter than 2 × radius', () => {
    // edge=10mm, radius=6 → 2*r=12 > 10
    expect(validateDynamicFillet(6, {
      edgeLengthMm: 10, shortestAdjacentFaceExtentMm: 100,
    })).toEqual({ ok: false, reason: 'edge_too_short' });
  });

  it('refuses over-round when radius > 50% of shortest face extent', () => {
    expect(validateDynamicFillet(6, {
      edgeLengthMm: 100, shortestAdjacentFaceExtentMm: 10,
    })).toEqual({ ok: false, reason: 'over_round' });
  });

  it('accepts boundary case: radius exactly = 50% of face extent', () => {
    expect(validateDynamicFillet(5, {
      edgeLengthMm: 100, shortestAdjacentFaceExtentMm: 10,
    })).toEqual({ ok: true });
  });

  it('accepts edge length = exactly 2 × radius (boundary)', () => {
    expect(validateDynamicFillet(5, {
      edgeLengthMm: 10, shortestAdjacentFaceExtentMm: 100,
    })).toEqual({ ok: true });
  });

  it('orders refusal: edge_too_short before over_round', () => {
    // Both conditions fail; edge_too_short is the more fundamental refusal.
    expect(validateDynamicFillet(8, {
      edgeLengthMm: 10, shortestAdjacentFaceExtentMm: 10,
    })).toEqual({ ok: false, reason: 'edge_too_short' });
  });
});

describe('validateDynamicChamfer', () => {
  const okCtx = { edgeLengthMm: 100, shortestAdjacentFaceExtentMm: 100 };

  it('accepts a reasonable distance', () => {
    expect(validateDynamicChamfer(5, okCtx)).toEqual({ ok: true });
  });

  it('refuses zero distance', () => {
    expect(validateDynamicChamfer(0, okCtx)).toEqual({ ok: false, reason: 'invalid_distance' });
  });

  it('refuses negative distance', () => {
    expect(validateDynamicChamfer(-1, okCtx)).toEqual({ ok: false, reason: 'invalid_distance' });
  });

  it('refuses NaN distance', () => {
    expect(validateDynamicChamfer(NaN, okCtx)).toEqual({ ok: false, reason: 'invalid_distance' });
  });

  it('refuses distance ≥ edge length', () => {
    expect(validateDynamicChamfer(100, {
      edgeLengthMm: 100, shortestAdjacentFaceExtentMm: 100,
    })).toEqual({ ok: false, reason: 'distance_exceeds_edge' });
  });

  it('refuses over_chamfer when > 50% face extent', () => {
    expect(validateDynamicChamfer(6, {
      edgeLengthMm: 100, shortestAdjacentFaceExtentMm: 10,
    })).toEqual({ ok: false, reason: 'over_chamfer' });
  });

  it('refuses distance exceeding hard cap', () => {
    expect(validateDynamicChamfer(DYNAMIC_EDGE_MAX_MM + 1, okCtx)).toEqual({
      ok: false, reason: 'too_large',
    });
  });
});

describe('encodeEdgeId / decodeEdgeId', () => {
  it('is symmetric in start/end', () => {
    const id1 = encodeEdgeId([0, 0, 0], [10, 0, 0]);
    const id2 = encodeEdgeId([10, 0, 0], [0, 0, 0]);
    expect(id1).toBe(id2);
  });

  it('round-trips through decode (canonical order)', () => {
    const id = encodeEdgeId([0, 0, 0], [10, 5, 3]);
    const dec = decodeEdgeId(id);
    expect(dec).not.toBeNull();
    // Whichever was lex-min stays as `a`; order may flip on the round trip.
    expect(dec!.a[0]).toBeCloseTo(0, 6);
    expect(dec!.b[0]).toBeCloseTo(10, 6);
  });

  it('quantises to 1µm so noise within tolerance maps to the same id', () => {
    const id1 = encodeEdgeId([0, 0, 0], [10, 0, 0]);
    const id2 = encodeEdgeId([0.0000001, 0, 0], [10.0000001, 0, 0]);
    expect(id1).toBe(id2);
  });

  it('returns null on malformed input', () => {
    expect(decodeEdgeId('not-an-edge-id')).toBeNull();
    expect(decodeEdgeId('1:2|3:4')).toBeNull();
  });

  it('distinguishes non-overlapping edges', () => {
    const id1 = encodeEdgeId([0, 0, 0], [10, 0, 0]);
    const id2 = encodeEdgeId([0, 0, 0], [0, 10, 0]);
    expect(id1).not.toBe(id2);
  });
});

describe('edgeLength', () => {
  it('returns the Euclidean length', () => {
    expect(edgeLength([0, 0, 0], [3, 4, 0])).toBeCloseTo(5, 6);
  });

  it('returns 0 for coincident endpoints', () => {
    expect(edgeLength([1, 2, 3], [1, 2, 3])).toBe(0);
  });
});

describe('findNearestTriangleEdge', () => {
  // Right triangle with legs of length 10 on the XZ plane (y=0).
  // Vertices: (0,0,0), (10,0,0), (0,0,10).
  const v0: Vec3 = [0, 0, 0];
  const v1: Vec3 = [10, 0, 0];
  const v2: Vec3 = [0, 0, 10];

  it('selects edge (v0, v1) for a click near the X axis', () => {
    const result = findNearestTriangleEdge(v0, v1, v2, [5, 0, 0.1]);
    expect(result).not.toBeNull();
    // The closest edge should be the v0-v1 leg.
    expect(result!.start[2]).toBeCloseTo(0, 6);
    expect(result!.end[2]).toBeCloseTo(0, 6);
  });

  it('selects edge (v0, v2) for a click near the Z axis', () => {
    const result = findNearestTriangleEdge(v0, v1, v2, [0.1, 0, 5]);
    expect(result).not.toBeNull();
    expect(result!.start[0]).toBeCloseTo(0, 6);
    expect(result!.end[0]).toBeCloseTo(0, 6);
  });

  it('selects the hypotenuse for a centroid-side click', () => {
    // Click near the hypotenuse: midpoint of (10,0,0)-(0,0,10) = (5,0,5).
    const result = findNearestTriangleEdge(v0, v1, v2, [4.5, 0, 4.5]);
    expect(result).not.toBeNull();
    // Hypotenuse goes from v1 to v2.
    const verts = [result!.start, result!.end].sort((a, b) => a[0] - b[0]);
    expect(verts[0]![2]).toBeCloseTo(10, 6);
    expect(verts[1]![0]).toBeCloseTo(10, 6);
  });

  it('returns a non-null result even for clicks outside the triangle', () => {
    const result = findNearestTriangleEdge(v0, v1, v2, [100, 0, 0]);
    expect(result).not.toBeNull();
    // Should still pick the v0-v1 edge (closest endpoint v1).
    expect(result!.distance).toBeGreaterThan(0);
  });

  it('returns a result for a degenerate (collinear) triangle (endpoint distance)', () => {
    const result = findNearestTriangleEdge([0, 0, 0], [1, 0, 0], [2, 0, 0], [5, 0, 0]);
    expect(result).not.toBeNull();
  });
});

describe('dragSnapToGrid', () => {
  it('returns the value unchanged when gridSize is 0', () => {
    expect(dragSnapToGrid(3.7, 0)).toBe(3.7);
  });

  it('snaps to 1mm grid', () => {
    expect(dragSnapToGrid(2.6, 1)).toBe(3);
  });

  it('snaps negative values symmetrically', () => {
    expect(dragSnapToGrid(-2.6, 1)).toBe(-3);
  });

  it('passes through Infinity unchanged', () => {
    expect(dragSnapToGrid(Infinity, 0.1)).toBe(Infinity);
  });
});
