import { describe, it, expect } from 'vitest';
import {
  sequenceSteps,
  summarize,
  type PartNode,
  type DependencyEdge,
} from './explodeStepSequencer';

function part(id: string, z: number, fastener: boolean = false, sub?: string): PartNode {
  const node: PartNode = { id, centroid: [0, 0, z], isFastener: fastener };
  if (sub) node.subAssemblyId = sub;
  return node;
}

describe('sequenceSteps', () => {
  it('empty input → empty result', () => {
    const r = sequenceSteps([]);
    expect(r.steps).toEqual([]);
    expect(r.unresolvedEdges).toEqual([]);
  });

  it('single part → one step', () => {
    const r = sequenceSteps([part('a', 0)]);
    expect(r.steps).toHaveLength(1);
  });

  it('outer parts come first along explode axis', () => {
    const parts = [part('inner', 0), part('outer', 10)];
    const r = sequenceSteps(parts, [], { explodeAxis: [0, 0, 1] });
    expect(r.steps[0]!.parts[0]).toBe('outer');
    expect(r.steps[1]!.parts[0]).toBe('inner');
  });

  it('dependency edges override layer order', () => {
    const parts = [part('inner', 0), part('outer', 10)];
    const deps: DependencyEdge[] = [{ predecessor: 'inner', successor: 'outer' }];
    const r = sequenceSteps(parts, deps);
    expect(r.steps[0]!.parts).toContain('inner');
  });

  it('cyclic dependencies recorded as unresolved', () => {
    const parts = [part('a', 5), part('b', 0)];
    const deps: DependencyEdge[] = [
      { predecessor: 'a', successor: 'b' },
      { predecessor: 'b', successor: 'a' },
    ];
    const r = sequenceSteps(parts, deps);
    expect(r.unresolvedEdges.length).toBeGreaterThan(0);
  });

  it('groups sub-assembly parts when option enabled', () => {
    const parts = [
      part('p1', 5, false, 'sub1'),
      part('p2', 4, false, 'sub1'),
      part('p3', 0),
    ];
    const r = sequenceSteps(parts, [], { groupSubAssemblies: true });
    const subStep = r.steps.find(s => s.kind === 'subassembly');
    expect(subStep).toBeDefined();
    expect(subStep!.parts).toHaveLength(2);
  });

  it('does not group when option disabled', () => {
    const parts = [
      part('p1', 5, false, 'sub1'),
      part('p2', 4, false, 'sub1'),
    ];
    const r = sequenceSteps(parts, [], { groupSubAssemblies: false });
    expect(r.steps.length).toBe(2);
  });

  it('fastener tagged as fastener kind', () => {
    const parts = [part('bolt1', 5, true), part('plate1', 0)];
    const r = sequenceSteps(parts, [], { groupSubAssemblies: false });
    const fastenerStep = r.steps.find(s => s.kind === 'fastener');
    expect(fastenerStep).toBeDefined();
    expect(fastenerStep!.parts).toContain('bolt1');
  });

  it('step numbers are 1-indexed and monotonic', () => {
    const parts = [part('a', 0), part('b', 5), part('c', 10)];
    const r = sequenceSteps(parts);
    expect(r.steps[0]!.stepNumber).toBe(1);
    for (let i = 1; i < r.steps.length; i++) {
      expect(r.steps[i]!.stepNumber).toBe(r.steps[i - 1]!.stepNumber + 1);
    }
  });

  it('assembly centroid is computed from inputs', () => {
    const parts = [part('a', 0), part('b', 10)];
    const r = sequenceSteps(parts);
    expect(r.assemblyCentroid[2]).toBeCloseTo(5, 5);
  });
});

describe('summarize', () => {
  it('zero counts for empty result', () => {
    const s = summarize({ steps: [], unresolvedEdges: [], assemblyCentroid: [0, 0, 0] });
    expect(s.stepCount).toBe(0);
    expect(s.partCount).toBe(0);
  });

  it('counts part total', () => {
    const r = sequenceSteps([part('a', 0), part('b', 5), part('c', 10)]);
    const s = summarize(r);
    expect(s.partCount).toBe(3);
  });

  it('counts fastener steps', () => {
    const r = sequenceSteps([part('b1', 5, true), part('p1', 0)], [], { groupSubAssemblies: false });
    const s = summarize(r);
    expect(s.fastenerStepCount).toBe(1);
  });

  it('counts sub-assembly steps', () => {
    const r = sequenceSteps([part('a', 5, false, 'sub'), part('b', 4, false, 'sub')], []);
    const s = summarize(r);
    expect(s.subAssemblyStepCount).toBeGreaterThanOrEqual(1);
  });
});
