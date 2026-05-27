import { describe, it, expect } from 'vitest';
import {
  balanceRunners,
  diagnose,
  summarize,
  type RunnerBranch,
  type ChannelInputs,
} from './runnerBalanceOptimizer';

const inputs: ChannelInputs = { totalFlowCm3PerS: 100, viscosityPaS: 500 };

// Balanced binary tree: 1 trunk + 2 sub-runners + 4 gates of equal length.
function balancedTree(): RunnerBranch[] {
  return [
    { id: 'trunk', parentId: null, lengthMm: 50, diameterMm: 8, isGate: false },
    { id: 'L', parentId: 'trunk', lengthMm: 50, diameterMm: 6, isGate: false },
    { id: 'R', parentId: 'trunk', lengthMm: 50, diameterMm: 6, isGate: false },
    { id: 'g1', parentId: 'L', lengthMm: 30, diameterMm: 4, isGate: true },
    { id: 'g2', parentId: 'L', lengthMm: 30, diameterMm: 4, isGate: true },
    { id: 'g3', parentId: 'R', lengthMm: 30, diameterMm: 4, isGate: true },
    { id: 'g4', parentId: 'R', lengthMm: 30, diameterMm: 4, isGate: true },
  ];
}

function unbalancedTree(): RunnerBranch[] {
  // One sub-branch has longer leg → imbalance.
  return [
    { id: 'trunk', parentId: null, lengthMm: 50, diameterMm: 8, isGate: false },
    { id: 'L', parentId: 'trunk', lengthMm: 50, diameterMm: 6, isGate: false },
    { id: 'R', parentId: 'trunk', lengthMm: 50, diameterMm: 6, isGate: false },
    { id: 'g1', parentId: 'L', lengthMm: 20, diameterMm: 4, isGate: true },
    { id: 'g2', parentId: 'L', lengthMm: 50, diameterMm: 4, isGate: true },
    { id: 'g3', parentId: 'R', lengthMm: 30, diameterMm: 4, isGate: true },
  ];
}

describe('balanceRunners', () => {
  it('balanced tree converges quickly', () => {
    const r = balanceRunners(balancedTree(), inputs, 10, 0.05);
    expect(r.imbalanceRatio).toBeLessThan(0.05);
  });

  it('unbalanced tree has positive iterations', () => {
    const r = balanceRunners(unbalancedTree(), inputs, 30, 0.05);
    expect(r.iterations).toBeGreaterThan(0);
  });

  it('per-gate dp computed for each gate', () => {
    const r = balanceRunners(balancedTree(), inputs);
    expect(r.perGateDeltaP.size).toBe(4);
  });

  it('recommended diameters cover all branches', () => {
    const tree = balancedTree();
    const r = balanceRunners(tree, inputs);
    for (const b of tree) {
      expect(r.recommendedDiameters.has(b.id)).toBe(true);
    }
  });

  it('imbalance decreases after optimisation', () => {
    const tree = unbalancedTree();
    const r = balanceRunners(tree, inputs, 50, 0.01);
    expect(r.imbalanceRatio).toBeLessThan(2);
  });

  it('balanced tree iterations small', () => {
    const r = balanceRunners(balancedTree(), inputs, 30, 0.05);
    expect(r.iterations).toBeLessThan(10);
  });
});

describe('diagnose', () => {
  it('balanced tree is balanced', () => {
    const r = balanceRunners(balancedTree(), inputs);
    expect(diagnose(r).isBalanced).toBe(true);
  });

  it('worst gate identified', () => {
    const r = balanceRunners(unbalancedTree(), inputs, 5);
    expect(diagnose(r).worstGateId).not.toBeNull();
  });

  it('gate count reported', () => {
    const r = balanceRunners(balancedTree(), inputs);
    expect(diagnose(r).gateCount).toBe(4);
  });
});

describe('summarize', () => {
  it('reports key fields', () => {
    const r = balanceRunners(balancedTree(), inputs);
    const s = summarize(r);
    expect(s.gateCount).toBe(4);
    expect(s.iterations).toBeGreaterThanOrEqual(0);
  });

  it('isBalanced echoes imbalance', () => {
    const r = balanceRunners(balancedTree(), inputs);
    expect(summarize(r).isBalanced).toBe(true);
  });
});
