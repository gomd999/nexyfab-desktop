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
  expectedVolumeFromIntent,
  compareVolume,
  expectedSurfaceAreaFromIntent,
  compareSurfaceArea,
  detectIntentInconsistencies,
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
    // X10 lands a duplicate-hole check that would flag identical-position
    // holes. Stagger positions so each hole has a unique footprint.
    features: Array.from({ length: holeCount }, (_, i) => ({
      type: 'hole',
      params: { diameter: 5, x: -15 + i * 10, y: 0 },
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

describe('Phase X3 — expectedVolumeFromIntent', () => {
  it('box: w × h × d', () => {
    const v = expectedVolumeFromIntent({ shapeId: 'box', params: { width: 50, height: 50, depth: 50 } });
    expect(v?.baseVolumeMm3).toBeCloseTo(125000, 1);
    expect(v?.holeVolumeMm3).toBe(0);
    expect(v?.expectedTotalMm3).toBeCloseTo(125000, 1);
  });

  it('cylinder: π × r² × h', () => {
    const v = expectedVolumeFromIntent({ shapeId: 'cylinder', params: { diameter: 20, height: 50 } });
    expect(v?.baseVolumeMm3).toBeCloseTo(Math.PI * 100 * 50, 1);
  });

  it('sphere: (4/3) × π × r³', () => {
    const v = expectedVolumeFromIntent({ shapeId: 'sphere', params: { diameter: 10 } });
    expect(v?.baseVolumeMm3).toBeCloseTo((4 / 3) * Math.PI * 125, 1);
  });

  it('pipe: hollow cylinder', () => {
    const v = expectedVolumeFromIntent({ shapeId: 'pipe', params: { outerDiameter: 30, innerDiameter: 20, length: 100 } });
    const expected = Math.PI * (225 - 100) * 100;
    expect(v?.baseVolumeMm3).toBeCloseTo(expected, 1);
  });

  it('hexNut: (√3/2) × afs² × t - bore', () => {
    const v = expectedVolumeFromIntent({ shapeId: 'hexNut', params: { acrossFlats: 13, thickness: 8, nominalDiameter: 8 } });
    const hex = (Math.sqrt(3) / 2) * 169 * 8;
    const bore = Math.PI * 16 * 8;
    expect(v?.baseVolumeMm3).toBeCloseTo(hex - bore, 1);
  });

  it('torus: 2π² × R × r²', () => {
    const v = expectedVolumeFromIntent({ shapeId: 'torus', params: { majorDiameter: 60, tubeDiameter: 10 } });
    const expected = 2 * Math.PI * Math.PI * 30 * 25;
    expect(v?.baseVolumeMm3).toBeCloseTo(expected, 1);
  });

  it('box with 1 through-hole subtracts π × r² × parent_depth', () => {
    const v = expectedVolumeFromIntent({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10 } } as never],
    });
    const holeVol = Math.PI * 25 * 50;
    expect(v?.holeVolumeMm3).toBeCloseTo(holeVol, 1);
    expect(v?.expectedTotalMm3).toBeCloseTo(125000 - holeVol, 1);
    expect(v?.holeBreakdown[0].through).toBe(true);
  });

  it('box with blind hole (depth < parent) subtracts only the blind depth', () => {
    const v = expectedVolumeFromIntent({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10, depth: 20 } } as never],
    });
    const holeVol = Math.PI * 25 * 20;
    expect(v?.holeVolumeMm3).toBeCloseTo(holeVol, 1);
    expect(v?.holeBreakdown[0].through).toBe(false);
    expect(v?.holeBreakdown[0].depth).toBe(20);
  });

  it('returns null for unsupported shapes', () => {
    expect(expectedVolumeFromIntent({ shapeId: 'gear', params: {} })).toBeNull();
    expect(expectedVolumeFromIntent({ shapeId: 'lBracket', params: {} })).toBeNull();
  });

  it('returns null when distorting feature present', () => {
    const r = expectedVolumeFromIntent({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'scale', x: 2 } as never],
    });
    expect(r).toBeNull();
  });
});

describe('compareVolume', () => {
  it('passes within max(50 mm³, 3%) tolerance', () => {
    // 125000 mm³, 3% = 3750 mm³. A 3000 mm³ deviation should pass.
    expect(compareVolume(125000, 128000)).toBeNull();
  });

  it('flags excess deviation', () => {
    const m = compareVolume(125000, 100000);
    expect(m).not.toBeNull();
    expect(m?.deltaMm3).toBe(-25000);
    expect(m?.deltaPct).toBeCloseTo(-20, 1);
  });

  it('honors absolute floor (50 mm³)', () => {
    // 1000 mm³ × 3% = 30 mm³ — but absolute floor is 50.
    expect(compareVolume(1000, 1040)).toBeNull(); // 40 mm³ < 50 mm³ floor
    expect(compareVolume(1000, 1100)).not.toBeNull(); // 100 mm³ > 50 mm³ floor
  });

  it('skips when expected <= 0', () => {
    expect(compareVolume(0, 100)).toBeNull();
    expect(compareVolume(-10, 100)).toBeNull();
  });
});

describe('Phase X3 — verifyAgainstSpec volume integration', () => {
  it('passes when measured volume matches intent (with through-hole)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10 } } as never],
    };
    const expectedVol = 125000 - Math.PI * 25 * 50;
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedGenus: 1,
      detectedVolumeMm3: expectedVol, // exact match
    });
    expect(r.ok).toBe(true);
    expect(r.volume?.mismatch).toBeNull();
  });

  it('catches missing blind hole (genus + bbox pass, volume catches it)', () => {
    // Intent declares a Ø20×40mm blind hole → expects -12566 mm³ (10% of part).
    // AI forgot to drill it → measured = full 125000. > 3% tolerance, mismatch.
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 20, depth: 40 } } as never],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedGenus: 0, // no through-hole — correct for blind hole
      detectedVolumeMm3: 125000, // full volume → hole missing
    });
    expect(r.ok).toBe(false);
    expect(r.volume?.mismatch).not.toBeNull();
    expect(r.volume?.mismatch?.deltaMm3).toBeGreaterThan(0); // measured > expected
    const text = formatSpecCritique(r);
    expect(text).toMatch(/volume.*expected.*measured/);
    expect(text).toMatch(/intent hole subtraction.*Ø20.*blind/);
  });

  it('catches wrong hole diameter (genus matches but volume off)', () => {
    // Intent: 1 through-hole Ø10. AI drilled Ø20 instead.
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10 } } as never],
    };
    const expectedVol = 125000 - Math.PI * 25 * 50;     // ~121,073
    const actualVol  = 125000 - Math.PI * 100 * 50;     // ~109,292 — bigger hole
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedGenus: 1, // through-hole present
      detectedVolumeMm3: actualVol,
    });
    expect(r.ok).toBe(false);
    expect(r.holeCount?.mismatch).toBeNull(); // count matches
    expect(r.volume?.mismatch).not.toBeNull();
    expect(r.volume?.mismatch?.deltaMm3).toBeLessThan(0); // less material than expected
  });

  it('skips volume check when shape unsupported (gear)', () => {
    const intent: IntentInput = { shapeId: 'gear', params: { teeth: 20, module: 2 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(40, 40, 8), { detectedVolumeMm3: 1000 });
    expect(r.volume).toBeUndefined();
  });

  it('skips volume check when detectedVolumeMm3 omitted', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    expect(r.volume).toBeUndefined();
  });
});

describe('Phase X5 — expectedSurfaceAreaFromIntent', () => {
  it('box 50³: 2 × (50² + 50² + 50²) = 15000 mm²', () => {
    const a = expectedSurfaceAreaFromIntent({ shapeId: 'box', params: { width: 50, height: 50, depth: 50 } });
    expect(a?.baseAreaMm2).toBeCloseTo(15000, 1);
    expect(a?.holeAreaDeltaMm2).toBe(0);
    expect(a?.expectedTotalMm2).toBeCloseTo(15000, 1);
  });

  it('cylinder Ø20 × 50: 2πrh + 2πr² = π(20·50 + 200)', () => {
    const a = expectedSurfaceAreaFromIntent({ shapeId: 'cylinder', params: { diameter: 20, height: 50 } });
    const expected = 2 * Math.PI * 10 * 50 + 2 * Math.PI * 100;
    expect(a?.baseAreaMm2).toBeCloseTo(expected, 1);
  });

  it('sphere Ø10: 4πr² = 100π', () => {
    const a = expectedSurfaceAreaFromIntent({ shapeId: 'sphere', params: { diameter: 10 } });
    expect(a?.baseAreaMm2).toBeCloseTo(100 * Math.PI, 1);
  });

  it('through-hole adds 2πr × parent_depth, removes 2 × πr² caps', () => {
    // Box 50³ with Ø10 through-hole along z (parent_depth = 50)
    // delta = -2π × 25 + 2π × 5 × 50 = -50π + 500π = 450π
    const a = expectedSurfaceAreaFromIntent({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10 } } as never],
    });
    expect(a?.holeAreaDeltaMm2).toBeCloseTo(450 * Math.PI, 1);
    expect(a?.holeBreakdown[0].through).toBe(true);
    expect(a?.expectedTotalMm2).toBeCloseTo(15000 + 450 * Math.PI, 1);
  });

  it('blind hole: delta = 2πr × depth (the floor cancels the missing entrance cap)', () => {
    const a = expectedSurfaceAreaFromIntent({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10, depth: 20 } } as never],
    });
    expect(a?.holeBreakdown[0].through).toBe(false);
    expect(a?.holeAreaDeltaMm2).toBeCloseTo(2 * Math.PI * 5 * 20, 1);
  });

  it('returns null for unsupported shape (lBracket)', () => {
    expect(expectedSurfaceAreaFromIntent({ shapeId: 'lBracket', params: {} })).toBeNull();
  });

  it('returns null when distorting feature present', () => {
    const a = expectedSurfaceAreaFromIntent({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'mirror', axis: 'x' } as never],
    });
    expect(a).toBeNull();
  });
});

describe('compareSurfaceArea', () => {
  it('passes within max(20 mm², 5%) tolerance', () => {
    expect(compareSurfaceArea(15000, 15500)).toBeNull(); // 3.3% < 5%
  });

  it('flags excess deviation', () => {
    const m = compareSurfaceArea(15000, 30000);
    expect(m).not.toBeNull();
    expect(m?.deltaMm2).toBe(15000);
    expect(m?.deltaPct).toBeCloseTo(100, 1);
  });

  it('honors absolute floor (20 mm²)', () => {
    // 100 mm² × 5% = 5 mm² → floor 20 wins
    expect(compareSurfaceArea(100, 115)).toBeNull(); // 15 mm² < 20 floor
    expect(compareSurfaceArea(100, 130)).not.toBeNull(); // 30 mm² > 20 floor
  });
});

describe('Phase X5 — verifyAgainstSpec surface area integration', () => {
  it('passes when measured area matches intent', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedSurfaceAreaMm2: 15000,
    });
    expect(r.ok).toBe(true);
    expect(r.surfaceArea?.mismatch).toBeNull();
  });

  it('catches hollow-shell artifact: bbox+volume look right but area is 2×', () => {
    // 50³ cube with all 6 inner walls accidentally generated → 30000 mm²
    // (almost 2× expected 15000).
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedSurfaceAreaMm2: 30000,
    });
    expect(r.ok).toBe(false);
    expect(r.surfaceArea?.mismatch).not.toBeNull();
    const text = formatSpecCritique(r);
    expect(text).toMatch(/surface area.*\+15000.*mm²/);
    expect(text).toMatch(/hollow shell|extra ribs|duplicated/);
  });

  it('catches missing-wall: area significantly less than expected', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedSurfaceAreaMm2: 10000,
    });
    expect(r.ok).toBe(false);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/missing wall|missing rib|merged feature/);
  });

  it('skips area check when shape unsupported', () => {
    const intent: IntentInput = { shapeId: 'gear', params: {} };
    const r = verifyAgainstSpec(intent, bboxFromSize(40, 40, 8), {
      detectedSurfaceAreaMm2: 5000,
    });
    expect(r.surfaceArea).toBeUndefined();
  });

  it('skips area check when detectedSurfaceAreaMm2 omitted', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    expect(r.surfaceArea).toBeUndefined();
  });
});

describe('Phase X6 — hole position matching', () => {
  const boxWithHoleAt = (x: number, y: number, dia = 10): IntentInput => ({
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
    features: [{ type: 'hole', params: { diameter: dia, x, y } } as never],
  });

  it('matches detected peak to intent hole within tolerance', () => {
    const r = verifyAgainstSpec(boxWithHoleAt(10, 10), bboxFromSize(50, 50, 50), {
      detectedHoles: [{ cx: 10.2, cy: 9.8, diameter: 10.1 }],
    });
    expect(r.holePositions?.allMatched).toBe(true);
    expect(r.holePositions?.matches[0].withinTolerance).toBe(true);
    expect(r.holePositions?.matches[0].distMm).toBeLessThan(1);
    expect(r.ok).toBe(true);
  });

  it('flags hole that AI placed at the wrong location', () => {
    const r = verifyAgainstSpec(boxWithHoleAt(10, 10), bboxFromSize(50, 50, 50), {
      detectedHoles: [{ cx: -10, cy: 10, diameter: 10 }],
    });
    expect(r.ok).toBe(false);
    expect(r.holePositions?.allMatched).toBe(false);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/hole position.*intent \(10\.0, 10\.0\).*closest detected at \(-10\.0/);
  });

  it('flags hole the AI never drilled', () => {
    const r = verifyAgainstSpec(boxWithHoleAt(10, 10), bboxFromSize(50, 50, 50), {
      detectedHoles: [], // empty
    });
    expect(r.holePositions?.allMatched).toBe(false);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/no matching cylindrical feature/);
  });

  it('flags extra hole AI drilled beyond intent', () => {
    const r = verifyAgainstSpec(boxWithHoleAt(10, 10), bboxFromSize(50, 50, 50), {
      detectedHoles: [
        { cx: 10, cy: 10, diameter: 10 },
        { cx: -10, cy: -10, diameter: 5 }, // unexpected
      ],
    });
    expect(r.holePositions?.allMatched).toBe(false);
    expect(r.holePositions?.extras.length).toBe(1);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/unexpected hole.*detected at \(-10\.0, -10\.0\)/);
  });

  it('matches multiple holes greedily (closest first)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: -10, y: -10 } } as never,
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
      ],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedHoles: [
        { cx: 10.5, cy: 10.5, diameter: 5 },
        { cx: -9.8, cy: -10.2, diameter: 5 },
      ],
    });
    expect(r.holePositions?.allMatched).toBe(true);
    expect(r.holePositions?.matches).toHaveLength(2);
    expect(r.holePositions?.extras).toHaveLength(0);
  });

  it('skips position check when intent has no hole features', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedHoles: [{ cx: 0, cy: 0, diameter: 5 }],
    });
    expect(r.holePositions).toBeUndefined();
  });

  it('skips position check when detectedHoles omitted', () => {
    const r = verifyAgainstSpec(boxWithHoleAt(10, 10), bboxFromSize(50, 50, 50));
    expect(r.holePositions).toBeUndefined();
  });

  it('honors custom tolerance via holePosTolMm', () => {
    // 3mm off → fails default 2mm, passes 5mm.
    const tight = verifyAgainstSpec(boxWithHoleAt(10, 10), bboxFromSize(50, 50, 50), {
      detectedHoles: [{ cx: 13, cy: 10, diameter: 10 }],
    });
    expect(tight.holePositions?.allMatched).toBe(false);

    const loose = verifyAgainstSpec(boxWithHoleAt(10, 10), bboxFromSize(50, 50, 50), {
      detectedHoles: [{ cx: 13, cy: 10, diameter: 10 }],
      holePosTolMm: 5,
    });
    expect(loose.holePositions?.allMatched).toBe(true);
  });
});

describe('Phase X7 — multi-axis hole position matching', () => {
  it('intent X-axis hole matches detected X-axis peak (in-plane = y,z)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      // For X-axis hole, in-plane coords are (y, z). Intent uses params.y/z.
      features: [{ type: 'hole', params: { diameter: 10, axis: 'x', y: 5, z: -3 } } as never],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedHoles: [{ axis: 'x', cx: 5, cy: -3, diameter: 10 }],
    });
    expect(r.holePositions?.allMatched).toBe(true);
    expect(r.holePositions?.matches[0].axis).toBe('x');
  });

  it('intent Z-axis hole does NOT match X-axis detected peak (different axis)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10, x: 10, y: 10 } } as never],
    };
    // Peak at the same (cx,cy) but along X axis — wrong axis, no match.
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedHoles: [{ axis: 'x', cx: 10, cy: 10, diameter: 10 }],
    });
    expect(r.holePositions?.allMatched).toBe(false);
    expect(r.holePositions?.matches[0].detected).toBeNull();
    expect(r.holePositions?.extras.length).toBe(1);
  });

  it('back-compat: detected peak without axis field is treated as Z', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10, x: 10, y: 10 } } as never],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedHoles: [{ cx: 10, cy: 10, diameter: 10 }], // no axis → defaults to 'z'
    });
    expect(r.holePositions?.allMatched).toBe(true);
  });

  it('intent Y-axis hole matches Y-axis detected peak (in-plane = x,z)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 8, axis: 'y', x: -10, z: 5 } } as never],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedHoles: [{ axis: 'y', cx: -10, cy: 5, diameter: 8 }],
    });
    expect(r.holePositions?.allMatched).toBe(true);
  });
});

describe('Phase X8 — fillet application check', () => {
  const filletIntent = (radius = 2): IntentInput => ({
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
    features: [{ type: 'fillet', params: { radius } } as never],
  });

  it('passes when sharpEdgeCount is at or below tolerance', () => {
    const r = verifyAgainstSpec(filletIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 0, maxDihedralDeg: 25 },
    });
    expect(r.fillet?.applied).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('flags un-filleted geometry (12 sharp edges from cube corners)', () => {
    const r = verifyAgainstSpec(filletIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 12, maxDihedralDeg: 90 },
    });
    expect(r.fillet?.applied).toBe(false);
    expect(r.ok).toBe(false);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/fillet.*intent declares 1 fillet feature.*still has 12 sharp edges/);
  });

  it('borderline 2 sharp edges (default tol) still counts as applied', () => {
    const r = verifyAgainstSpec(filletIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 2, maxDihedralDeg: 80 },
    });
    expect(r.fillet?.applied).toBe(true);
  });

  it('skips fillet check when intent has no fillet feature', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 12, maxDihedralDeg: 90 },
    });
    expect(r.fillet).toBeUndefined();
  });

  it('skips fillet check when detectedDihedralStats omitted', () => {
    const r = verifyAgainstSpec(filletIntent(), bboxFromSize(50, 50, 50));
    expect(r.fillet).toBeUndefined();
  });

  it('custom filletSharpEdgeTolerance', () => {
    const lenient = verifyAgainstSpec(filletIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 5, maxDihedralDeg: 80 },
      filletSharpEdgeTolerance: 8,
    });
    expect(lenient.fillet?.applied).toBe(true);

    const strict = verifyAgainstSpec(filletIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 5, maxDihedralDeg: 80 },
      filletSharpEdgeTolerance: 0,
    });
    expect(strict.fillet?.applied).toBe(false);
  });
});

describe('Phase X9 — thread spec self-check', () => {
  const threadIntent = (diameter: number, pitch?: number): IntentInput => ({
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
    features: [{
      type: 'thread',
      params: pitch !== undefined ? { diameter, pitch } : { diameter },
    } as never],
  });

  it('M8 with ISO coarse pitch 1.25 → pitchOk', () => {
    const r = verifyAgainstSpec(threadIntent(8, 1.25), bboxFromSize(50, 50, 50));
    expect(r.threads?.allOk).toBe(true);
    expect(r.threads?.perThread[0].isoStandard).toBe('M8');
    expect(r.threads?.perThread[0].expectedPitch).toBe(1.25);
  });

  it('M8 with wrong pitch 0.5 → flagged', () => {
    const r = verifyAgainstSpec(threadIntent(8, 0.5), bboxFromSize(50, 50, 50));
    expect(r.threads?.allOk).toBe(false);
    expect(r.ok).toBe(false);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/thread.*Ø8mm.*pitch 0\.5mm.*M8 is 1\.25mm/);
  });

  it('non-standard diameter (e.g. 7mm) → no expectation enforced', () => {
    const r = verifyAgainstSpec(threadIntent(7, 0.5), bboxFromSize(50, 50, 50));
    expect(r.threads?.perThread[0].isoStandard).toBeNull();
    expect(r.threads?.perThread[0].expectedPitch).toBeNull();
    expect(r.threads?.allOk).toBe(true);
  });

  it('default pitch derived from applyThread default (dia ≥ 6 → 1.0) doesn\'t match ISO for M8', () => {
    // applyThread default: pitch = dia >= 6 ? 1.0 : 0.5. For M8, ISO is
    // 1.25. So omitting pitch on M8 yields a mismatch — useful warning.
    const r = verifyAgainstSpec(threadIntent(8), bboxFromSize(50, 50, 50));
    expect(r.threads?.perThread[0].pitchOk).toBe(false);
    expect(r.threads?.perThread[0].requestedPitch).toBe(1.0);
  });

  it('M6 with default pitch 1.0 matches ISO coarse', () => {
    const r = verifyAgainstSpec(threadIntent(6), bboxFromSize(50, 50, 50));
    expect(r.threads?.perThread[0].pitchOk).toBe(true);
    expect(r.threads?.perThread[0].requestedPitch).toBe(1.0);
    expect(r.threads?.perThread[0].expectedPitch).toBe(1.0);
  });

  it('M16 with ISO pitch 2.0', () => {
    const r = verifyAgainstSpec(threadIntent(16, 2.0), bboxFromSize(50, 50, 50));
    expect(r.threads?.perThread[0].isoStandard).toBe('M16');
    expect(r.threads?.allOk).toBe(true);
  });

  it('skips thread check when intent has no thread feature', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    expect(r.threads).toBeUndefined();
  });

  it('multiple threads: one ok, one not → allOk=false', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'thread', params: { diameter: 8, pitch: 1.25 } } as never,
        { type: 'thread', params: { diameter: 10, pitch: 0.5 } } as never, // wrong: M10 is 1.5
      ],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    expect(r.threads?.allOk).toBe(false);
    expect(r.threads?.perThread).toHaveLength(2);
    expect(r.threads?.perThread[0].pitchOk).toBe(true);
    expect(r.threads?.perThread[1].pitchOk).toBe(false);
  });
});

describe('Phase X10 — intent self-consistency', () => {
  it('clean intent: no duplicates, no overlaps, no obliterates → ok', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: -15, y: 0 } } as never,
        { type: 'hole', params: { diameter: 5, x: 15, y: 0 } } as never,
      ],
    };
    const issues = detectIntentInconsistencies(intent);
    expect(issues.ok).toBe(true);
    expect(issues.duplicateHoles).toEqual([]);
    expect(issues.overlappingHoles).toEqual([]);
    expect(issues.obliteratingHoles).toEqual([]);
  });

  it('duplicate holes (same x,y,dia): grouped together', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
      ],
    };
    const issues = detectIntentInconsistencies(intent);
    expect(issues.ok).toBe(false);
    expect(issues.duplicateHoles).toHaveLength(1);
    expect(issues.duplicateHoles[0].indices).toEqual([0, 1, 2]);
  });

  it('overlapping holes (different positions but interpenetrate)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 10, x: 0, y: 0 } } as never,
        // Center 6mm away — combined radius is 10/2 + 10/2 = 10 → overlap.
        { type: 'hole', params: { diameter: 10, x: 6, y: 0 } } as never,
      ],
    };
    const issues = detectIntentInconsistencies(intent);
    expect(issues.ok).toBe(false);
    expect(issues.overlappingHoles).toHaveLength(1);
    expect(issues.overlappingHoles[0].distMm).toBeCloseTo(6, 1);
    expect(issues.overlappingHoles[0].combinedRadiusMm).toBeCloseTo(10, 1);
  });

  it('non-overlapping holes (distance > combined radius)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: 0, y: 0 } } as never,
        { type: 'hole', params: { diameter: 5, x: 20, y: 0 } } as never,
      ],
    };
    const issues = detectIntentInconsistencies(intent);
    expect(issues.overlappingHoles).toHaveLength(0);
  });

  it('obliterating hole: diameter ≥ parent width', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 20, height: 30, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 25, x: 0, y: 0 } } as never, // > width=20
      ],
    };
    const issues = detectIntentInconsistencies(intent);
    expect(issues.obliteratingHoles).toHaveLength(1);
    expect(issues.obliteratingHoles[0].parentLimitMm).toBe(20);
    expect(issues.ok).toBe(false);
  });

  it('different-axis holes are NOT grouped as duplicates', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never, // Z axis
        { type: 'hole', params: { diameter: 5, axis: 'x', y: 10, z: 10 } } as never,
      ],
    };
    const issues = detectIntentInconsistencies(intent);
    expect(issues.duplicateHoles).toEqual([]);
    expect(issues.overlappingHoles).toEqual([]);
  });

  it('different-diameter holes at the same position are NOT duplicates', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
        { type: 'hole', params: { diameter: 10, x: 10, y: 10 } } as never,
      ],
    };
    const issues = detectIntentInconsistencies(intent);
    expect(issues.duplicateHoles).toEqual([]);
    // They DO overlap (same position, sum-radius = 7.5 > 0)
    expect(issues.overlappingHoles.length).toBeGreaterThanOrEqual(0);
  });

  it('returns ok=true for an intent with no hole features', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const issues = detectIntentInconsistencies(intent);
    expect(issues.ok).toBe(true);
  });

  it('verifyAgainstSpec surfaces intentIssues + ok=false', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
        { type: 'hole', params: { diameter: 5, x: 10, y: 10 } } as never,
      ],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    expect(r.ok).toBe(false);
    expect(r.intentIssues?.duplicateHoles).toHaveLength(1);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/duplicate hole intent.*features\[0,1\]/);
  });

  it('verifyAgainstSpec critique includes overlap line', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 10, x: 0, y: 0 } } as never,
        { type: 'hole', params: { diameter: 10, x: 6, y: 0 } } as never,
      ],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50));
    const text = formatSpecCritique(r);
    expect(text).toMatch(/overlapping holes.*features\[0, 1\].*interpenetrate/);
  });

  it('verifyAgainstSpec critique includes obliterating line', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 20, height: 30, depth: 50 },
      features: [
        { type: 'hole', params: { diameter: 25, x: 0, y: 0 } } as never,
      ],
    };
    const r = verifyAgainstSpec(intent, bboxFromSize(20, 30, 50));
    const text = formatSpecCritique(r);
    expect(text).toMatch(/obliterating hole.*features\[0\].*25 mm.*parent.*20 mm/);
  });
});

describe('Phase X12 — chamfer application check', () => {
  const chamferIntent = (distance = 1.5): IntentInput => ({
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
    features: [{ type: 'chamfer', params: { distance } } as never],
  });

  it('passes when sharpEdgeCount ≤ tol AND chamferEdgeCount ≥ minChamferEdges', () => {
    const r = verifyAgainstSpec(chamferIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 0, maxDihedralDeg: 50, chamferEdgeCount: 20 },
    });
    expect(r.chamfer?.applied).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('flags un-chamfered (12 sharp 90° corners, 0 chamfer edges)', () => {
    const r = verifyAgainstSpec(chamferIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 12, maxDihedralDeg: 90, chamferEdgeCount: 0 },
    });
    expect(r.chamfer?.applied).toBe(false);
    expect(r.ok).toBe(false);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/chamfer.*intent declares 1 chamfer feature.*0 chamfer-range edges/);
  });

  it('flags borderline: sharp count ok but too few chamfer edges', () => {
    // Sharp ≤ 2 but only 2 chamfer edges → still fails (minChamferEdges default 4)
    const r = verifyAgainstSpec(chamferIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 1, maxDihedralDeg: 50, chamferEdgeCount: 2 },
    });
    expect(r.chamfer?.applied).toBe(false);
  });

  it('skips chamfer check when intent has no chamfer feature', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } };
    const r = verifyAgainstSpec(intent, bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 12, maxDihedralDeg: 90, chamferEdgeCount: 0 },
    });
    expect(r.chamfer).toBeUndefined();
  });

  it('skips chamfer check when detectedDihedralStats omitted', () => {
    const r = verifyAgainstSpec(chamferIntent(), bboxFromSize(50, 50, 50));
    expect(r.chamfer).toBeUndefined();
  });

  it('custom chamferMinEdges threshold', () => {
    // 3 chamfer edges — fails default 4, passes when lowered to 2
    const lenient = verifyAgainstSpec(chamferIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 0, maxDihedralDeg: 50, chamferEdgeCount: 3 },
      chamferMinEdges: 2,
    });
    expect(lenient.chamfer?.applied).toBe(true);

    const strict = verifyAgainstSpec(chamferIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 0, maxDihedralDeg: 50, chamferEdgeCount: 3 },
      chamferMinEdges: 10,
    });
    expect(strict.chamfer?.applied).toBe(false);
  });

  it('omitted chamferEdgeCount field defaults to 0', () => {
    const r = verifyAgainstSpec(chamferIntent(), bboxFromSize(50, 50, 50), {
      detectedDihedralStats: { sharpEdgeCount: 0, maxDihedralDeg: 50 },
    });
    expect(r.chamfer?.chamferEdgeCount).toBe(0);
    expect(r.chamfer?.applied).toBe(false);
  });
});
