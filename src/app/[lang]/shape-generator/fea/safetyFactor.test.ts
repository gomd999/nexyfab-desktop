import { describe, it, expect } from 'vitest';
import {
  safetyFactor,
  classifySf,
  yieldStrengthOf,
  analyseField,
  bandColour,
  DEFAULT_BANDS,
} from './safetyFactor';
import type { StressField } from './stressField';

function field(stresses: number[]): StressField {
  return {
    vertexCount: stresses.length,
    vonMises: new Float32Array(stresses),
    displacement: new Float32Array(stresses.length * 3),
  };
}

describe('safetyFactor', () => {
  it('= yield / stress for ordinary inputs', () => {
    expect(safetyFactor(50, 200)).toBe(4);
    expect(safetyFactor(100, 250)).toBe(2.5);
  });

  it('returns Infinity when stress = 0', () => {
    expect(safetyFactor(0, 100)).toBe(Infinity);
  });

  it('returns NaN on negative or NaN inputs', () => {
    expect(Number.isNaN(safetyFactor(-10, 100))).toBe(true);
    expect(Number.isNaN(safetyFactor(NaN, 100))).toBe(true);
    expect(Number.isNaN(safetyFactor(50, 0))).toBe(true);
  });
});

describe('classifySf · band thresholds (default)', () => {
  it('SF < 1 → fail', () => {
    expect(classifySf(0.5)).toBe('fail');
    expect(classifySf(0.99)).toBe('fail');
  });

  it('1.0 ≤ SF < 1.5 → marginal', () => {
    expect(classifySf(1.0)).toBe('marginal');
    expect(classifySf(1.49)).toBe('marginal');
  });

  it('1.5 ≤ SF < 2 → acceptable', () => {
    expect(classifySf(1.5)).toBe('acceptable');
    expect(classifySf(1.99)).toBe('acceptable');
  });

  it('SF ≥ 2 → safe', () => {
    expect(classifySf(2.0)).toBe('safe');
    expect(classifySf(10)).toBe('safe');
    expect(classifySf(Infinity)).toBe('safe');
  });

  it('respects custom bands', () => {
    expect(classifySf(1.2, { failBelow: 1.3, marginalBelow: 1.5, acceptableBelow: 2 })).toBe('fail');
  });
});

describe('yieldStrengthOf', () => {
  it('returns the yield strength for known materials', () => {
    expect(yieldStrengthOf('aluminum')).toBe(276);
    expect(yieldStrengthOf('steel')).toBe(250);
  });

  it('returns null for unknown ids', () => {
    expect(yieldStrengthOf('unobtanium')).toBeNull();
  });
});

describe('analyseField', () => {
  it('returns null when material is unknown', () => {
    expect(analyseField(field([100]), 'unobtanium')).toBeNull();
  });

  it('reports pass when all SF ≥ 1', () => {
    const r = analyseField(field([10, 20, 30]), 'aluminum');
    expect(r?.decision).toBe('pass');
    expect(r?.bandCounts.fail).toBe(0);
  });

  it('reports fail when any SF < 1', () => {
    // Aluminum yield = 276 MPa. Stress 500 MPa → SF ≈ 0.55 → fail.
    const r = analyseField(field([10, 500]), 'aluminum');
    expect(r?.decision).toBe('fail');
    expect(r?.bandCounts.fail).toBeGreaterThan(0);
  });

  it('locates the min SF vertex', () => {
    const r = analyseField(field([10, 500, 20]), 'aluminum');
    expect(r?.minSfVertex).toBe(1);
  });

  it('mean SF reflects field-wide load distribution', () => {
    const r = analyseField(field([50, 100]), 'steel'); // yield 250
    // SFs: 5 and 2.5 → mean 3.75
    expect(r?.meanSf).toBeCloseTo(3.75, 1);
  });

  it('counts Infinity (zero-stress vertex) as safe', () => {
    const r = analyseField(field([0, 100]), 'aluminum');
    expect(r?.bandCounts.safe).toBeGreaterThan(0);
  });

  it('respects custom bands (tighter thresholds → more conservative)', () => {
    // SF = 276/50 = 5.52. Default bands say "safe"; with custom
    // thresholds that demand SF ≥ 30, the same SF falls into "fail".
    const r = analyseField(field([50]), 'aluminum', {
      failBelow: 10, marginalBelow: 20, acceptableBelow: 30,
    });
    expect(r?.bandCounts.fail).toBe(1);
    expect(r?.decision).toBe('fail');
  });
});

describe('bandColour', () => {
  it('maps each band to a hex colour', () => {
    expect(bandColour('fail')).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(bandColour('safe')).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('fail and safe colours differ (red vs green)', () => {
    expect(bandColour('fail')).not.toBe(bandColour('safe'));
  });
});

describe('DEFAULT_BANDS', () => {
  it('matches industry convention (1.0 / 1.5 / 2.0)', () => {
    expect(DEFAULT_BANDS).toEqual({ failBelow: 1.0, marginalBelow: 1.5, acceptableBelow: 2.0 });
  });
});
