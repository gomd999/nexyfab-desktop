/**
 * diffConfigs.test.ts — diff after parent-chain resolution.
 */
import { describe, it, expect } from 'vitest';
import { ConfigurationTable } from '../ConfigurationTable';
import { diffConfigs } from '../diffConfigs';
import type { FeatureInstance } from '../../features/types';

function feat(id: string, params: Record<string, number>): FeatureInstance {
  return {
    id,
    type: 'fillet' as unknown as FeatureInstance['type'],
    params,
    enabled: true,
  };
}

const masters: FeatureInstance[] = [
  feat('f1', { r: 1, h: 10 }),
  feat('f2', { thickness: 2 }),
  feat('f3', { count: 4 }),
];

describe('diffConfigs', () => {
  it('reports identical configs as empty diff', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    const d = diffConfigs(t, masters, 'a', 'b');
    expect(d).toEqual({
      configA: 'a',
      configB: 'b',
      suppressedInA: [],
      suppressedInB: [],
      paramDeltas: [],
    });
  });

  it('reports param value delta', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    t.setOverride('a', 'f1', 'r', 5);
    t.setOverride('b', 'f1', 'r', 8);
    const d = diffConfigs(t, masters, 'a', 'b');
    expect(d.paramDeltas).toEqual([
      { featureId: 'f1', paramKey: 'r', valueA: 5, valueB: 8 },
    ]);
  });

  it('reports param present-on-one-side delta', () => {
    // A overrides r to 5; B leaves r at master (1). The diff
    // surfaces the value difference, not "missing".
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    t.setOverride('a', 'f1', 'r', 5);
    const d = diffConfigs(t, masters, 'a', 'b');
    expect(d.paramDeltas).toEqual([
      { featureId: 'f1', paramKey: 'r', valueA: 5, valueB: 1 },
    ]);
  });

  it('reports suppress delta (suppressedInB)', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    t.setSuppressed('b', 'f2', true);  // f2 suppressed in B → "visible in A only"
    const d = diffConfigs(t, masters, 'a', 'b');
    expect(d.suppressedInB).toEqual(['f2']);  // missing-in-B
    expect(d.suppressedInA).toEqual([]);
    expect(d.paramDeltas).toEqual([]);
  });

  it('reports suppress delta (suppressedInA)', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    t.setSuppressed('a', 'f2', true);
    const d = diffConfigs(t, masters, 'a', 'b');
    expect(d.suppressedInA).toEqual(['f2']);
    expect(d.suppressedInB).toEqual([]);
  });

  it('mixes param + suppress deltas, sorted stably', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    t.setOverride('a', 'f1', 'r', 5);
    t.setOverride('b', 'f1', 'h', 99);
    t.setSuppressed('a', 'f3', true);
    const d = diffConfigs(t, masters, 'a', 'b');
    expect(d.suppressedInA).toEqual(['f3']);
    expect(d.paramDeltas).toEqual([
      { featureId: 'f1', paramKey: 'h', valueA: 10, valueB: 99 },
      { featureId: 'f1', paramKey: 'r', valueA: 5, valueB: 1 },
    ]);
  });

  it('inherited overrides surface in the diff', () => {
    // Parent contributes r=5; child A inherits, child B doesn't.
    const t = new ConfigurationTable();
    t.add('P', { id: 'p' });
    t.add('A', { id: 'a', parentId: 'p' });
    t.add('B', { id: 'b' });
    t.setOverride('p', 'f1', 'r', 5);
    const d = diffConfigs(t, masters, 'a', 'b');
    expect(d.paramDeltas).toEqual([
      { featureId: 'f1', paramKey: 'r', valueA: 5, valueB: 1 },
    ]);
  });

  it('two NaN values do not appear as a delta', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    t.setOverride('a', 'f1', 'r', 'undefined_var');  // becomes NaN
    t.setOverride('b', 'f1', 'r', 'undefined_var');
    const d = diffConfigs(t, masters, 'a', 'b');
    expect(d.paramDeltas).toEqual([]);
  });

  it('unknown configs resolve to master — diff is empty', () => {
    const t = new ConfigurationTable();
    const d = diffConfigs(t, masters, 'nope-a', 'nope-b');
    expect(d.paramDeltas).toEqual([]);
    expect(d.suppressedInA).toEqual([]);
    expect(d.suppressedInB).toEqual([]);
  });
});
