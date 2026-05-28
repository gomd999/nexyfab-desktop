/**
 * ConfigurationTable.test.ts — A2 runtime class.
 *
 * Coverage: add/remove/rename/activate, overrides, parent chain
 * resolution (linear + branching + no-parent), cycle refusal,
 * resolveActive correctness, JSON round-trip.
 */

import { describe, it, expect } from 'vitest';
import { ConfigurationTable } from '../ConfigurationTable';
import type { FeatureInstance } from '../../features/types';

function feat(id: string, params: Record<string, number>): FeatureInstance {
  // Cast through `unknown` to satisfy the FeatureType enum without
  // pulling the registry; the resolver doesn't read `.type` so any
  // string-like value is fine for unit tests.
  return {
    id,
    type: 'fillet' as unknown as FeatureInstance['type'],
    params,
    enabled: true,
  };
}

describe('ConfigurationTable — add / remove / rename', () => {
  it('add() creates an entry with a generated id', () => {
    const t = new ConfigurationTable();
    const a = t.add('Small');
    expect(a.id).toBe('cfg-0');
    expect(a.name).toBe('Small');
    expect(a.overrides).toEqual({});
    expect(a.expressionVars).toEqual({});
    expect(a.parentId).toBeUndefined();
  });

  it('add() honours an explicit id', () => {
    const t = new ConfigurationTable();
    const a = t.add('M3', { id: 'cfg-m3' });
    expect(a.id).toBe('cfg-m3');
  });

  it('add() refuses duplicate ids', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'x' });
    expect(() => t.add('B', { id: 'x' })).toThrow(/already exists/);
  });

  it('add() activates the first config automatically', () => {
    const t = new ConfigurationTable();
    expect(t.getActiveId()).toBeNull();
    t.add('A');
    expect(t.getActiveId()).toBe('cfg-0');
  });

  it('add() does NOT re-activate when one is already active', () => {
    const t = new ConfigurationTable();
    t.add('A'); // cfg-0 active
    t.add('B');
    expect(t.getActiveId()).toBe('cfg-0');
  });

  it('list() returns insertion order', () => {
    const t = new ConfigurationTable();
    t.add('A');
    t.add('B');
    t.add('C');
    expect(t.list().map(e => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('list() returns clones — mutating one does not affect the table', () => {
    const t = new ConfigurationTable();
    t.add('A');
    const snap = t.list();
    snap[0]!.name = 'mutated';
    expect(t.list()[0]!.name).toBe('A');
  });

  it('get() returns null for unknown id', () => {
    const t = new ConfigurationTable();
    expect(t.get('nope')).toBeNull();
  });

  it('remove() returns false for unknown id', () => {
    const t = new ConfigurationTable();
    expect(t.remove('nope')).toBe(false);
  });

  it('remove() picks the next config as active', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    t.activate('a');
    t.remove('a');
    expect(t.getActiveId()).toBe('b');
  });

  it('remove() leaves activeId null when the last config is gone', () => {
    const t = new ConfigurationTable();
    t.add('A');
    t.remove('cfg-0');
    expect(t.getActiveId()).toBeNull();
  });

  it('remove() detaches children — they survive but lose inheritance', () => {
    const t = new ConfigurationTable();
    t.add('Parent', { id: 'p' });
    t.add('Child', { id: 'c', parentId: 'p' });
    t.remove('p');
    expect(t.get('c')!.parentId).toBeUndefined();
  });

  it('rename() updates name; returns false for unknown id', () => {
    const t = new ConfigurationTable();
    t.add('A');
    expect(t.rename('cfg-0', 'A-renamed')).toBe(true);
    expect(t.get('cfg-0')!.name).toBe('A-renamed');
    expect(t.rename('missing', 'x')).toBe(false);
  });

  it('rename() allows duplicate names (ids are the identity)', () => {
    const t = new ConfigurationTable();
    t.add('Same');
    t.add('Different');
    expect(t.rename('cfg-1', 'Same')).toBe(true);
    expect(t.list().filter(e => e.name === 'Same').length).toBe(2);
  });
});

describe('ConfigurationTable — activate / getActive', () => {
  it('activate(null) selects master', () => {
    const t = new ConfigurationTable();
    t.add('A');
    expect(t.activate(null)).toBe(true);
    expect(t.getActive()).toBeNull();
    expect(t.getActiveId()).toBeNull();
  });

  it('activate(unknown) returns false and does not change active', () => {
    const t = new ConfigurationTable();
    t.add('A');
    expect(t.activate('nope')).toBe(false);
    expect(t.getActiveId()).toBe('cfg-0');
  });
});

describe('ConfigurationTable — overrides', () => {
  it('setOverride() + getOverride() round-trip a single param', () => {
    const t = new ConfigurationTable();
    t.add('Small', { id: 's' });
    expect(t.setOverride('s', 'f1', 'radius', 5)).toBe(true);
    const ov = t.getOverride('s', 'f1');
    expect(ov).toEqual({ params: { radius: 5 } });
  });

  it('setOverride() merges params across calls', () => {
    const t = new ConfigurationTable();
    t.add('Small', { id: 's' });
    t.setOverride('s', 'f1', 'radius', 5);
    t.setOverride('s', 'f1', 'height', 10);
    expect(t.getOverride('s', 'f1')).toEqual({ params: { radius: 5, height: 10 } });
  });

  it('setOverride() last-write-wins per key', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    t.setOverride('s', 'f1', 'r', 5);
    t.setOverride('s', 'f1', 'r', 8);
    expect(t.getOverride('s', 'f1')).toEqual({ params: { r: 8 } });
  });

  it('setOverride() accepts string expressions', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    t.setOverride('s', 'f1', 'radius', 'bolt_d * 0.5');
    expect(t.getOverride('s', 'f1')).toEqual({ params: { radius: 'bolt_d * 0.5' } });
  });

  it('setOverride() returns false for unknown config', () => {
    const t = new ConfigurationTable();
    expect(t.setOverride('missing', 'f1', 'r', 5)).toBe(false);
  });

  it('clearOverride() removes the param and drains the slot', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    t.setOverride('s', 'f1', 'r', 5);
    expect(t.clearOverride('s', 'f1', 'r')).toBe(true);
    expect(t.getOverride('s', 'f1')).toBeNull();
  });

  it('clearOverride() leaves suppress flag intact', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    t.setOverride('s', 'f1', 'r', 5);
    t.setSuppressed('s', 'f1', true);
    t.clearOverride('s', 'f1', 'r');
    expect(t.getOverride('s', 'f1')).toEqual({ suppressed: true });
  });

  it('clearOverride() returns false for unknown param', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    expect(t.clearOverride('s', 'f1', 'r')).toBe(false);
  });

  it('setSuppressed() toggles suppression independently of params', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    t.setSuppressed('s', 'f1', true);
    expect(t.getOverride('s', 'f1')).toEqual({ suppressed: true });
    t.setSuppressed('s', 'f1', false);
    expect(t.getOverride('s', 'f1')).toEqual({ suppressed: false });
  });
});

describe('ConfigurationTable — resolveActive', () => {
  const masters = [
    feat('f1', { radius: 1, height: 10 }),
    feat('f2', { thickness: 2 }),
    feat('f3', { count: 4 }),
  ];

  it('returns master clone when no config is active', () => {
    const t = new ConfigurationTable();
    t.add('A');
    t.activate(null);
    const r = t.resolveActive(masters);
    expect(r.map(f => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(r[0]!.params).toEqual({ radius: 1, height: 10 });
    // Mutation-isolation
    r[0]!.params.radius = 99;
    expect(masters[0]!.params.radius).toBe(1);
  });

  it('applies overrides to the active config', () => {
    const t = new ConfigurationTable();
    t.add('Small', { id: 's' });
    t.setOverride('s', 'f1', 'radius', 5);
    t.activate('s');
    const r = t.resolveActive(masters);
    expect(r[0]!.params).toEqual({ radius: 5, height: 10 });
    expect(r[1]!.params).toEqual({ thickness: 2 });
  });

  it('drops suppressed features', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    t.setSuppressed('s', 'f2', true);
    t.activate('s');
    const r = t.resolveActive(masters);
    expect(r.map(f => f.id)).toEqual(['f1', 'f3']);
  });

  it('does not mutate the master features array', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    t.setOverride('s', 'f1', 'radius', 99);
    t.activate('s');
    t.resolveActive(masters);
    expect(masters[0]!.params.radius).toBe(1);
  });

  it('coerces string expressions to NaN today (A2 placeholder for A3 eval)', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    t.setOverride('s', 'f1', 'radius', 'bolt_d * 0.5');
    t.activate('s');
    const r = t.resolveActive(masters);
    expect(Number.isNaN(r[0]!.params.radius)).toBe(true);
  });
});

describe('ConfigurationTable — parent chain resolution', () => {
  const masters = [
    feat('f1', { r: 1 }),
    feat('f2', { h: 10 }),
  ];

  it('linear chain: child overrides parent overrides master', () => {
    const t = new ConfigurationTable();
    t.add('P', { id: 'p' });
    t.add('C', { id: 'c', parentId: 'p' });
    t.setOverride('p', 'f1', 'r', 5);  // parent says 5
    t.setOverride('c', 'f1', 'r', 8);  // child says 8 (wins)
    t.activate('c');
    expect(t.resolveActive(masters)[0]!.params.r).toBe(8);
  });

  it('linear chain: child inherits parent override when child has none', () => {
    const t = new ConfigurationTable();
    t.add('P', { id: 'p' });
    t.add('C', { id: 'c', parentId: 'p' });
    t.setOverride('p', 'f1', 'r', 5);
    t.activate('c');
    expect(t.resolveActive(masters)[0]!.params.r).toBe(5);
  });

  it('linear chain: suppression inherited unless child un-suppresses', () => {
    const t = new ConfigurationTable();
    t.add('P', { id: 'p' });
    t.add('C', { id: 'c', parentId: 'p' });
    t.setSuppressed('p', 'f2', true);
    t.activate('c');
    expect(t.resolveActive(masters).map(f => f.id)).toEqual(['f1']);
    // Child un-suppresses
    t.setSuppressed('c', 'f2', false);
    expect(t.resolveActive(masters).map(f => f.id)).toEqual(['f1', 'f2']);
  });

  it('grandparent → parent → child override stacking', () => {
    const t = new ConfigurationTable();
    t.add('G', { id: 'g' });
    t.add('P', { id: 'p', parentId: 'g' });
    t.add('C', { id: 'c', parentId: 'p' });
    t.setOverride('g', 'f1', 'r', 2);
    t.setOverride('p', 'f1', 'r', 4);
    t.setOverride('c', 'f2', 'h', 99);
    t.activate('c');
    const r = t.resolveActive(masters);
    expect(r[0]!.params.r).toBe(4);   // parent wins over grandparent
    expect(r[1]!.params.h).toBe(99);  // child contributes h
  });

  it('branching: sibling configs do not see each other', () => {
    const t = new ConfigurationTable();
    t.add('P', { id: 'p' });
    t.add('A', { id: 'a', parentId: 'p' });
    t.add('B', { id: 'b', parentId: 'p' });
    t.setOverride('a', 'f1', 'r', 11);
    t.setOverride('b', 'f1', 'r', 22);
    t.activate('a');
    expect(t.resolveActive(masters)[0]!.params.r).toBe(11);
    t.activate('b');
    expect(t.resolveActive(masters)[0]!.params.r).toBe(22);
  });

  it('no-parent fallback: top-level config sees only master + own overrides', () => {
    const t = new ConfigurationTable();
    t.add('Top', { id: 'top' });
    t.setOverride('top', 'f1', 'r', 99);
    t.activate('top');
    expect(t.resolveActive(masters)[0]!.params.r).toBe(99);
    expect(t.resolveActive(masters)[1]!.params.h).toBe(10);  // master default
  });

  it('parentChain() returns root-first order', () => {
    const t = new ConfigurationTable();
    t.add('G', { id: 'g' });
    t.add('P', { id: 'p', parentId: 'g' });
    t.add('C', { id: 'c', parentId: 'p' });
    expect(t.parentChain('c').map(e => e.id)).toEqual(['g', 'p', 'c']);
  });
});

describe('ConfigurationTable — setParent + cycle detection', () => {
  it('setParent: simple reparent succeeds', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    expect(t.setParent('b', 'a')).toEqual({ ok: true });
    expect(t.get('b')!.parentId).toBe('a');
  });

  it('setParent(null) detaches', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b', parentId: 'a' });
    expect(t.setParent('b', null)).toEqual({ ok: true });
    expect(t.get('b')!.parentId).toBeUndefined();
  });

  it('setParent: unknown_config error', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    const r = t.setParent('missing', 'a');
    expect(r).toEqual({ ok: false, error: 'unknown_config' });
  });

  it('setParent: unknown_parent error', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    const r = t.setParent('a', 'missing');
    expect(r).toEqual({ ok: false, error: 'unknown_parent' });
  });

  it('setParent: self-loop refused with cycle path', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    const r = t.setParent('a', 'a');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('cycle');
      expect(r.cyclePath).toEqual(['a', 'a']);
    }
  });

  it('setParent: A→B then B→A refused as cycle', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    t.setParent('a', 'b');
    const r = t.setParent('b', 'a');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('cycle');
      // Path mentions both ids
      expect(r.cyclePath).toContain('a');
      expect(r.cyclePath).toContain('b');
    }
  });

  it('setParent: 3-cycle (A→B→C→A) refused', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b' });
    t.add('C', { id: 'c' });
    t.setParent('b', 'a');  // b → a
    t.setParent('c', 'b');  // c → b
    const r = t.setParent('a', 'c');  // would close cycle a → c → b → a
    expect(r.ok).toBe(false);
  });

  it('setParent: refused cycle leaves parentId unchanged', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b', parentId: 'a' });
    t.setParent('a', 'b');  // would cycle
    expect(t.get('a')!.parentId).toBeUndefined();  // unchanged
  });
});

describe('ConfigurationTable — global / expression vars', () => {
  it('setGlobalVar + getGlobalVars round-trip', () => {
    const t = new ConfigurationTable();
    t.setGlobalVar('bolt_d', 4);
    t.setGlobalVar('thickness', 'bolt_d * 2');
    expect(t.getGlobalVars()).toEqual({ bolt_d: 4, thickness: 'bolt_d * 2' });
  });

  it('setExpressionVar stores per-config', () => {
    const t = new ConfigurationTable();
    t.add('S', { id: 's' });
    expect(t.setExpressionVar('s', 'local_d', 5)).toBe(true);
    expect(t.get('s')!.expressionVars).toEqual({ local_d: 5 });
  });

  it('setExpressionVar returns false for unknown config', () => {
    const t = new ConfigurationTable();
    expect(t.setExpressionVar('nope', 'x', 1)).toBe(false);
  });
});

describe('ConfigurationTable — JSON round-trip', () => {
  it('toJSON + fromJSON preserves entries, active, globalVars', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.add('B', { id: 'b', parentId: 'a' });
    t.setOverride('b', 'f1', 'r', 5);
    t.setSuppressed('b', 'f2', true);
    t.setGlobalVar('bolt_d', 4);
    t.activate('b');

    const snap = t.toJSON();
    const restored = ConfigurationTable.fromJSON(snap);

    expect(restored.list().length).toBe(2);
    expect(restored.getActiveId()).toBe('b');
    expect(restored.get('b')!.parentId).toBe('a');
    expect(restored.getOverride('b', 'f1')).toEqual({ params: { r: 5 } });
    expect(restored.getOverride('b', 'f2')).toEqual({ suppressed: true });
    expect(restored.getGlobalVars()).toEqual({ bolt_d: 4 });
  });

  it('fromJSON drops dangling parentId references defensively', () => {
    const t = ConfigurationTable.fromJSON({
      configs: [
        { id: 'a', name: 'A', parentId: 'missing', overrides: {}, expressionVars: {} },
      ],
      activeConfigId: null,
      globalVars: {},
    });
    expect(t.get('a')!.parentId).toBeUndefined();
  });

  it('fromJSON clamps activeConfigId to a present entry (else null)', () => {
    const t = ConfigurationTable.fromJSON({
      configs: [{ id: 'a', name: 'A', overrides: {}, expressionVars: {} }],
      activeConfigId: 'missing',
      globalVars: {},
    });
    expect(t.getActiveId()).toBeNull();
  });
});
