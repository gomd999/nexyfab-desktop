import { describe, it, expect } from 'vitest';
import {
  splitAssembly,
  diagnoseSections,
  summarize,
  DEFAULT_CONSTRAINTS,
  type AssemblyNode,
} from './modularSectionSplit';

function node(id: string, mass: number, envelope: { x: number; y: number; z: number }, connections: AssemblyNode['connections'] = []): AssemblyNode {
  return { id, massKg: mass, envelope, connections };
}

describe('splitAssembly', () => {
  it('empty → no sections', () => {
    const r = splitAssembly([]);
    expect(r.sections).toEqual([]);
  });

  it('all fits in one section', () => {
    const nodes = [
      node('a', 1000, { x: 2000, y: 1000, z: 1000 }, [{ to: 'b', jointKind: 'flange', cost: 10 }]),
      node('b', 1000, { x: 2000, y: 1000, z: 1000 }, [{ to: 'a', jointKind: 'flange', cost: 10 }]),
    ];
    const r = splitAssembly(nodes);
    expect(r.sections).toHaveLength(1);
  });

  it('over mass → multiple sections', () => {
    const nodes = [
      node('a', 20000, { x: 5000, y: 1000, z: 1000 }, [{ to: 'b', jointKind: 'flange', cost: 10 }]),
      node('b', 20000, { x: 5000, y: 1000, z: 1000 }, [{ to: 'a', jointKind: 'flange', cost: 10 }]),
    ];
    const r = splitAssembly(nodes);
    expect(r.sections.length).toBeGreaterThan(1);
  });

  it('over length → multiple sections', () => {
    const nodes = [
      node('a', 1000, { x: 9000, y: 1000, z: 1000 }, [{ to: 'b', jointKind: 'flange', cost: 10 }]),
      node('b', 1000, { x: 9000, y: 1000, z: 1000 }, [{ to: 'a', jointKind: 'flange', cost: 10 }]),
    ];
    // Limit shorter than each node; canFit denies merging.
    const r = splitAssembly(nodes, { maxSectionLengthMm: 5000, maxSectionMassKg: 25000, maxSectionWidthMm: 2400, maxSectionHeightMm: 2400, integralPenalty: 1000 });
    expect(r.sections.length).toBeGreaterThan(1);
  });

  it('field joints detected for split', () => {
    const nodes = [
      node('a', 20000, { x: 5000, y: 1000, z: 1000 }, [{ to: 'b', jointKind: 'flange', cost: 10 }]),
      node('b', 20000, { x: 5000, y: 1000, z: 1000 }, [{ to: 'a', jointKind: 'flange', cost: 10 }]),
    ];
    const r = splitAssembly(nodes);
    expect(r.fieldJoints.length).toBeGreaterThan(0);
  });

  it('integral joint adds penalty', () => {
    const nodes = [
      node('a', 20000, { x: 5000, y: 1000, z: 1000 }, [{ to: 'b', jointKind: 'integral', cost: 10 }]),
      node('b', 20000, { x: 5000, y: 1000, z: 1000 }, [{ to: 'a', jointKind: 'integral', cost: 10 }]),
    ];
    const r = splitAssembly(nodes, { integralPenalty: 500, maxSectionMassKg: 25000, maxSectionLengthMm: 12000, maxSectionWidthMm: 2400, maxSectionHeightMm: 2400 });
    expect(r.totalFieldJointCost).toBeGreaterThan(500);
  });

  it('totalFieldJointCost sum of joint costs', () => {
    const nodes = [
      node('a', 20000, { x: 5000, y: 1000, z: 1000 }, [{ to: 'b', jointKind: 'flange', cost: 10 }]),
      node('b', 20000, { x: 5000, y: 1000, z: 1000 }, [{ to: 'a', jointKind: 'flange', cost: 10 }]),
    ];
    const r = splitAssembly(nodes);
    expect(r.totalFieldJointCost).toBeGreaterThan(0);
  });

  it('all nodes assigned to some section', () => {
    const nodes = [
      node('a', 1000, { x: 2000, y: 1000, z: 1000 }, []),
      node('b', 1000, { x: 2000, y: 1000, z: 1000 }, []),
      node('c', 1000, { x: 2000, y: 1000, z: 1000 }, []),
    ];
    const r = splitAssembly(nodes);
    const totalNodes = r.sections.reduce((s, sec) => s + sec.nodeIds.length, 0);
    expect(totalNodes).toBe(3);
  });
});

describe('diagnoseSections', () => {
  it('mass utilisation reported', () => {
    const nodes = [node('a', 1000, { x: 2000, y: 1000, z: 1000 })];
    const r = splitAssembly(nodes);
    const diag = diagnoseSections(r);
    expect(diag[0]!.utilisationMass).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const nodes = [
      node('a', 1000, { x: 2000, y: 1000, z: 1000 }, []),
      node('b', 1000, { x: 2000, y: 1000, z: 1000 }, []),
    ];
    const r = splitAssembly(nodes);
    const s = summarize(r);
    expect(s.sectionCount).toBe(r.sections.length);
    expect(s.fieldJointCount).toBe(r.fieldJoints.length);
  });
});

describe('DEFAULT_CONSTRAINTS', () => {
  it('has positive limits', () => {
    expect(DEFAULT_CONSTRAINTS.maxSectionMassKg).toBeGreaterThan(0);
    expect(DEFAULT_CONSTRAINTS.maxSectionLengthMm).toBeGreaterThan(0);
  });
});
