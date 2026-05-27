import { describe, it, expect } from 'vitest';
import {
  computePreload,
  computeMultiple,
  validateBoltPreload,
  summarize,
  PROOF_STRESS_MPA,
  type BoltPreloadInput,
  type InterferencePreloadInput,
  type GasketPreloadInput,
  type ThermalShrinkInput,
} from './contactPreloadSetter';

describe('PROOF_STRESS_MPA', () => {
  it('8.8 = 580', () => {
    expect(PROOF_STRESS_MPA['8.8']).toBe(580);
  });

  it('12.9 > 10.9', () => {
    expect(PROOF_STRESS_MPA['12.9']).toBeGreaterThan(PROOF_STRESS_MPA['10.9']);
  });
});

describe('computePreload', () => {
  it('M6 8.8 bolt → positive preload', () => {
    const input: BoltPreloadInput = { kind: 'bolt', threadDiameterMm: 6, propertyClass: '8.8' };
    const r = computePreload(input);
    expect(r.preloadN).toBeGreaterThan(0);
    expect(r.preTensionId).toContain('BOLT-PRE');
  });

  it('higher property class → larger preload', () => {
    const low = computePreload({ kind: 'bolt', threadDiameterMm: 6, propertyClass: '4.6' });
    const high = computePreload({ kind: 'bolt', threadDiameterMm: 6, propertyClass: '12.9' });
    expect(high.preloadN).toBeGreaterThan(low.preloadN);
  });

  it('unknown class warns', () => {
    const r = computePreload({ kind: 'bolt', threadDiameterMm: 6, propertyClass: '99.9' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('interference fit returns pressure', () => {
    const input: InterferencePreloadInput = {
      kind: 'interference',
      interferenceMm: 0.05,
      shaftRadiusMm: 10,
      effectiveYoungMpa: 200000,
    };
    const r = computePreload(input);
    expect(r.pressureMpa).toBeGreaterThan(0);
    expect(r.preloadN).toBeGreaterThan(0);
  });

  it('gasket compression > 50% → warning', () => {
    const input: GasketPreloadInput = { kind: 'gasket', compressionFraction: 0.6, springConstantNMm: 500 };
    const r = computePreload(input);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('thermal shrink computes force from interference', () => {
    const input: ThermalShrinkInput = { kind: 'thermal-shrink', interferenceMm: 0.05, deltaTC: 100, cteOnC: 1.2e-5 };
    const r = computePreload(input);
    expect(r.preloadN).toBeGreaterThan(0);
  });

  it('larger thread → larger preload', () => {
    const small = computePreload({ kind: 'bolt', threadDiameterMm: 4, propertyClass: '8.8' });
    const big = computePreload({ kind: 'bolt', threadDiameterMm: 12, propertyClass: '8.8' });
    expect(big.preloadN).toBeGreaterThan(small.preloadN);
  });

  it('default proofFraction = 0.7', () => {
    const r = computePreload({ kind: 'bolt', threadDiameterMm: 6, propertyClass: '8.8' });
    const custom = computePreload({ kind: 'bolt', threadDiameterMm: 6, propertyClass: '8.8', proofFraction: 0.7 });
    expect(r.preloadN).toBeCloseTo(custom.preloadN, 1);
  });
});

describe('computeMultiple', () => {
  it('processes mixed inputs', () => {
    const r = computeMultiple([
      { kind: 'bolt', threadDiameterMm: 6, propertyClass: '8.8' },
      { kind: 'gasket', compressionFraction: 0.25, springConstantNMm: 500 },
    ]);
    expect(r).toHaveLength(2);
  });
});

describe('validateBoltPreload', () => {
  it('preload within proof load → ok', () => {
    const r = validateBoltPreload({ kind: 'bolt', threadDiameterMm: 6, propertyClass: '8.8', proofFraction: 0.7 });
    expect(r.withinLimit).toBe(true);
  });

  it('over-fraction exceeds proof', () => {
    const r = validateBoltPreload({ kind: 'bolt', threadDiameterMm: 6, propertyClass: '8.8', proofFraction: 1.2 });
    expect(r.withinLimit).toBe(false);
  });
});

describe('summarize', () => {
  it('reports preload + kind', () => {
    const r = computePreload({ kind: 'bolt', threadDiameterMm: 6, propertyClass: '8.8' });
    const s = summarize(r);
    expect(s.kind).toBe('bolt');
    expect(s.preloadN).toBe(r.preloadN);
  });
});
