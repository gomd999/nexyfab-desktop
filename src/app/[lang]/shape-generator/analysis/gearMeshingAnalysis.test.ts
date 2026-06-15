import { describe, it, expect } from 'vitest';
import {
  analyzeGearMesh,
  ratioInfo,
  summarize,
  type SpurGear,
} from './gearMeshingAnalysis';

function pinion(teeth: number = 20, module: number = 2): SpurGear {
  return { teeth, module };
}

function wheel(teeth: number = 40, module: number = 2): SpurGear {
  return { teeth, module };
}

describe('analyzeGearMesh', () => {
  it('pinion + wheel with same module mesh', () => {
    const r = analyzeGearMesh(pinion(), wheel());
    expect(r.issues.some(i => i.includes('Modules differ'))).toBe(false);
  });

  it('different modules → cannot mesh', () => {
    const r = analyzeGearMesh(pinion(20, 2), wheel(40, 3));
    expect(r.issues.some(i => i.includes('Modules differ'))).toBe(true);
  });

  it('center distance = (z1 + z2) · m / 2', () => {
    const r = analyzeGearMesh(pinion(20, 2), wheel(40, 2));
    expect(r.standardCenterDistanceMm).toBe(60);
  });

  it('pinion pitch radius = m · z / 2', () => {
    const r = analyzeGearMesh(pinion(20, 2), wheel(40, 2));
    expect(r.pinionPitchRadiusMm).toBe(20);
    expect(r.wheelPitchRadiusMm).toBe(40);
  });

  it('base radius = pitch · cos(α)', () => {
    const r = analyzeGearMesh(pinion(20, 2), wheel(40, 2));
    expect(r.pinionBaseRadiusMm).toBeCloseTo(20 * Math.cos(20 * Math.PI / 180), 3);
  });

  it('larger gears give larger contact ratio', () => {
    const a = analyzeGearMesh(pinion(20, 1), wheel(30, 1));
    const b = analyzeGearMesh(pinion(40, 1), wheel(60, 1));
    expect(b.contactRatio).toBeGreaterThan(a.contactRatio);
  });

  it('contact ratio matches the AGMA closed form for standard gears', () => {
    // 20T-20T, 20° standard → ε ≈ 1.557 (textbook AGMA value). Contact ratio is
    // dimensionless (module-independent).
    expect(analyzeGearMesh(pinion(20, 1), wheel(20, 1)).contactRatio).toBeCloseTo(1.557, 2);
    // 18T-36T, 20° standard → ε ≈ 1.611 (hand-computed from
    // [√(ra²−rb²) − r·sinα] summed over both gears / base pitch).
    expect(analyzeGearMesh(pinion(18, 1), wheel(36, 1)).contactRatio).toBeCloseTo(1.611, 2);
  });

  it('very small pinion is undercut', () => {
    const r = analyzeGearMesh(pinion(8, 2), wheel(40, 2));
    expect(r.pinionUndercut).toBe(true);
  });

  it('normal pinion (≥ 17 teeth at 20°) is not undercut', () => {
    const r = analyzeGearMesh(pinion(20, 2), wheel(40, 2));
    expect(r.pinionUndercut).toBe(false);
  });

  it('reports minimum teeth for no undercut', () => {
    const r = analyzeGearMesh(pinion(8, 2), wheel(40, 2));
    expect(r.minimumTeethForNoUndercut).toBeGreaterThanOrEqual(17);
  });

  it('passes for well-designed gear pair', () => {
    const r = analyzeGearMesh(pinion(20, 2), wheel(40, 2));
    expect(['pass', 'marginal']).toContain(r.verdict);
  });

  it('fails when contact ratio too low (very small teeth)', () => {
    const r = analyzeGearMesh(pinion(12, 1), wheel(13, 1), { minContactRatio: 2.0 });
    expect(['marginal', 'fail']).toContain(r.verdict);
  });

  it('pressure-angle mismatch flagged', () => {
    const r = analyzeGearMesh(
      { teeth: 20, module: 2, pressureAngleDeg: 20 },
      { teeth: 40, module: 2, pressureAngleDeg: 25 },
    );
    expect(r.issues.some(i => i.includes('Pressure angles differ'))).toBe(true);
  });
});

describe('ratioInfo', () => {
  it('ratio = wheel teeth / pinion teeth', () => {
    const r = ratioInfo(pinion(20), wheel(40));
    expect(r.ratio).toBeCloseTo(2, 5);
  });

  it('wheelRpmAtPinionRpm divides by ratio', () => {
    const r = ratioInfo(pinion(20), wheel(40));
    expect(r.wheelRpmAtPinionRpm(100)).toBeCloseTo(50, 5);
  });

  it('pinionRpmAtWheelRpm multiplies by ratio', () => {
    const r = ratioInfo(pinion(20), wheel(40));
    expect(r.pinionRpmAtWheelRpm(50)).toBeCloseTo(100, 5);
  });
});

describe('summarize', () => {
  it('reports verdict and contact ratio', () => {
    const r = analyzeGearMesh(pinion(20, 2), wheel(40, 2));
    const s = summarize(r);
    expect(s.verdict).toBe(r.verdict);
    expect(s.contactRatio).toBe(r.contactRatio);
  });

  it('issue count matches', () => {
    const r = analyzeGearMesh(pinion(8, 2), wheel(40, 2));
    const s = summarize(r);
    expect(s.issueCount).toBe(r.issues.length);
  });

  it('reports ratio', () => {
    const r = analyzeGearMesh(pinion(20, 2), wheel(40, 2));
    const s = summarize(r);
    expect(s.ratio).toBeCloseTo(2, 5);
  });
});
