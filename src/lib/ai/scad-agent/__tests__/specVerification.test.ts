/**
 * specVerification.test.ts — Phase X1.
 *
 * Pure unit tests: expectedBboxFromIntent covers each supported shape,
 * compareBbox honors tolerance windows, verifyAgainstSpec wires them
 * together, formatSpecCritique produces actionable text.
 */
import { describe, it, expect } from 'vitest';
import {
  expectedBboxFromIntent,
  compareBbox,
  verifyAgainstSpec,
  formatSpecCritique,
  type MeasuredBbox,
} from '../specVerification';
import type { IntentInput } from '../../../openscad-render/intentToScad';

const bboxFromSize = (w: number, h: number, d: number, centered = true): MeasuredBbox => {
  if (centered) {
    return {
      min: [-w / 2, -h / 2, -d / 2],
      max: [w / 2, h / 2, d / 2],
    };
  }
  return { min: [0, 0, 0], max: [w, h, d] };
};

describe('expectedBboxFromIntent', () => {
  it('box: w/h/d explicit', () => {
    const r = expectedBboxFromIntent({ shapeId: 'box', params: { width: 50, height: 60, depth: 70 } });
    expect(r).toEqual({ centered: true, wMm: 50, hMm: 60, dMm: 70 });
  });

  it('box: short-key aliases (w/h/d)', () => {
    const r = expectedBboxFromIntent({ shapeId: 'box', params: { w: 10, h: 20, d: 30 } });
    expect(r).toEqual({ centered: true, wMm: 10, hMm: 20, dMm: 30 });
  });

  it('cylinder: diameter+height', () => {
    const r = expectedBboxFromIntent({ shapeId: 'cylinder', params: { diameter: 20, height: 50 } });
    expect(r).toEqual({ centered: true, wMm: 20, hMm: 20, dMm: 50 });
  });

  it('sphere: diameter drives all 3 axes', () => {
    const r = expectedBboxFromIntent({ shapeId: 'sphere', params: { diameter: 40 } });
    expect(r).toEqual({ centered: true, wMm: 40, hMm: 40, dMm: 40 });
  });

  it('cone: max(r1, r2) × 2 for width/height', () => {
    const r = expectedBboxFromIntent({ shapeId: 'cone', params: { bottomDiameter: 40, topDiameter: 20, height: 30 } });
    expect(r).toEqual({ centered: true, wMm: 40, hMm: 40, dMm: 30 });
    // Inverted cone (top wider than bottom)
    const r2 = expectedBboxFromIntent({ shapeId: 'cone', params: { bottomDiameter: 10, topDiameter: 30, height: 20 } });
    expect(r2).toEqual({ centered: true, wMm: 30, hMm: 30, dMm: 20 });
  });

  it('pipe: outer diameter drives bbox', () => {
    const r = expectedBboxFromIntent({ shapeId: 'pipe', params: { outerDiameter: 30, innerDiameter: 20, length: 100 } });
    expect(r).toEqual({ centered: true, wMm: 30, hMm: 30, dMm: 100 });
  });

  it('disk: diameter × thickness', () => {
    const r = expectedBboxFromIntent({ shapeId: 'disk', params: { diameter: 80, thickness: 5 } });
    expect(r).toEqual({ centered: true, wMm: 80, hMm: 80, dMm: 5 });
  });

  it('washer: outer diameter × thickness', () => {
    const r = expectedBboxFromIntent({ shapeId: 'washer', params: { outerDiameter: 25, innerDiameter: 8, thickness: 2 } });
    expect(r).toEqual({ centered: true, wMm: 25, hMm: 25, dMm: 2 });
  });

  it('hexNut: across-corners = afs / cos(30°)', () => {
    const r = expectedBboxFromIntent({ shapeId: 'hexNut', params: { acrossFlats: 13, thickness: 8 } });
    // 13 / cos(30°) = 15.011
    expect(r?.wMm).toBeCloseTo(15.011, 2);
    expect(r?.hMm).toBeCloseTo(15.011, 2);
    expect(r?.dMm).toBe(8);
  });

  it('flange: outer diameter × thickness', () => {
    const r = expectedBboxFromIntent({ shapeId: 'flange', params: { outerDiameter: 120, thickness: 15 } });
    expect(r).toEqual({ centered: true, wMm: 120, hMm: 120, dMm: 15 });
  });

  it('iBeam: flange width × beam height × length', () => {
    const r = expectedBboxFromIntent({ shapeId: 'iBeam', params: { flangeWidth: 60, beamHeight: 100, length: 200 } });
    expect(r).toEqual({ centered: true, wMm: 60, hMm: 100, dMm: 200 });
  });

  it('lBracket: not centered (origin-anchored)', () => {
    const r = expectedBboxFromIntent({ shapeId: 'lBracket', params: { width: 50, height: 40, depth: 30 } });
    expect(r).toEqual({ centered: false, wMm: 50, hMm: 40, dMm: 30 });
  });

  it('wedge: not centered', () => {
    const r = expectedBboxFromIntent({ shapeId: 'wedge', params: { width: 50, height: 50, depth: 50 } });
    expect(r?.centered).toBe(false);
  });

  it('torus: (major + tube) × 2 × tube', () => {
    const r = expectedBboxFromIntent({ shapeId: 'torus', params: { majorDiameter: 60, tubeDiameter: 10 } });
    // outer = 60 + 10 = 70 (wMm = hMm), dMm = 10
    expect(r).toEqual({ centered: true, wMm: 70, hMm: 70, dMm: 10 });
  });

  it('returns null for unknown shapes', () => {
    expect(expectedBboxFromIntent({ shapeId: 'gear', params: { teeth: 20, module: 2 } })).toBeNull();
    expect(expectedBboxFromIntent({ shapeId: 'unknown_shape', params: {} })).toBeNull();
  });

  it('returns null when bbox-distorting feature is present', () => {
    const i: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'scale', x: 2, y: 1, z: 1 } as never],
    };
    expect(expectedBboxFromIntent(i)).toBeNull();
  });

  it('returns null when linearPattern would extend the bbox', () => {
    const i: IntentInput = {
      shapeId: 'box',
      params: { width: 10, height: 10, depth: 10 },
      features: [{ type: 'linearPattern', count: 3, spacing: 20, axis: 'x' } as never],
    };
    expect(expectedBboxFromIntent(i)).toBeNull();
  });

  it('still computes bbox when only bbox-preserving features (hole/fillet/chamfer/shell)', () => {
    const i: IntentInput = {
      shapeId: 'box',
      params: { width: 30, height: 30, depth: 30 },
      features: [
        { type: 'hole', diameter: 5, depth: 30 } as never,
        { type: 'fillet', radius: 2 } as never,
        { type: 'chamfer', size: 1 } as never,
      ],
    };
    const r = expectedBboxFromIntent(i);
    expect(r).toEqual({ centered: true, wMm: 30, hMm: 30, dMm: 30 });
  });
});

describe('compareBbox', () => {
  it('returns no mismatches for an exact match', () => {
    const exp = { centered: true, wMm: 50, hMm: 50, dMm: 50 };
    const meas = bboxFromSize(50, 50, 50);
    expect(compareBbox(exp, meas)).toEqual([]);
  });

  it('passes within default tolerance window', () => {
    const exp = { centered: true, wMm: 50, hMm: 50, dMm: 50 };
    const meas = bboxFromSize(50.4, 49.7, 50.2); // within 0.5mm absolute tol
    expect(compareBbox(exp, meas)).toEqual([]);
  });

  it('flags an axis where the deviation exceeds tol', () => {
    const exp = { centered: true, wMm: 50, hMm: 50, dMm: 50 };
    const meas = bboxFromSize(75, 50, 50);
    const mm = compareBbox(exp, meas);
    expect(mm).toHaveLength(1);
    expect(mm[0].axis).toBe('width');
    expect(mm[0].deltaMm).toBe(25);
    expect(mm[0].deltaPct).toBe(50);
  });

  it('flags all 3 axes when all off', () => {
    const exp = { centered: true, wMm: 10, hMm: 10, dMm: 10 };
    const meas = bboxFromSize(20, 30, 40);
    const mm = compareBbox(exp, meas);
    expect(mm).toHaveLength(3);
  });

  it('1% tol scales with size (100mm → 1mm tol)', () => {
    const exp = { centered: true, wMm: 100, hMm: 100, dMm: 100 };
    const meas = bboxFromSize(100.9, 100.9, 100.9); // 0.9% off
    expect(compareBbox(exp, meas)).toEqual([]);
  });

  it('skips a zero/negative expected axis (defensive)', () => {
    const exp = { centered: true, wMm: 0, hMm: 50, dMm: 50 };
    const meas = bboxFromSize(100, 50, 50);
    const mm = compareBbox(exp, meas);
    // width skipped, h+d match → no mismatches
    expect(mm).toHaveLength(0);
  });
});

describe('verifyAgainstSpec', () => {
  it('verifies a matching box', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const meas = bboxFromSize(50, 50, 50);
    const r = verifyAgainstSpec(intent, meas);
    expect(r.ok).toBe(true);
    expect(r.verifiable).toBe(true);
    expect(r.mismatches).toEqual([]);
  });

  it('reports mismatch when the AI dropped a zero (5mm vs 50mm box)', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const meas = bboxFromSize(5, 50, 50); // AI emitted width=5
    const r = verifyAgainstSpec(intent, meas);
    expect(r.ok).toBe(false);
    expect(r.verifiable).toBe(true);
    expect(r.mismatches[0].axis).toBe('width');
    expect(r.mismatches[0].deltaMm).toBe(-45);
  });

  it('marks unverifiable when shape unsupported', () => {
    const intent: IntentInput = { shapeId: 'gear', params: { teeth: 20, module: 2 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(40, 40, 8));
    expect(r.ok).toBe(true);
    expect(r.verifiable).toBe(false);
    expect(r.skipReason).toContain('gear');
    expect(r.mismatches).toEqual([]);
  });

  it('marks unverifiable when a distorting feature is present', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'scale', x: 2, y: 1, z: 1 } as never],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(100, 50, 50));
    expect(r.ok).toBe(true);
    expect(r.verifiable).toBe(false);
  });
});

describe('formatSpecCritique', () => {
  it('emits a success line when ok', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    const text = formatSpecCritique(r);
    expect(text).toMatch(/spec ok/);
    expect(text).toMatch(/50\.00.*50\.00.*50\.00/);
  });

  it('emits per-axis mismatch lines with sign + delta + percent', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(75, 50, 25));
    const text = formatSpecCritique(r);
    expect(text).toMatch(/spec mismatch/);
    expect(text).toMatch(/width.*expected 50\.00.*measured 75\.00.*\+25\.00.*\+50\.0%/);
    expect(text).toMatch(/depth.*expected 50\.00.*measured 25\.00.*-25\.00.*-50\.0%/);
    expect(text).toMatch(/Re-emit intent/);
  });

  it('emits the skip reason for unverifiable shapes', () => {
    const intent: IntentInput = { shapeId: 'gear', params: {} };
    const r = verifyAgainstSpec(intent, bboxFromSize(40, 40, 8));
    expect(formatSpecCritique(r)).toMatch(/gear/);
  });
});

describe('Phase X2 — hole count check', () => {
  const boxIntent = (holeCount: number): IntentInput => ({
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
    features: Array.from({ length: holeCount }, () => ({
      type: 'hole',
      params: { diameter: 5 },
    } as never)),
  });

  it('passes when expected hole count matches detected genus', () => {
    const r = verifyAgainstSpec(boxIntent(2), bboxFromSize(50, 50, 50), { detectedGenus: 2 });
    expect(r.ok).toBe(true);
    expect(r.holeCount).toEqual({ expected: 2, detected: 2, mismatch: null });
    expect(formatSpecCritique(r)).toMatch(/Through-holes: 2/);
  });

  it('flags mismatch when AI drilled fewer holes than requested', () => {
    const r = verifyAgainstSpec(boxIntent(3), bboxFromSize(50, 50, 50), { detectedGenus: 1 });
    expect(r.ok).toBe(false);
    expect(r.holeCount).toEqual({ expected: 3, detected: 1, mismatch: { delta: -2 } });
    const text = formatSpecCritique(r);
    expect(text).toMatch(/through-holes.*expected 3.*detected 1.*-2/);
  });

  it('flags mismatch when AI drilled too many', () => {
    const r = verifyAgainstSpec(boxIntent(1), bboxFromSize(50, 50, 50), { detectedGenus: 3 });
    expect(r.ok).toBe(false);
    expect(r.holeCount?.mismatch?.delta).toBe(2);
  });

  it('skips hole check when detectedGenus is null (mesh not single closed manifold)', () => {
    const r = verifyAgainstSpec(boxIntent(2), bboxFromSize(50, 50, 50), { detectedGenus: null });
    expect(r.holeCount).toEqual({ expected: 2, detected: null, mismatch: null });
    expect(r.ok).toBe(true); // bbox ok, hole check suppressed
  });

  it('skips hole check entirely when intent has no hole features', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), { detectedGenus: 1 });
    // No hole features → no holeCount field at all (avoids "matches intent" line)
    expect(r.holeCount).toBeUndefined();
  });

  it('skips hole check when detectedGenus omitted', () => {
    const r = verifyAgainstSpec(boxIntent(2), bboxFromSize(50, 50, 50));
    expect(r.holeCount).toBeUndefined();
  });

  it('bbox mismatch + hole mismatch both surface in the critique', () => {
    const r = verifyAgainstSpec(boxIntent(2), bboxFromSize(75, 50, 50), { detectedGenus: 1 });
    expect(r.ok).toBe(false);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/width.*expected 50/);
    expect(text).toMatch(/through-holes.*expected 2.*detected 1/);
  });
});
