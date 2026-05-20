import { describe, it, expect } from 'vitest';
import {
  computeBuoyancy,
  computeMetacentricHeight,
  tiltAnalysis,
  summarize,
  WATER,
  type Tetrahedron,
} from './centerOfBuoyancy';

const unitCube: Tetrahedron[] = [
  // 5 tetrahedra filling a unit cube of side 10 mm.
  { v0: { x: 0, y: 0, z: 0 }, v1: { x: 10, y: 0, z: 0 }, v2: { x: 0, y: 10, z: 0 }, v3: { x: 0, y: 0, z: 10 } },
  { v0: { x: 10, y: 0, z: 0 }, v1: { x: 10, y: 10, z: 0 }, v2: { x: 0, y: 10, z: 0 }, v3: { x: 10, y: 10, z: 10 } },
  { v0: { x: 10, y: 0, z: 0 }, v1: { x: 0, y: 10, z: 0 }, v2: { x: 10, y: 10, z: 10 }, v3: { x: 0, y: 0, z: 10 } },
  { v0: { x: 10, y: 0, z: 0 }, v1: { x: 10, y: 10, z: 10 }, v2: { x: 10, y: 0, z: 10 }, v3: { x: 0, y: 0, z: 10 } },
  { v0: { x: 0, y: 10, z: 0 }, v1: { x: 10, y: 10, z: 10 }, v2: { x: 0, y: 10, z: 10 }, v3: { x: 0, y: 0, z: 10 } },
];

describe('computeBuoyancy', () => {
  it('empty → zero', () => {
    const r = computeBuoyancy([]);
    expect(r.displacedVolumeMm3).toBe(0);
  });

  it('unit cube volume ≈ 1000 mm³', () => {
    const r = computeBuoyancy(unitCube);
    expect(r.displacedVolumeMm3).toBeCloseTo(1000, 0);
  });

  it('center of buoyancy at cube centre', () => {
    const r = computeBuoyancy(unitCube);
    expect(r.centerOfBuoyancy.x).toBeCloseTo(5, 0);
    expect(r.centerOfBuoyancy.y).toBeCloseTo(5, 0);
    expect(r.centerOfBuoyancy.z).toBeCloseTo(5, 0);
  });

  it('buoyancy force = ρ·g·V', () => {
    const r = computeBuoyancy(unitCube, WATER);
    // V = 1000 mm³ = 1e-6 m³, F = 1000·9.81·1e-6 ≈ 0.00981 N.
    expect(r.buoyancyForceN).toBeCloseTo(1000 * 9.81 * 1e-6, 6);
  });

  it('higher density fluid → higher force', () => {
    const water = computeBuoyancy(unitCube, { densityKgM3: 1000, gravityMs2: 9.81 });
    const mercury = computeBuoyancy(unitCube, { densityKgM3: 13600, gravityMs2: 9.81 });
    expect(mercury.buoyancyForceN).toBeGreaterThan(water.buoyancyForceN);
  });
});

describe('computeMetacentricHeight', () => {
  it('high Ixx → positive GM (stable)', () => {
    const r = computeMetacentricHeight({
      centerOfGravity: { x: 0, y: 0, z: 5 },
      centerOfBuoyancy: { x: 0, y: 0, z: 2 },
      displacedVolumeMm3: 1000,
      waterlineIxxMm4: 5000,
    });
    expect(r.stable).toBe(true);
  });

  it('low Ixx → negative GM (unstable)', () => {
    const r = computeMetacentricHeight({
      centerOfGravity: { x: 0, y: 0, z: 10 },
      centerOfBuoyancy: { x: 0, y: 0, z: 2 },
      displacedVolumeMm3: 1000,
      waterlineIxxMm4: 100,
    });
    expect(r.stable).toBe(false);
  });

  it('zero volume → BM zero', () => {
    const r = computeMetacentricHeight({
      centerOfGravity: { x: 0, y: 0, z: 0 },
      centerOfBuoyancy: { x: 0, y: 0, z: 0 },
      displacedVolumeMm3: 0,
      waterlineIxxMm4: 1000,
    });
    expect(r.bmMm).toBe(0);
  });
});

describe('tiltAnalysis', () => {
  it('equilibrium when force balanced + CB at CG xy', () => {
    const buoy = computeBuoyancy(unitCube);
    const r = tiltAnalysis(buoy, { x: 5, y: 5, z: 5 }, buoy.buoyancyForceN);
    expect(r.inEquilibrium).toBe(true);
  });

  it('out-of-equilibrium when CG horizontally offset', () => {
    const buoy = computeBuoyancy(unitCube);
    const r = tiltAnalysis(buoy, { x: 10, y: 10, z: 5 }, buoy.buoyancyForceN);
    expect(r.inEquilibrium).toBe(false);
    expect(r.rollMomentArmMm).toBeGreaterThan(0);
  });

  it('weight greater than buoyancy → net negative', () => {
    const buoy = computeBuoyancy(unitCube);
    const r = tiltAnalysis(buoy, { x: 5, y: 5, z: 5 }, buoy.buoyancyForceN * 2);
    expect(r.netForceN).toBeLessThan(0);
  });
});

describe('summarize', () => {
  it('reports displaced + force', () => {
    const r = computeBuoyancy(unitCube);
    const s = summarize(r);
    expect(s.displacedVolumeMm3).toBeCloseTo(1000, 0);
    expect(s.buoyancyForceN).toBeGreaterThan(0);
  });
});
