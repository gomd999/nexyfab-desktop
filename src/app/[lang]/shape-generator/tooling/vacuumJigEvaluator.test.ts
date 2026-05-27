import { describe, it, expect } from 'vitest';
import {
  evaluateVacuumJig,
  buildFullSurfaceZone,
  buildGridZones,
  approximatePlateDeflection,
  summarize,
  type VacuumZone,
  type PartLoad,
} from './vacuumJigEvaluator';

function basicLoad(overrides: Partial<PartLoad> = {}): PartLoad {
  return { cuttingForceN: 50, friction: 0.3, massKg: 1, ...overrides };
}

describe('evaluateVacuumJig', () => {
  it('empty zones → zero holding force', () => {
    const r = evaluateVacuumJig([], basicLoad());
    expect(r.holdingForceN).toBe(0);
  });

  it('single zone holding force = ΔP × A × η × 0.001', () => {
    const z = buildFullSurfaceZone('z1', 10000, 70, 0.9);
    const r = evaluateVacuumJig([z], basicLoad());
    expect(r.holdingForceN).toBeCloseTo(70 * 10000 * 0.9 * 0.001, 3);
  });

  it('per-zone breakdown sums to total', () => {
    const zones = [
      buildFullSurfaceZone('z1', 5000),
      buildFullSurfaceZone('z2', 5000),
    ];
    const r = evaluateVacuumJig(zones, basicLoad());
    const sum = r.perZoneForceN.reduce((s, z) => s + z.forceN, 0);
    expect(sum).toBeCloseTo(r.holdingForceN, 3);
  });

  it('willSlip true when cutting force exceeds slip threshold', () => {
    const z = buildFullSurfaceZone('z', 100, 30); // small jig
    const r = evaluateVacuumJig([z], basicLoad({ cuttingForceN: 1000 }));
    expect(r.willSlip).toBe(true);
  });

  it('safetyFactor = holdingForce / cuttingForce', () => {
    const z = buildFullSurfaceZone('z', 10000);
    const r = evaluateVacuumJig([z], basicLoad({ cuttingForceN: 100 }));
    expect(r.safetyFactor).toBeCloseTo(r.holdingForceN / 100, 3);
  });

  it('safetyFactor < 2 → warning', () => {
    const z = buildFullSurfaceZone('z', 100); // very small jig → hold ≈ 6.65 N
    const r = evaluateVacuumJig([z], basicLoad({ cuttingForceN: 4 })); // SF ≈ 1.66
    expect(r.warnings.some(w => w.includes('Safety factor'))).toBe(true);
  });

  it('infinite safety factor with zero cutting force', () => {
    const z = buildFullSurfaceZone('z', 10000);
    const r = evaluateVacuumJig([z], basicLoad({ cuttingForceN: 0 }));
    expect(r.safetyFactor).toBe(Infinity);
  });

  it('vacuum > atmospheric → warning', () => {
    const z: VacuumZone = { id: 'z', areaMm2: 1000, vacuumKpa: 200, efficiency: 1 };
    const r = evaluateVacuumJig([z], basicLoad());
    expect(r.warnings.some(w => w.includes('atmospheric'))).toBe(true);
  });
});

describe('buildFullSurfaceZone', () => {
  it('produces a single zone with given area', () => {
    const z = buildFullSurfaceZone('big', 25000);
    expect(z.areaMm2).toBe(25000);
  });

  it('default vacuum is 70 kPa', () => {
    const z = buildFullSurfaceZone('z', 1000);
    expect(z.vacuumKpa).toBe(70);
  });
});

describe('buildGridZones', () => {
  it('produces rows × cols zones', () => {
    expect(buildGridZones(3, 4, 100)).toHaveLength(12);
  });

  it('each cell has the same area', () => {
    const zones = buildGridZones(2, 2, 500);
    for (const z of zones) {
      expect(z.areaMm2).toBe(500);
    }
  });

  it('zero rows/cols → empty', () => {
    expect(buildGridZones(0, 5, 100)).toEqual([]);
  });
});

describe('approximatePlateDeflection', () => {
  it('zero pressure → zero deflection', () => {
    expect(approximatePlateDeflection({ thicknessMm: 1, deltaKpa: 0, spanMm: 100, youngGpa: 200 })).toBe(0);
  });

  it('thicker plate deflects less', () => {
    const thin = approximatePlateDeflection({ thicknessMm: 1, deltaKpa: 70, spanMm: 100, youngGpa: 200 });
    const thick = approximatePlateDeflection({ thicknessMm: 5, deltaKpa: 70, spanMm: 100, youngGpa: 200 });
    expect(thick).toBeLessThan(thin);
  });

  it('larger span → more deflection', () => {
    const small = approximatePlateDeflection({ thicknessMm: 1, deltaKpa: 70, spanMm: 50, youngGpa: 200 });
    const big = approximatePlateDeflection({ thicknessMm: 1, deltaKpa: 70, spanMm: 100, youngGpa: 200 });
    expect(big).toBeGreaterThan(small);
  });
});

describe('summarize', () => {
  it('reports holding force and average', () => {
    const zones = [buildFullSurfaceZone('a', 5000), buildFullSurfaceZone('b', 5000)];
    const r = evaluateVacuumJig(zones, basicLoad());
    const s = summarize(r, zones.length);
    expect(s.totalHoldingForceN).toBeCloseTo(r.holdingForceN, 5);
    expect(s.averageZoneForceN).toBeCloseTo(r.holdingForceN / 2, 5);
  });

  it('isAdequate false when slipping or low SF', () => {
    const z = buildFullSurfaceZone('z', 50);
    const r = evaluateVacuumJig([z], basicLoad({ cuttingForceN: 10000 }));
    const s = summarize(r, 1);
    expect(s.isAdequate).toBe(false);
  });

  it('isAdequate true for well-sized jig', () => {
    const z = buildFullSurfaceZone('z', 50000);
    const r = evaluateVacuumJig([z], basicLoad({ cuttingForceN: 50 }));
    const s = summarize(r, 1);
    expect(s.isAdequate).toBe(true);
  });
});
