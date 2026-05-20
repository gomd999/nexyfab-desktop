import { describe, it, expect } from 'vitest';
import {
  analyzeMountingBoss,
  analyzeSnapHook,
  analyzeVentGrille,
  analyzeRib,
} from './consumerFeatures';

describe('analyzeMountingBoss', () => {
  it('valid boss has positive volume + pull-out force', () => {
    const r = analyzeMountingBoss({
      outerDiameterMm: 8, pilotHoleDiameterMm: 3, heightMm: 10,
      wallThicknessMm: 2.5, draftAngleDeg: 1.5,
    });
    expect(r.volumeMm3).toBeGreaterThan(0);
    expect(r.pullOutForceN).toBeGreaterThan(0);
  });

  it('outer ≤ pilot triggers invalid warning', () => {
    const r = analyzeMountingBoss({
      outerDiameterMm: 3, pilotHoleDiameterMm: 4, heightMm: 10,
      wallThicknessMm: 0.5, draftAngleDeg: 1.5,
    });
    expect(r.warnings.some(w => w.includes('invalid'))).toBe(true);
  });

  it('thin wall triggers warning', () => {
    const r = analyzeMountingBoss({
      outerDiameterMm: 8, pilotHoleDiameterMm: 3, heightMm: 10,
      wallThicknessMm: 0.2, draftAngleDeg: 1.5,
    });
    expect(r.warnings.some(w => w.includes('Wall'))).toBe(true);
  });

  it('low draft triggers warning', () => {
    const r = analyzeMountingBoss({
      outerDiameterMm: 8, pilotHoleDiameterMm: 3, heightMm: 10,
      wallThicknessMm: 2.5, draftAngleDeg: 0.1,
    });
    expect(r.warnings.some(w => w.includes('Draft'))).toBe(true);
  });

  it('gussets add to volume', () => {
    const noGussets = analyzeMountingBoss({
      outerDiameterMm: 8, pilotHoleDiameterMm: 3, heightMm: 10,
      wallThicknessMm: 2.5, draftAngleDeg: 1.5,
    });
    const withGussets = analyzeMountingBoss({
      outerDiameterMm: 8, pilotHoleDiameterMm: 3, heightMm: 10,
      wallThicknessMm: 2.5, draftAngleDeg: 1.5,
      gussetCount: 4, gussetThicknessMm: 1.5,
    });
    expect(withGussets.volumeMm3).toBeGreaterThan(noGussets.volumeMm3);
  });
});

describe('analyzeSnapHook', () => {
  const baseSpec = {
    type: 'cantilever' as const,
    lengthMm: 20,
    widthMm: 5,
    thicknessBaseMm: 2,
    thicknessTipMm: 1.5,
    catchHeightMm: 1.0,
    modulusMpa: 2500,
    permissibleStrainPercent: 4,
    friction: 0.3,
    insertionAngleDeg: 30,
    removalAngleDeg: 70,
  };

  it('emits insertion + removal force', () => {
    const r = analyzeSnapHook(baseSpec);
    expect(r.insertionForceN).toBeGreaterThan(0);
    expect(r.removalForceN).toBeGreaterThan(0);
  });

  it('large catch height → higher strain', () => {
    const small = analyzeSnapHook({ ...baseSpec, catchHeightMm: 0.5 });
    const big = analyzeSnapHook({ ...baseSpec, catchHeightMm: 2 });
    expect(big.maxStrainPercent).toBeGreaterThan(small.maxStrainPercent);
  });

  it('warns when strain exceeds permissible', () => {
    // catchHeightMm 15 → strain ~6.5%, exceeds 4% permissible.
    const r = analyzeSnapHook({ ...baseSpec, catchHeightMm: 15 });
    expect(r.warnings.some(w => w.includes('Strain'))).toBe(true);
  });

  it('self-locking removal (high angle + friction) → infinite removal', () => {
    const r = analyzeSnapHook({ ...baseSpec, removalAngleDeg: 85, friction: 0.3 });
    // tan(85)*0.3 ≈ 3.4 → self-locking.
    expect(r.removalForceN).toBe(Infinity);
    expect(r.warnings.some(w => w.includes('self-locking'))).toBe(true);
  });

  it('strain safety factor matches permissible / strain', () => {
    const r = analyzeSnapHook(baseSpec);
    expect(r.strainSafetyFactor).toBeCloseTo(
      baseSpec.permissibleStrainPercent / r.maxStrainPercent, 4,
    );
  });
});

describe('analyzeVentGrille', () => {
  it('louver pattern opens area = louvers × width × gap', () => {
    const r = analyzeVentGrille({
      pattern: 'louver',
      widthMm: 100, heightMm: 100,
      openingMm: 5, spacingMm: 10,
      thicknessMm: 2, edgeMarginMm: 5,
    });
    expect(r.openingCount).toBeGreaterThan(0);
    expect(r.openAreaMm2).toBeGreaterThan(0);
  });

  it('hex mesh emits more openings than circular at same spacing', () => {
    const circ = analyzeVentGrille({
      pattern: 'circular-holes', widthMm: 100, heightMm: 100,
      openingMm: 5, spacingMm: 10, thicknessMm: 2, edgeMarginMm: 5,
    });
    const hex = analyzeVentGrille({
      pattern: 'hex-mesh', widthMm: 100, heightMm: 100,
      openingMm: 5, spacingMm: 10, thicknessMm: 2, edgeMarginMm: 5,
    });
    expect(hex.openingCount).toBeGreaterThanOrEqual(circ.openingCount);
  });

  it('CFM airflow scales with open area', () => {
    const small = analyzeVentGrille({
      pattern: 'circular-holes', widthMm: 50, heightMm: 50,
      openingMm: 3, spacingMm: 8, thicknessMm: 2, edgeMarginMm: 5,
    });
    const big = analyzeVentGrille({
      pattern: 'circular-holes', widthMm: 200, heightMm: 200,
      openingMm: 5, spacingMm: 10, thicknessMm: 2, edgeMarginMm: 5,
    });
    expect(big.airflowCfmAt25Pa).toBeGreaterThan(small.airflowCfmAt25Pa);
  });

  it('warns on low open ratio', () => {
    const r = analyzeVentGrille({
      pattern: 'circular-holes', widthMm: 100, heightMm: 100,
      openingMm: 1, spacingMm: 30, thicknessMm: 2, edgeMarginMm: 5,
    });
    expect(r.warnings.some(w => w.includes('Open ratio'))).toBe(true);
  });

  it('warns when opening < thickness (mold flash risk)', () => {
    const r = analyzeVentGrille({
      pattern: 'circular-holes', widthMm: 100, heightMm: 100,
      openingMm: 1, spacingMm: 5, thicknessMm: 2, edgeMarginMm: 5,
    });
    expect(r.warnings.some(w => w.includes('thickness'))).toBe(true);
  });
});

describe('analyzeRib', () => {
  it('stiffness multiplier > 1 for non-zero rib', () => {
    const r = analyzeRib({
      lengthMm: 50, heightMm: 5, baseThicknessMm: 1,
      wallThicknessMm: 2, draftAngleDeg: 1, baseFilletMm: 0.5,
    });
    expect(r.stiffnessMultiplier).toBeGreaterThan(1);
  });

  it('thicker rib triggers sink warning', () => {
    const r = analyzeRib({
      lengthMm: 50, heightMm: 5, baseThicknessMm: 3,
      wallThicknessMm: 2, draftAngleDeg: 1, baseFilletMm: 0.5,
    });
    expect(r.warnings.some(w => w.includes('sink'))).toBe(true);
  });

  it('tall rib triggers bowing warning', () => {
    const r = analyzeRib({
      lengthMm: 50, heightMm: 20, baseThicknessMm: 1,
      wallThicknessMm: 2, draftAngleDeg: 1, baseFilletMm: 0.5,
    });
    expect(r.warnings.some(w => w.includes('bowing'))).toBe(true);
  });

  it('small base fillet triggers stress concentration warning', () => {
    const r = analyzeRib({
      lengthMm: 50, heightMm: 5, baseThicknessMm: 2,
      wallThicknessMm: 3, draftAngleDeg: 1, baseFilletMm: 0.1,
    });
    expect(r.warnings.some(w => w.includes('stress'))).toBe(true);
  });
});
