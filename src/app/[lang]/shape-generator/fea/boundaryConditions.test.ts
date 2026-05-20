import { describe, it, expect } from 'vitest';
import {
  DofMask,
  applyFixed,
  applyRoller,
  applyPin,
  applyPrescribedDisplacement,
  applyDistributedLoad,
  applyPressure,
  applyGravity,
  applyThermalExpansion,
  mergeBcs,
} from './boundaryConditions';

const nodes = [
  { id: 1, position: [0, 0, 0] as [number, number, number] },
  { id: 2, position: [10, 0, 0] as [number, number, number] },
];

describe('applyFixed', () => {
  it('clamps all 6 DOFs', () => {
    const r = applyFixed(nodes);
    expect(r.every(bc => bc.dofMask === DofMask.All)).toBe(true);
    expect(r).toHaveLength(2);
  });
});

describe('applyRoller', () => {
  it('constrains only the chosen axis', () => {
    const r = applyRoller(nodes, 'z');
    expect(r.every(bc => bc.dofMask === DofMask.Uz)).toBe(true);
  });
});

describe('applyPin', () => {
  it('constrains all translations only', () => {
    const r = applyPin(nodes);
    expect(r.every(bc => bc.dofMask === DofMask.Translational)).toBe(true);
  });
});

describe('applyPrescribedDisplacement', () => {
  it('attaches non-zero target', () => {
    const r = applyPrescribedDisplacement(nodes, [0, 0, 1]);
    expect(r[0]!.value).toEqual([0, 0, 1]);
  });
});

describe('applyDistributedLoad', () => {
  it('multiplies force/area by nodal area', () => {
    const surface = { nodeIds: [1, 2], nodalArea: [10, 20] };
    const r = applyDistributedLoad(surface, [0, 0, -1]);
    expect(r[0]!.value).toEqual([0, 0, -10]);
    expect(r[1]!.value).toEqual([0, 0, -20]);
  });

  it('throws on length mismatch', () => {
    expect(() =>
      applyDistributedLoad({ nodeIds: [1, 2], nodalArea: [10] }, [0, 0, -1]),
    ).toThrow();
  });
});

describe('applyPressure', () => {
  it('converts MPa into surface-normal nodal force', () => {
    const surface = { nodeIds: [1], nodalArea: [10] };
    const r = applyPressure(surface, [0, 0, 1], 2); // 2 MPa
    expect(r[0]!.value[2]).toBe(20); // 2 N/mm² × 10 mm² × 1
  });
});

describe('applyGravity', () => {
  it('produces F = m × g per node', () => {
    const r = applyGravity(nodes, [1, 2]);
    // 1 kg × 9810 mm/s² / 1000 = 9.81 N downward
    expect(r[0]!.value[2]).toBeCloseTo(-9.81, 2);
    expect(r[1]!.value[2]).toBeCloseTo(-19.62, 2);
  });

  it('throws on length mismatch', () => {
    expect(() => applyGravity(nodes, [1])).toThrow();
  });
});

describe('applyThermalExpansion', () => {
  it('returns ΔT × α × E equivalent stress', () => {
    const r = applyThermalExpansion(nodes, 100, 23e-6, 70_000);
    // 100 × 23e-6 × 70000 = 161 MPa
    expect(r[0]!.value[0]).toBeCloseTo(161, 0);
  });
});

describe('mergeBcs', () => {
  it('concatenates multiple lists', () => {
    const fixed = applyFixed([nodes[0]!]);
    const loaded = applyDistributedLoad({ nodeIds: [2], nodalArea: [5] }, [0, 0, -1]);
    const r = mergeBcs(fixed, loaded);
    expect(r).toHaveLength(2);
  });

  it('throws on conflicting displacement BCs at same node + DOF', () => {
    const a = applyFixed([nodes[0]!]);
    const b = applyPin([nodes[0]!]);
    expect(() => mergeBcs(a, b)).toThrow();
  });

  it('allows non-overlapping DOF constraints', () => {
    const ax = applyRoller([nodes[0]!], 'x');
    const ay = applyRoller([nodes[0]!], 'y');
    expect(() => mergeBcs(ax, ay)).not.toThrow();
  });
});
