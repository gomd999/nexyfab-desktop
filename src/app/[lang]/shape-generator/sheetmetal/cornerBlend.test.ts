import { describe, it, expect } from 'vitest';
import {
  blendCorner,
  summarize,
  type BendEdge,
} from './cornerBlend';

function edgeFromCorner(id: string, dirX: number, dirY: number, length: number = 10): BendEdge {
  // Points go from "away from corner" to "at corner" so last point IS the corner.
  return {
    id,
    points: [
      { x: -dirX * length, y: -dirY * length },
      { x: 0, y: 0 },
    ],
  };
}

const horizontalEdge = edgeFromCorner('h', 1, 0);
const verticalEdge = edgeFromCorner('v', 0, 1);

describe('blendCorner', () => {
  it('tangent-arc generates a curved polyline', () => {
    const r = blendCorner(horizontalEdge, verticalEdge, { kind: 'tangent-arc', radiusMm: 2 });
    expect(r.kind).toBe('tangent-arc');
    expect(r.blendPolyline.length).toBeGreaterThan(1);
  });

  it('chamfer produces 2 points', () => {
    const r = blendCorner(horizontalEdge, verticalEdge, { kind: 'chamfer', chamferLegMm: 3 });
    expect(r.kind).toBe('chamfer');
    expect(r.blendPolyline).toHaveLength(2);
  });

  it('bezier samples points', () => {
    const r = blendCorner(horizontalEdge, verticalEdge, { kind: 'bezier', radiusMm: 3, curveSamples: 10 });
    expect(r.kind).toBe('bezier');
    expect(r.blendPolyline.length).toBe(11);
  });

  it('arc area saved positive for inward blend', () => {
    const r = blendCorner(horizontalEdge, verticalEdge, { kind: 'tangent-arc', radiusMm: 2 });
    expect(r.areaDeltaMm2).toBeGreaterThan(0);
  });

  it('larger radius → more material removed', () => {
    const small = blendCorner(horizontalEdge, verticalEdge, { kind: 'tangent-arc', radiusMm: 1 });
    const big = blendCorner(horizontalEdge, verticalEdge, { kind: 'tangent-arc', radiusMm: 5 });
    expect(big.areaDeltaMm2).toBeGreaterThan(small.areaDeltaMm2);
  });

  it('trimmedA shorter than original by setback', () => {
    const r = blendCorner(horizontalEdge, verticalEdge, { kind: 'tangent-arc', radiusMm: 2 });
    expect(r.trimmedA[r.trimmedA.length - 1]).not.toEqual({ x: 0, y: 0 });
  });

  it('chamfer leg length respected', () => {
    const legLen = 5;
    const r = blendCorner(horizontalEdge, verticalEdge, { kind: 'chamfer', chamferLegMm: legLen });
    const t1 = r.blendPolyline[0]!;
    const dist = Math.hypot(t1.x, t1.y);
    expect(dist).toBeCloseTo(legLen, 1);
  });

  it('curveSamples affects arc point count', () => {
    const sparse = blendCorner(horizontalEdge, verticalEdge, { kind: 'tangent-arc', radiusMm: 2, curveSamples: 4 });
    const dense = blendCorner(horizontalEdge, verticalEdge, { kind: 'tangent-arc', radiusMm: 2, curveSamples: 20 });
    expect(dense.blendPolyline.length).toBeGreaterThan(sparse.blendPolyline.length);
  });

  it('parallel edges (180° angle) returns degenerate blend', () => {
    const opposite = edgeFromCorner('o', -1, 0);
    const r = blendCorner(horizontalEdge, opposite, { kind: 'tangent-arc' });
    expect(r.blendPolyline.length).toBeGreaterThanOrEqual(1);
  });

  it('chamfer area = triangle area', () => {
    const r = blendCorner(horizontalEdge, verticalEdge, { kind: 'chamfer', chamferLegMm: 4 });
    // Triangle (0,0), (4,0), (0,4) → area 8.
    expect(r.areaDeltaMm2).toBeCloseTo(8, 1);
  });
});

describe('summarize', () => {
  it('reports kind', () => {
    const r = blendCorner(horizontalEdge, verticalEdge, { kind: 'tangent-arc' });
    const s = summarize(r);
    expect(s.kind).toBe('tangent-arc');
  });

  it('isMaterialRemoved when areaDelta > 0', () => {
    const r = blendCorner(horizontalEdge, verticalEdge, { kind: 'chamfer', chamferLegMm: 3 });
    const s = summarize(r);
    expect(s.isMaterialRemoved).toBe(true);
  });
});
