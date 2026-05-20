import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  topologicalSort,
  partitionLevels,
  markDirty,
  canReorder,
  buildProfileReport,
  defeature,
  type FeatureNode,
} from './featureGraph';

const sample: FeatureNode[] = [
  { id: 'base', kind: 'box', parentIds: [] },
  { id: 'hole-1', kind: 'hole', parentIds: ['base'], params: { diameter: 6 } },
  { id: 'hole-2', kind: 'hole', parentIds: ['base'], params: { diameter: 0.3 } },
  { id: 'fillet', kind: 'fillet', parentIds: ['hole-1'], params: { radius: 1 } },
  { id: 'fillet-tiny', kind: 'fillet', parentIds: ['hole-2'], params: { radius: 0.1 } },
  { id: 'chamfer', kind: 'chamfer', parentIds: ['fillet'], params: { size: 0.5 } },
];

describe('buildGraph', () => {
  it('predecessors track parent ids', () => {
    const g = buildGraph(sample);
    expect(g.predecessors.get('fillet')?.has('hole-1')).toBe(true);
  });

  it('successors are reverse of predecessors', () => {
    const g = buildGraph(sample);
    expect(g.successors.get('base')?.has('hole-1')).toBe(true);
    expect(g.successors.get('base')?.has('hole-2')).toBe(true);
  });

  it('orphan parent id is filtered', () => {
    const f: FeatureNode[] = [
      { id: 'x', kind: 'extrude', parentIds: ['ghost'] },
    ];
    const g = buildGraph(f);
    expect(g.predecessors.get('x')?.size).toBe(0);
  });
});

describe('topologicalSort', () => {
  it('returns acyclic order', () => {
    const r = topologicalSort(buildGraph(sample));
    expect(r.acyclic).toBe(true);
    // base must appear before hole-1; hole-1 before fillet.
    const baseIdx = r.order.indexOf('base');
    const holeIdx = r.order.indexOf('hole-1');
    const filletIdx = r.order.indexOf('fillet');
    expect(baseIdx).toBeLessThan(holeIdx);
    expect(holeIdx).toBeLessThan(filletIdx);
  });

  it('detects cycle', () => {
    const cyclic: FeatureNode[] = [
      { id: 'a', kind: 'a', parentIds: ['b'] },
      { id: 'b', kind: 'b', parentIds: ['a'] },
    ];
    const r = topologicalSort(buildGraph(cyclic));
    expect(r.acyclic).toBe(false);
    expect(r.cycle).toBeDefined();
  });
});

describe('partitionLevels', () => {
  it('base at level 0', () => {
    const r = partitionLevels(buildGraph(sample));
    expect(r[0]!.featureIds).toContain('base');
  });

  it('holes at level 1, fillets at level 2', () => {
    const r = partitionLevels(buildGraph(sample));
    const holeLevel = r.find(l => l.featureIds.includes('hole-1'))!.index;
    const filletLevel = r.find(l => l.featureIds.includes('fillet'))!.index;
    expect(filletLevel).toBeGreaterThan(holeLevel);
  });

  it('siblings at same level can run in parallel', () => {
    const r = partitionLevels(buildGraph(sample));
    const holesLevel = r.find(l => l.featureIds.includes('hole-1'));
    expect(holesLevel?.featureIds).toContain('hole-2');
  });
});

describe('markDirty', () => {
  it('changed feature itself is dirty', () => {
    const r = markDirty(buildGraph(sample), ['fillet']);
    expect(r.dirtyIds.has('fillet')).toBe(true);
  });

  it('downstream of change is dirty', () => {
    const r = markDirty(buildGraph(sample), ['hole-1']);
    expect(r.dirtyIds.has('fillet')).toBe(true);
    expect(r.dirtyIds.has('chamfer')).toBe(true);
  });

  it('siblings not affected', () => {
    const r = markDirty(buildGraph(sample), ['hole-2']);
    expect(r.cleanIds.has('hole-1')).toBe(true);
    expect(r.cleanIds.has('fillet')).toBe(true);
  });

  it('base change → everything dirty', () => {
    const r = markDirty(buildGraph(sample), ['base']);
    expect(r.dirtyIds.size).toBe(6);
  });
});

describe('canReorder', () => {
  it('safe to swap siblings (hole-1 ↔ hole-2)', () => {
    const g = buildGraph(sample);
    const hole2Idx = sample.findIndex(f => f.id === 'hole-2');
    const r = canReorder(sample, g, 'hole-1', hole2Idx);
    expect(r.safe).toBe(true);
  });

  it('unsafe to move fillet before hole-1', () => {
    const g = buildGraph(sample);
    const holeIdx = sample.findIndex(f => f.id === 'hole-1');
    const r = canReorder(sample, g, 'fillet', holeIdx);
    expect(r.safe).toBe(false);
  });

  it('unknown feature → unsafe', () => {
    const r = canReorder(sample, buildGraph(sample), 'not-there', 0);
    expect(r.safe).toBe(false);
  });
});

describe('buildProfileReport', () => {
  const timings = [
    { featureId: 'base', startMs: 0, durationMs: 10 },
    { featureId: 'hole-1', startMs: 10, durationMs: 5 },
    { featureId: 'hole-2', startMs: 10, durationMs: 3 },
    { featureId: 'fillet', startMs: 15, durationMs: 20 },
    { featureId: 'fillet-tiny', startMs: 13, durationMs: 1 },
    { featureId: 'chamfer', startMs: 35, durationMs: 2 },
  ];

  it('total = max(start + duration)', () => {
    const r = buildProfileReport(timings, buildGraph(sample));
    expect(r.totalDurationMs).toBe(37);
  });

  it('hotspots sorted by duration desc', () => {
    const r = buildProfileReport(timings, buildGraph(sample), 3);
    expect(r.hotspots[0]!.featureId).toBe('fillet');
  });

  it('critical path is base → hole-1 → fillet → chamfer', () => {
    const r = buildProfileReport(timings, buildGraph(sample));
    expect(r.criticalPath).toEqual(['base', 'hole-1', 'fillet', 'chamfer']);
  });

  it('critical path duration = sum of timings on the path', () => {
    const r = buildProfileReport(timings, buildGraph(sample));
    expect(r.criticalPathMs).toBe(10 + 5 + 20 + 2);
  });
});

describe('defeature', () => {
  it('suppresses tiny fillet', () => {
    const r = defeature(sample, {
      minFilletRadiusMm: 0.5, minChamferSizeMm: 0.3, minHoleDiameterMm: 0.5,
    });
    expect(r.suppressedIds).toContain('fillet-tiny');
  });

  it('keeps fillets above threshold', () => {
    const r = defeature(sample, {
      minFilletRadiusMm: 0.5, minChamferSizeMm: 0.3, minHoleDiameterMm: 0.5,
    });
    expect(r.suppressedIds).not.toContain('fillet');
  });

  it('suppresses tiny hole', () => {
    const r = defeature(sample, {
      minFilletRadiusMm: 0.5, minChamferSizeMm: 0.3, minHoleDiameterMm: 1.0,
    });
    expect(r.suppressedIds).toContain('hole-2');
  });

  it('preserve kinds skipped from defeaturing', () => {
    const r = defeature(sample, {
      minFilletRadiusMm: 0.5, minChamferSizeMm: 0.3, minHoleDiameterMm: 0.5,
      preserveKinds: ['fillet'],
    });
    expect(r.suppressedIds).not.toContain('fillet-tiny');
  });

  it('emits reason for each suppressed feature', () => {
    const r = defeature(sample, {
      minFilletRadiusMm: 0.5, minChamferSizeMm: 0.3, minHoleDiameterMm: 1.0,
    });
    expect(r.reasons.has('fillet-tiny')).toBe(true);
    expect(r.reasons.has('hole-2')).toBe(true);
  });
});
