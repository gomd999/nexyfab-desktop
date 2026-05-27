import { describe, it, expect } from 'vitest';
import {
  analyzeSnapFit,
  suggestGeometry,
  retentionRatio,
  summarize,
  MATERIAL_PRESETS,
  type SnapFitGeometry,
} from './snapFitRetention';

function geo(partial: Partial<SnapFitGeometry> = {}): SnapFitGeometry {
  return {
    lengthMm: 20,
    thicknessMm: 2,
    widthMm: 5,
    undercutMm: 0.5,
    engagementRampDeg: 30,
    retentionRampDeg: 90,
    tapered: false,
    ...partial,
  };
}

describe('MATERIAL_PRESETS', () => {
  it('has ABS preset', () => {
    expect(MATERIAL_PRESETS.abs!.youngMpa).toBe(2200);
  });

  it('PP has higher allowable strain than ABS', () => {
    expect(MATERIAL_PRESETS.pp!.allowableStrain).toBeGreaterThan(MATERIAL_PRESETS.abs!.allowableStrain);
  });
});

describe('analyzeSnapFit', () => {
  it('zero geometry → warning', () => {
    const r = analyzeSnapFit(geo({ lengthMm: 0 }), MATERIAL_PRESETS.abs!);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('healthy beam → strain ok', () => {
    const r = analyzeSnapFit(geo(), MATERIAL_PRESETS.abs!);
    expect(r.strainOk).toBe(true);
  });

  it('large undercut → strain not ok', () => {
    const r = analyzeSnapFit(geo({ undercutMm: 10 }), MATERIAL_PRESETS.abs!);
    expect(r.strainOk).toBe(false);
  });

  it('tapered beam adjusts stress', () => {
    const flat = analyzeSnapFit(geo({ tapered: false }), MATERIAL_PRESETS.abs!);
    const tapered = analyzeSnapFit(geo({ tapered: true }), MATERIAL_PRESETS.abs!);
    expect(tapered.peakStressMpa).toBeGreaterThan(flat.peakStressMpa);
  });

  it('retention ramp 90 produces 90° permanent warning', () => {
    const r = analyzeSnapFit(geo({ retentionRampDeg: 90.5 }), MATERIAL_PRESETS.abs!);
    expect(r.warnings.some(w => w.includes('locking'))).toBe(true);
  });

  it('short beam triggers L/t warning', () => {
    const r = analyzeSnapFit(geo({ lengthMm: 5 }), MATERIAL_PRESETS.abs!);
    expect(r.warnings.some(w => w.includes('L/t'))).toBe(true);
  });

  it('safety factor > 1 for safe beam', () => {
    const r = analyzeSnapFit(geo(), MATERIAL_PRESETS.abs!);
    expect(r.strainSafetyFactor).toBeGreaterThan(1);
  });

  it('engagement force positive', () => {
    const r = analyzeSnapFit(geo(), MATERIAL_PRESETS.abs!);
    expect(r.engagementForceN).toBeGreaterThan(0);
  });

  it('retention force higher than engagement when steeper retention', () => {
    const r = analyzeSnapFit(geo({ engagementRampDeg: 20, retentionRampDeg: 70 }), MATERIAL_PRESETS.abs!);
    expect(r.retentionForceN).toBeGreaterThan(r.engagementForceN);
  });
});

describe('suggestGeometry', () => {
  it('safe beam → no suggestion', () => {
    const r = analyzeSnapFit(geo(), MATERIAL_PRESETS.abs!);
    expect(suggestGeometry(r, geo(), MATERIAL_PRESETS.abs!)).toBeNull();
  });

  it('unsafe beam → length increase suggested', () => {
    const failing = geo({ undercutMm: 10 });
    const r = analyzeSnapFit(failing, MATERIAL_PRESETS.abs!);
    const sug = suggestGeometry(r, failing, MATERIAL_PRESETS.abs!);
    expect(sug).not.toBeNull();
    expect(sug!.newLengthMm).toBeGreaterThan(failing.lengthMm);
  });
});

describe('retentionRatio', () => {
  it('high retention ramp → high ratio', () => {
    const r = analyzeSnapFit(geo({ engagementRampDeg: 20, retentionRampDeg: 88 }), MATERIAL_PRESETS.abs!);
    const ratio = retentionRatio(r);
    expect(ratio.ratio).toBeGreaterThan(1);
  });

  it('flagged permanent when ratio > 10', () => {
    const r = analyzeSnapFit(geo({ engagementRampDeg: 10, retentionRampDeg: 89.9 }), MATERIAL_PRESETS.abs!);
    const ratio = retentionRatio(r);
    if (ratio.ratio > 10) expect(ratio.permanent).toBe(true);
  });
});

describe('summarize', () => {
  it('reports strain status', () => {
    const r = analyzeSnapFit(geo(), MATERIAL_PRESETS.abs!);
    const s = summarize(r);
    expect(s.strainOk).toBe(true);
    expect(s.peakStressMpa).toBeGreaterThan(0);
  });

  it('warning count tracked', () => {
    const r = analyzeSnapFit(geo({ retentionRampDeg: 91 }), MATERIAL_PRESETS.abs!);
    expect(summarize(r).warningCount).toBeGreaterThan(0);
  });
});
