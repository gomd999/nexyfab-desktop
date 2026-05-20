import { describe, it, expect } from 'vitest';
import {
  checkConsistency,
  checkEquilibrium,
  checkSymmetry,
  summarize,
  type SupportConstraint,
  type AppliedLoad,
} from './boundaryConditionConsistency';

function fix(id: string, dofs: SupportConstraint['constrainedDofs']): SupportConstraint {
  return { id, nodeId: `n-${id}`, constrainedDofs: dofs };
}

function load(id: string, fx: number, fy: number, fz: number): AppliedLoad {
  return { id, nodeId: `n-${id}`, force: { x: fx, y: fy, z: fz } };
}

describe('checkConsistency', () => {
  it('empty supports → warning', () => {
    const r = checkConsistency([], [load('a', 0, 0, -100)]);
    expect(r.warnings.some(w => w.includes('No supports'))).toBe(true);
  });

  it('fully constrained 6-DOF → no rigid-body modes', () => {
    const supports = [fix('s1', ['x', 'y', 'z', 'rx', 'ry', 'rz'])];
    const r = checkConsistency(supports, []);
    expect(r.hasRigidBodyModes).toBe(false);
    expect(r.freeDofs.size).toBe(0);
  });

  it('partial support → rigid body modes warning', () => {
    const supports = [fix('s1', ['x', 'y', 'z'])];
    const r = checkConsistency(supports, []);
    expect(r.hasRigidBodyModes).toBe(true);
    expect(r.freeDofs.size).toBe(3);
  });

  it('net force computed', () => {
    const r = checkConsistency([fix('s', ['x', 'y', 'z'])], [load('a', 100, 0, 0)]);
    expect(r.netForce.x).toBe(100);
  });

  it('warns when load in unconstrained DOF', () => {
    const r = checkConsistency([fix('s', ['y'])], [load('a', 100, 0, 0)]);
    expect(r.warnings.some(w => w.includes('rigid translation'))).toBe(true);
  });

  it('moment summed', () => {
    const r = checkConsistency([fix('s', ['x', 'y', 'z', 'rx', 'ry', 'rz'])], [{ id: 'a', nodeId: 'n', force: { x: 0, y: 0, z: 0 }, moment: { x: 50, y: 0, z: 0 } }]);
    expect(r.netMoment.x).toBe(50);
  });
});

describe('checkEquilibrium', () => {
  it('matching reaction → equilibrium', () => {
    const r = checkConsistency([fix('s', ['x', 'y', 'z'])], [load('a', 0, 0, -100)]);
    const eq = checkEquilibrium(r, { force: { x: 0, y: 0, z: 100 } });
    expect(eq.inEquilibrium).toBe(true);
  });

  it('mismatched reaction → not equilibrium', () => {
    const r = checkConsistency([fix('s', ['x', 'y', 'z'])], [load('a', 0, 0, -100)]);
    const eq = checkEquilibrium(r, { force: { x: 0, y: 0, z: 50 } });
    expect(eq.inEquilibrium).toBe(false);
  });

  it('forceImbalance positive', () => {
    const r = checkConsistency([], [load('a', 100, 0, 0)]);
    const eq = checkEquilibrium(r, { force: { x: 0, y: 0, z: 0 } });
    expect(eq.forceImbalanceN).toBeGreaterThan(0);
  });
});

describe('checkSymmetry', () => {
  it('symmetric loads pass', () => {
    const loads = [
      load('a', 100, 0, 0),
      load('b', -100, 0, 0),
    ];
    expect(checkSymmetry(loads, 'yz').actuallySymmetric).toBe(true);
  });

  it('asymmetric loads fail', () => {
    const loads = [load('a', 100, 0, 0)];
    expect(checkSymmetry(loads, 'yz').actuallySymmetric).toBe(false);
  });

  it('asymmetryReason populated', () => {
    const result = checkSymmetry([load('a', 100, 0, 0)], 'yz');
    expect(result.asymmetryReason).toBeDefined();
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const supports = [fix('s', ['x', 'y', 'z'])];
    const loads = [load('a', 0, 0, -100)];
    const r = checkConsistency(supports, loads);
    const s = summarize(supports, loads, r);
    expect(s.supportCount).toBe(1);
    expect(s.loadCount).toBe(1);
    expect(s.freeDofCount).toBe(3);
  });
});
