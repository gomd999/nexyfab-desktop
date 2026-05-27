import { describe, it, expect } from 'vitest';
import {
  checkCoining,
  multiPassPlan,
  compareProcesses,
  summarize,
  MATERIAL_DB,
  type CoiningInput,
  type PressCapability,
} from './coiningCheck';

const press: PressCapability = { maxTonnageKn: 1000, coiningCapable: true };
const weakPress: PressCapability = { maxTonnageKn: 50, coiningCapable: false };

function input(partial: Partial<CoiningInput> = {}): CoiningInput {
  return { material: 'mild-steel', thicknessMm: 2, insideRadiusMm: 1, bendLengthMm: 200, angleDeg: 90, ...partial };
}

describe('MATERIAL_DB', () => {
  it('mild-steel UTS = 450 MPa', () => {
    expect(MATERIAL_DB['mild-steel'].utsMpa).toBe(450);
  });

  it('stainless has higher UTS', () => {
    expect(MATERIAL_DB['stainless-304'].utsMpa).toBeGreaterThan(MATERIAL_DB['mild-steel'].utsMpa);
  });
});

describe('checkCoining', () => {
  it('valid input → tonnage positive', () => {
    const r = checkCoining(input(), press);
    expect(r.requiredTonnageKn).toBeGreaterThan(0);
  });

  it('coining tonnage is 5× air-bend equivalent', () => {
    const r = checkCoining(input(), press);
    expect(r.coiningMultiple).toBe(5);
  });

  it('feasible when within press capacity', () => {
    const r = checkCoining(input(), press);
    expect(r.feasible).toBe(true);
  });

  it('not feasible when press too small', () => {
    const r = checkCoining(input(), weakPress);
    expect(r.feasible).toBe(false);
  });

  it('warns on press not coining-capable', () => {
    const r = checkCoining(input(), { maxTonnageKn: 10000, coiningCapable: false });
    expect(r.warnings.some(w => w.includes('coining-capable'))).toBe(true);
  });

  it('warns on tight inside radius', () => {
    const r = checkCoining(input({ insideRadiusMm: 0.1 }), press);
    expect(r.warnings.some(w => w.includes('cracking'))).toBe(true);
  });

  it('warns on non-90 angle', () => {
    const r = checkCoining(input({ angleDeg: 60 }), press);
    expect(r.warnings.some(w => w.includes('90°'))).toBe(true);
  });

  it('recommended die V ≥ 6t', () => {
    const r = checkCoining(input({ thicknessMm: 3 }), press);
    expect(r.recommendedDieVMm).toBeGreaterThanOrEqual(18);
  });

  it('thicker sheet → higher tonnage', () => {
    const thin = checkCoining(input({ thicknessMm: 1 }), press);
    const thick = checkCoining(input({ thicknessMm: 4 }), press);
    expect(thick.requiredTonnageKn).toBeGreaterThan(thin.requiredTonnageKn);
  });
});

describe('multiPassPlan', () => {
  it('single pass when feasible', () => {
    const plan = multiPassPlan(input(), press);
    expect(plan.totalPasses).toBe(1);
  });

  it('multiple passes when over-tonnage', () => {
    const plan = multiPassPlan(input({ thicknessMm: 6 }), weakPress);
    expect(plan.totalPasses).toBeGreaterThan(1);
  });

  it('depths sum to thickness', () => {
    const plan = multiPassPlan(input({ thicknessMm: 6 }), weakPress);
    const total = plan.perPassDepthMm.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(6, 3);
  });
});

describe('compareProcesses', () => {
  it('coining tonnage > air-bend', () => {
    const cmp = compareProcesses(input());
    expect(cmp.coiningTonnageKn).toBeGreaterThan(cmp.airBendTonnageKn);
  });

  it('recommends coining for tight inside R', () => {
    const cmp = compareProcesses(input({ insideRadiusMm: 0.3 }));
    expect(cmp.recommendedProcess).toBe('coining');
  });

  it('recommends air-bend for generous R', () => {
    const cmp = compareProcesses(input({ insideRadiusMm: 5 }));
    expect(cmp.recommendedProcess).toBe('air-bend');
  });

  it('coining springback < air-bend', () => {
    const cmp = compareProcesses(input());
    expect(cmp.coiningSpringback).toBeLessThan(cmp.airBendDeflection);
  });
});

describe('summarize', () => {
  it('reports feasibility', () => {
    const r = checkCoining(input(), press);
    const s = summarize(r);
    expect(s.feasible).toBe(r.feasible);
    expect(s.requiredTonnageKn).toBe(r.requiredTonnageKn);
  });
});
