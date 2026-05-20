import { describe, it, expect } from 'vitest';
import {
  recognizePockets,
  triangleNormalArea,
  summarize,
  type MeshArrays,
} from './pocketRecognition';

/**
 * Pocket floor only (4x4 square at z=-2). Caller passes topHeightHintMm=0
 * to inform the recognizer where the part's top surface is.
 */
function pocketFloorOnly(): MeshArrays {
  return {
    positions: [
      3, 3, -2,  7, 3, -2,  7, 7, -2,  3, 7, -2,
    ],
    indices: [
      0, 1, 2,  0, 2, 3,
    ],
  };
}

function downwardOnlyPlate(): MeshArrays {
  // Plate facing -Z (e.g., bottom of a part) — should NOT register
  // as a pocket when pull axis is +Z.
  return {
    positions: [0, 0, 0,  10, 0, 0,  10, 10, 0,  0, 10, 0],
    indices: [0, 2, 1,  0, 3, 2],
  };
}

describe('recognizePockets', () => {
  it('empty mesh → no pockets', () => {
    const r = recognizePockets({ positions: [], indices: [] });
    expect(r.pockets).toEqual([]);
  });

  it('downward-facing plate → no pockets', () => {
    const r = recognizePockets(downwardOnlyPlate(), { topHeightHintMm: 0 });
    expect(r.pockets).toEqual([]);
  });

  it('plate with single pocket → 1 pocket', () => {
    const r = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0 });
    expect(r.pockets).toHaveLength(1);
  });

  it('pocket has expected floor area (4x4 = 16 mm²)', () => {
    const r = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0 });
    expect(r.pockets[0]!.floorAreaMm2).toBeCloseTo(16, 1);
  });

  it('pocket has expected depth (2 mm)', () => {
    const r = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0 });
    expect(r.pockets[0]!.depthMm).toBeCloseTo(2, 1);
  });

  it('pocket has expected boundary length (4*4 = 16 mm)', () => {
    const r = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0 });
    expect(r.pockets[0]!.boundaryLengthMm).toBeCloseTo(16, 0);
  });

  it('minFloorAreaMm2 filters out tiny pockets', () => {
    const r = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0, minFloorAreaMm2: 1000 });
    expect(r.pockets).toEqual([]);
    expect(r.orphanFloorTriangles.length).toBeGreaterThan(0);
  });

  it('aspect ratio ≥ 1', () => {
    const r = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0 });
    expect(r.pockets[0]!.aspectRatio).toBeGreaterThanOrEqual(1);
  });

  it('pockets sorted by area descending', () => {
    const r = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0 });
    for (let i = 1; i < r.pockets.length; i++) {
      expect(r.pockets[i]!.floorAreaMm2).toBeLessThanOrEqual(r.pockets[i - 1]!.floorAreaMm2);
    }
  });

  it('different pull axis changes candidates', () => {
    const a = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0, pullAxis: [0, 0, 1] });
    const b = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0, pullAxis: [1, 0, 0] });
    expect(a.pockets.length).not.toBe(b.pockets.length);
  });
});

describe('triangleNormalArea', () => {
  it('flat horizontal triangle has +Z normal and area 0.5', () => {
    const r = triangleNormalArea([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    expect(r.normal[2]).toBeCloseTo(1, 5);
    expect(r.area).toBeCloseTo(0.5, 5);
  });

  it('degenerate triangle has zero area', () => {
    const r = triangleNormalArea([0, 0, 0], [0, 0, 0], [0, 0, 0]);
    expect(r.area).toBe(0);
  });
});

describe('summarize', () => {
  it('empty pocket list → zero values', () => {
    const s = summarize({ pockets: [], orphanFloorTriangles: [] });
    expect(s.pocketCount).toBe(0);
    expect(s.totalFloorAreaMm2).toBe(0);
    expect(s.deepestPocketMm).toBe(0);
  });

  it('reports total + average + deepest', () => {
    const r = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0 });
    const s = summarize(r);
    expect(s.pocketCount).toBe(1);
    expect(s.totalFloorAreaMm2).toBeCloseTo(16, 1);
    expect(s.averageDepthMm).toBeCloseTo(2, 1);
    expect(s.deepestPocketMm).toBeCloseTo(2, 1);
  });

  it('detects slot-like pockets by aspect ratio', () => {
    const r = recognizePockets(pocketFloorOnly(), { topHeightHintMm: 0 });
    const s = summarize(r);
    // Square pocket → not slot-like.
    expect(s.hasSlotLikePockets).toBe(false);
  });
});
