import { describe, it, expect } from 'vitest';
import {
  computeBonus,
  effectiveTolerance,
  virtualCondition,
  evaluatePosition,
  evaluatePattern,
  checkMatingClearance,
  type FeatureSize,
  type PositionToleranceCallout,
  type HoleInstance,
} from './positionTolerance';

const hole10: FeatureSize = {
  mmcDiameterMm: 10.00, lmcDiameterMm: 10.20, type: 'internal',
};
const pin10: FeatureSize = {
  mmcDiameterMm: 10.00, lmcDiameterMm: 9.80, type: 'external',
};

describe('computeBonus', () => {
  it('hole produced at MMC → 0 bonus', () => {
    expect(computeBonus({ ...hole10, actualDiameterMm: 10.00 }, 'MMC')).toBe(0);
  });

  it('hole produced 0.10 above MMC → 0.10 bonus', () => {
    expect(computeBonus({ ...hole10, actualDiameterMm: 10.10 }, 'MMC')).toBeCloseTo(0.10, 5);
  });

  it('pin produced 0.05 below MMC → 0.05 bonus', () => {
    expect(computeBonus({ ...pin10, actualDiameterMm: 9.95 }, 'MMC')).toBeCloseTo(0.05, 5);
  });

  it('RFS modifier never gives bonus', () => {
    expect(computeBonus({ ...hole10, actualDiameterMm: 10.15 }, 'RFS')).toBe(0);
  });

  it('LMC bonus uses departure from LMC', () => {
    expect(computeBonus({ ...hole10, actualDiameterMm: 10.10 }, 'LMC')).toBeCloseTo(0.10, 5);
  });

  it('missing actual → 0 bonus', () => {
    expect(computeBonus(hole10, 'MMC')).toBe(0);
  });
});

describe('effectiveTolerance', () => {
  const callout: PositionToleranceCallout = { toleranceMm: 0.2, featureModifier: 'MMC' };

  it('sums stated + bonus', () => {
    const r = effectiveTolerance(callout, { ...hole10, actualDiameterMm: 10.15 });
    expect(r.statedToleranceMm).toBe(0.2);
    expect(r.bonusToleranceMm).toBeCloseTo(0.15, 5);
    expect(r.effectiveToleranceMm).toBeCloseTo(0.35, 5);
  });

  it('includes datum shift from MMC datum', () => {
    const datumFeatures = new Map<string, FeatureSize>([
      ['A', { ...hole10, actualDiameterMm: 10.10 }],
    ]);
    const r = effectiveTolerance(callout, { ...hole10, actualDiameterMm: 10.00 }, [{ datum: 'A', modifier: 'MMC' }], datumFeatures);
    expect(r.datumShiftMm).toBeCloseTo(0.10, 5);
    expect(r.effectiveToleranceMm).toBeCloseTo(0.30, 5);
  });
});

describe('virtualCondition', () => {
  it('external feature MMC: VC = MMC + tol', () => {
    expect(virtualCondition(pin10, 0.2, 'MMC')).toBeCloseTo(10.20, 5);
  });

  it('internal feature MMC: VC = MMC - tol', () => {
    expect(virtualCondition(hole10, 0.2, 'MMC')).toBeCloseTo(9.80, 5);
  });

  it('external feature LMC: VC = LMC - tol', () => {
    expect(virtualCondition(pin10, 0.2, 'LMC')).toBeCloseTo(9.60, 5);
  });

  it('internal feature LMC: VC = LMC + tol', () => {
    expect(virtualCondition(hole10, 0.2, 'LMC')).toBeCloseTo(10.40, 5);
  });
});

describe('evaluatePosition', () => {
  const callout: PositionToleranceCallout = { toleranceMm: 0.2, featureModifier: 'MMC' };

  it('hole at nominal → withinTolerance', () => {
    const r = evaluatePosition(
      { centerInDrfMm: [0, 0, 0], nominalInDrfMm: [0, 0, 0], actualDiameterMm: 10.00 },
      hole10, callout,
    );
    expect(r.withinTolerance).toBe(true);
    expect(r.actualDeviationDiameterMm).toBe(0);
  });

  it('hole at nominal but oversize → bonus saves it', () => {
    // Position deviation diameter 0.25 (would fail tol 0.2)...
    // ... but at actual 10.10, bonus 0.10 → eff tol 0.30 → passes.
    const r = evaluatePosition(
      { centerInDrfMm: [0.125, 0, 0], nominalInDrfMm: [0, 0, 0], actualDiameterMm: 10.10 },
      hole10, callout,
    );
    expect(r.actualDeviationDiameterMm).toBeCloseTo(0.25, 5);
    expect(r.withinTolerance).toBe(true);
  });

  it('marginMm positive on pass, negative on fail', () => {
    const pass = evaluatePosition(
      { centerInDrfMm: [0.05, 0, 0], nominalInDrfMm: [0, 0, 0], actualDiameterMm: 10.00 },
      hole10, callout,
    );
    const fail = evaluatePosition(
      { centerInDrfMm: [1, 0, 0], nominalInDrfMm: [0, 0, 0], actualDiameterMm: 10.00 },
      hole10, callout,
    );
    expect(pass.marginMm).toBeGreaterThan(0);
    expect(fail.marginMm).toBeLessThan(0);
  });
});

describe('evaluatePattern', () => {
  const callout: PositionToleranceCallout = { toleranceMm: 0.2, featureModifier: 'MMC' };

  const holes: HoleInstance[] = [
    {
      id: 'h1', feature: hole10,
      actual: { centerInDrfMm: [0, 0, 0], nominalInDrfMm: [0, 0, 0], actualDiameterMm: 10.00 },
    },
    {
      id: 'h2', feature: hole10,
      actual: { centerInDrfMm: [0.05, 0, 0], nominalInDrfMm: [0, 0, 0], actualDiameterMm: 10.00 },
    },
  ];

  it('pattern passes when all holes pass', () => {
    const r = evaluatePattern(holes, callout);
    expect(r.patternPasses).toBe(true);
  });

  it('reports worst + best hole', () => {
    const r = evaluatePattern(holes, callout);
    expect(r.worstHoleId).toBe('h2'); // smaller margin
    expect(r.bestHoleId).toBe('h1');
  });

  it('failing hole flips patternPasses to false', () => {
    const badHoles: HoleInstance[] = [
      ...holes,
      {
        id: 'h3', feature: hole10,
        actual: { centerInDrfMm: [5, 0, 0], nominalInDrfMm: [0, 0, 0], actualDiameterMm: 10.00 },
      },
    ];
    expect(evaluatePattern(badHoles, callout).patternPasses).toBe(false);
  });
});

describe('checkMatingClearance', () => {
  it('pin VC < hole VC → mates', () => {
    // Pin 10.0/9.8 MMC + 0.2 tol → VC = 10.2
    // Hole 10.4/10.6 MMC + 0.2 tol → VC = 10.2... mates at exactly 0 clearance.
    const r = checkMatingClearance(
      pin10, 0.2, 'MMC',
      { mmcDiameterMm: 10.4, lmcDiameterMm: 10.6, type: 'internal' }, 0.2, 'MMC',
    );
    expect(r.clearanceMm).toBeCloseTo(0, 5);
    expect(r.mates).toBe(true);
  });

  it('hole too small → no mate', () => {
    const r = checkMatingClearance(
      pin10, 0.2, 'MMC',
      { mmcDiameterMm: 9.5, lmcDiameterMm: 9.7, type: 'internal' }, 0.2, 'MMC',
    );
    expect(r.mates).toBe(false);
  });
});
