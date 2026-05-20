import { describe, it, expect } from 'vitest';
import {
  traceLoadPath,
  pathPolyline,
  stressEnvelope,
  buildTopologySeed,
  summarize,
  type FeaElement,
  type BoundaryCondition,
} from './loadPathVisualizer';

// Linear chain of elements sharing nodes: e0 → e1 → e2 → e3.
function chain(stresses: number[]): FeaElement[] {
  return stresses.map((s, i) => ({
    id: `e${i}`,
    centroid: { x: i * 10, y: 0, z: 0 },
    vonMisesMpa: s,
    nodeIds: [`n${i}`, `n${i + 1}`],
  }));
}

const bcAtoEnd: BoundaryCondition = {
  loadAppliedAt: 'n0',
  supportNodeIds: ['n4'],
};

describe('traceLoadPath', () => {
  it('empty elements → empty path', () => {
    const r = traceLoadPath([], bcAtoEnd);
    expect(r.pathElementIds).toEqual([]);
  });

  it('linear chain reaches support', () => {
    const r = traceLoadPath(chain([100, 80, 60, 40]), bcAtoEnd);
    expect(r.reachedSupport).toBe(true);
  });

  it('path starts at loaded element', () => {
    const r = traceLoadPath(chain([100, 80, 60, 40]), bcAtoEnd);
    expect(r.pathElementIds[0]).toBe('e0');
  });

  it('path stresses recorded', () => {
    const r = traceLoadPath(chain([100, 80, 60, 40]), bcAtoEnd);
    expect(r.pathStresses).toHaveLength(r.pathElementIds.length);
  });

  it('high-stress neighbour selected', () => {
    // Two branches from e0: e1 stress 50, e2 stress 90 → path picks e2.
    const elements: FeaElement[] = [
      { id: 'e0', centroid: { x: 0, y: 0, z: 0 }, vonMisesMpa: 100, nodeIds: ['n0', 'shared'] },
      { id: 'low', centroid: { x: 0, y: 10, z: 0 }, vonMisesMpa: 50, nodeIds: ['shared', 'nlow'] },
      { id: 'high', centroid: { x: 0, y: -10, z: 0 }, vonMisesMpa: 90, nodeIds: ['shared', 'nhigh'] },
    ];
    const r = traceLoadPath(elements, { loadAppliedAt: 'n0', supportNodeIds: ['nhigh'] });
    expect(r.pathElementIds).toContain('high');
  });

  it('redundant elements identified', () => {
    const elements: FeaElement[] = [
      ...chain([100, 80, 60, 40]),
      { id: 'redundant', centroid: { x: 100, y: 100, z: 0 }, vonMisesMpa: 5, nodeIds: ['nother'] },
    ];
    const r = traceLoadPath(elements, bcAtoEnd);
    expect(r.redundantElementIds).toContain('redundant');
  });

  it('isolated load → empty path', () => {
    const elements: FeaElement[] = [
      { id: 'e0', centroid: { x: 0, y: 0, z: 0 }, vonMisesMpa: 100, nodeIds: ['nA', 'nB'] },
    ];
    const r = traceLoadPath(elements, { loadAppliedAt: 'nX', supportNodeIds: ['nY'] });
    expect(r.pathElementIds).toEqual([]);
  });

  it('maxSteps caps path length', () => {
    const longChain = chain(Array.from({ length: 50 }, (_, i) => 100 - i));
    const r = traceLoadPath(longChain, { loadAppliedAt: 'n0', supportNodeIds: ['n100'] }, { maxSteps: 3, redundancyThreshold: 0.2 });
    expect(r.pathElementIds.length).toBeLessThanOrEqual(4);
  });
});

describe('pathPolyline', () => {
  it('returns centroid sequence', () => {
    const elements = chain([100, 80, 60, 40]);
    const r = traceLoadPath(elements, bcAtoEnd);
    const poly = pathPolyline(elements, r);
    expect(poly).toHaveLength(r.pathElementIds.length);
  });
});

describe('stressEnvelope', () => {
  it('normalised peak = 1', () => {
    const r = traceLoadPath(chain([100, 80, 60, 40]), bcAtoEnd);
    const env = stressEnvelope(r);
    expect(env[0]!.normalised).toBeCloseTo(1, 3);
  });
});

describe('buildTopologySeed', () => {
  it('retains non-redundant elements', () => {
    const elements: FeaElement[] = [
      ...chain([100, 80, 60, 40]),
      { id: 'redundant', centroid: { x: 100, y: 100, z: 0 }, vonMisesMpa: 5, nodeIds: ['nother'] },
    ];
    const r = traceLoadPath(elements, bcAtoEnd);
    const seed = buildTopologySeed(r, elements);
    expect(seed.removedElements).toContain('redundant');
    expect(seed.retentionFraction).toBeLessThan(1);
  });
});

describe('summarize', () => {
  it('reports path length + peak', () => {
    const r = traceLoadPath(chain([100, 80, 60, 40]), bcAtoEnd);
    const s = summarize(r);
    expect(s.pathLength).toBe(r.pathElementIds.length);
    expect(s.peakStressMpa).toBe(100);
  });
});
