import { describe, it, expect } from 'vitest';
import {
  analyzeEdgeFlange,
  analyzeMiterFlange,
  generateTabSlot,
  analyzeLouver,
  lanceForce,
  analyzeDimple,
  type EdgeRef,
} from './sheetMetalExtended';

const edge1: EdgeRef = {
  bodyId: 'b1', edgeIndex: 0, lengthMm: 100, direction: [1, 0, 0],
};

describe('analyzeEdgeFlange', () => {
  it('valid 90° flange returns positive bend allowance', () => {
    const r = analyzeEdgeFlange({
      edge: edge1, thicknessMm: 1.5, innerRadiusMm: 2, angleDeg: 90, flangeLengthMm: 10, gapEnds: true,
    });
    expect(r.bendAllowanceMm).toBeGreaterThan(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('flange too short → warning', () => {
    const r = analyzeEdgeFlange({
      edge: edge1, thicknessMm: 2, innerRadiusMm: 3, angleDeg: 90, flangeLengthMm: 3, gapEnds: true,
    });
    expect(r.warnings.some(w => w.includes('< minimum'))).toBe(true);
  });

  it('bend radius < thickness → crack warning', () => {
    const r = analyzeEdgeFlange({
      edge: edge1, thicknessMm: 3, innerRadiusMm: 1, angleDeg: 90, flangeLengthMm: 15, gapEnds: true,
    });
    expect(r.warnings.some(w => w.includes('crack'))).toBe(true);
  });

  it('over-bend without gap ends → warning', () => {
    const r = analyzeEdgeFlange({
      edge: edge1, thicknessMm: 1.5, innerRadiusMm: 2, angleDeg: 120, flangeLengthMm: 15, gapEnds: false,
    });
    expect(r.warnings.some(w => w.includes('Over-bend'))).toBe(true);
  });
});

describe('analyzeMiterFlange', () => {
  it('returns corner angle = 90° for perpendicular edges', () => {
    const r = analyzeMiterFlange({
      edges: [edge1, { ...edge1, direction: [0, 1, 0] }],
      thicknessMm: 1.5, innerRadiusMm: 2, flangeLengthMm: 10,
    });
    expect(r.corners[0]!.cornerAngleDeg).toBeCloseTo(90, 4);
  });

  it('warns on tight (< 30°) corners', () => {
    const r = analyzeMiterFlange({
      edges: [edge1, { ...edge1, direction: [0.99, 0.14, 0] }],
      thicknessMm: 1.5, innerRadiusMm: 2, flangeLengthMm: 10,
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('fewer than 2 edges → empty corners + warning', () => {
    const r = analyzeMiterFlange({
      edges: [edge1], thicknessMm: 1.5, innerRadiusMm: 2, flangeLengthMm: 10,
    });
    expect(r.corners).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('generateTabSlot', () => {
  it('returns N tabs + N matching slots', () => {
    const r = generateTabSlot(edge1, { widthMm: 10, heightMm: 5, clearanceMm: 0.5 }, 3);
    expect(r.tabSide.tabs).toHaveLength(3);
    expect(r.slotSide.slots).toHaveLength(3);
  });

  it('slot wider than tab by 2× clearance', () => {
    const r = generateTabSlot(edge1, { widthMm: 10, heightMm: 5, clearanceMm: 0.5 }, 2);
    expect(r.slotSide.slots[0]!.widthMm).toBe(11);
  });

  it('count = 0 returns empty', () => {
    const r = generateTabSlot(edge1, { widthMm: 10, heightMm: 5, clearanceMm: 0.5 }, 0);
    expect(r.tabSide.tabs).toHaveLength(0);
  });

  it('tab positions within edge length', () => {
    const r = generateTabSlot(edge1, { widthMm: 10, heightMm: 5, clearanceMm: 0.5 }, 5);
    for (const t of r.tabSide.tabs) {
      expect(t.positionAlongEdgeMm).toBeGreaterThanOrEqual(0);
      expect(t.positionAlongEdgeMm).toBeLessThanOrEqual(100);
    }
  });
});

describe('analyzeLouver', () => {
  it('larger opening → larger bend angle', () => {
    const small = analyzeLouver({ widthMm: 30, lengthMm: 80, openingMm: 5, thicknessMm: 1.5 });
    const big = analyzeLouver({ widthMm: 30, lengthMm: 80, openingMm: 20, thicknessMm: 1.5 });
    expect(big.bendAngleDeg).toBeGreaterThan(small.bendAngleDeg);
  });

  it('cut length includes the 3 cut sides', () => {
    const r = analyzeLouver({ widthMm: 30, lengthMm: 80, openingMm: 10, thicknessMm: 1.5 });
    expect(r.cutLengthMm).toBe(30 + 80);
  });

  it('opening < 2t → "functionally closed" warning', () => {
    const r = analyzeLouver({ widthMm: 30, lengthMm: 80, openingMm: 2, thicknessMm: 1.5 });
    expect(r.warnings.some(w => w.includes('closed'))).toBe(true);
  });

  it('extreme bend > 30° → tear warning', () => {
    const r = analyzeLouver({ widthMm: 30, lengthMm: 80, openingMm: 60, thicknessMm: 1.5 });
    expect(r.warnings.some(w => w.includes('tear'))).toBe(true);
  });
});

describe('lanceForce', () => {
  it('scales with cut length × thickness × UTS', () => {
    const r1 = lanceForce({ cutLengthMm: 20, formHeightMm: 5, thicknessMm: 1 }, 400);
    const r2 = lanceForce({ cutLengthMm: 40, formHeightMm: 5, thicknessMm: 1 }, 400);
    expect(r2).toBeCloseTo(r1 * 2, 4);
  });

  it('higher UTS → higher force', () => {
    const mild = lanceForce({ cutLengthMm: 20, formHeightMm: 5, thicknessMm: 1 }, 400);
    const high = lanceForce({ cutLengthMm: 20, formHeightMm: 5, thicknessMm: 1 }, 800);
    expect(high).toBe(mild * 2);
  });
});

describe('analyzeDimple', () => {
  it('zero depth → no stretch', () => {
    const r = analyzeDimple({ rimDiameterMm: 10, depthMm: 0, thicknessMm: 1 });
    expect(r.stretchRatio).toBe(1);
    expect(r.surfaceAreaMm2).toBe(0);
  });

  it('higher depth → higher stretch', () => {
    const shallow = analyzeDimple({ rimDiameterMm: 10, depthMm: 1, thicknessMm: 1 });
    const deep = analyzeDimple({ rimDiameterMm: 10, depthMm: 4, thicknessMm: 1 });
    expect(deep.stretchRatio).toBeGreaterThan(shallow.stretchRatio);
  });

  it('warns when stretch > 1.2 (>15% thinning)', () => {
    const r = analyzeDimple({ rimDiameterMm: 10, depthMm: 5, thicknessMm: 1 });
    expect(r.warnings.some(w => w.includes('stretch'))).toBe(true);
  });

  it('warns when rim < 6× thickness', () => {
    const r = analyzeDimple({ rimDiameterMm: 5, depthMm: 1, thicknessMm: 1 });
    expect(r.warnings.some(w => w.includes('rim'))).toBe(true);
  });
});
