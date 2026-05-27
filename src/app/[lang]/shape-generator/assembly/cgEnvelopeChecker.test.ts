import { describe, it, expect } from 'vitest';
import {
  checkEnvelope,
  suggestRebalance,
  summarize,
  type MassBody,
  type EnvelopePolygon,
} from './cgEnvelopeChecker';

const squareEnvelope: EnvelopePolygon = {
  vertices: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }],
  zPlane: 0,
  zToleranceMm: 5,
};

function body(id: string, mass: number, x: number, y: number, z: number = 0, movable: boolean = false): MassBody {
  return { id, massKg: mass, position: { x, y, z }, movable };
}

describe('checkEnvelope', () => {
  it('empty → not inside', () => {
    const r = checkEnvelope([], squareEnvelope);
    expect(r.insideEnvelope).toBe(false);
  });

  it('CG at origin → inside', () => {
    const r = checkEnvelope([body('a', 1, 0, 0)], squareEnvelope);
    expect(r.insideEnvelope).toBe(true);
  });

  it('CG outside → not inside', () => {
    const r = checkEnvelope([body('a', 1, 50, 0)], squareEnvelope);
    expect(r.insideEnvelope).toBe(false);
  });

  it('mass weighted CG', () => {
    const r = checkEnvelope([body('a', 10, 0, 0), body('b', 1, 10, 0)], squareEnvelope);
    // CG ≈ (10*0 + 1*10)/11 = 0.91 → inside.
    expect(r.cg.x).toBeCloseTo(10 / 11, 3);
  });

  it('zero mass → not inside', () => {
    const r = checkEnvelope([body('a', 0, 0, 0)], squareEnvelope);
    expect(r.totalMassKg).toBe(0);
  });

  it('zDeviation tracks |Δz|', () => {
    const r = checkEnvelope([body('a', 1, 0, 0, 3)], squareEnvelope);
    expect(r.zDeviationMm).toBeCloseTo(3, 3);
  });

  it('zWithinTolerance true when small Δz', () => {
    const r = checkEnvelope([body('a', 1, 0, 0, 3)], squareEnvelope);
    expect(r.zWithinTolerance).toBe(true);
  });

  it('zWithinTolerance false when big Δz', () => {
    const r = checkEnvelope([body('a', 1, 0, 0, 100)], squareEnvelope);
    expect(r.zWithinTolerance).toBe(false);
  });

  it('clearance positive when inside, negative when outside', () => {
    const inside = checkEnvelope([body('a', 1, 0, 0)], squareEnvelope);
    const outside = checkEnvelope([body('a', 1, 50, 0)], squareEnvelope);
    expect(inside.clearanceMm).toBeGreaterThan(0);
    expect(outside.clearanceMm).toBeLessThan(0);
  });
});

describe('suggestRebalance', () => {
  it('inside envelope → no suggestion', () => {
    expect(suggestRebalance([body('a', 1, 0, 0)], squareEnvelope)).toBeNull();
  });

  it('no movable bodies → no suggestion', () => {
    expect(suggestRebalance([body('a', 1, 50, 0, 0, false)], squareEnvelope)).toBeNull();
  });

  it('returns delta for heaviest movable', () => {
    const bodies = [body('light', 1, 0, 0, 0, true), body('heavy', 10, 50, 0, 0, true)];
    const r = suggestRebalance(bodies, squareEnvelope);
    expect(r).not.toBeNull();
    expect(r!.bodyId).toBe('heavy');
  });

  it('delta moves CG toward edge', () => {
    const r = suggestRebalance([body('heavy', 10, 50, 0, 0, true)], squareEnvelope);
    expect(r!.proposedDelta.x).toBeLessThan(0);
  });
});

describe('summarize', () => {
  it('reports CG status', () => {
    const r = checkEnvelope([body('a', 1, 0, 0)], squareEnvelope);
    const s = summarize(r);
    expect(s.insideEnvelope).toBe(true);
    expect(s.totalMassKg).toBe(1);
  });
});
