/**
 * Z1 — Parametric feature tree tests.
 *
 * Pins the design intent contract:
 *   - adding nodes records parents/params verbatim
 *   - parameter changes mark dirty downstream in topo order
 *   - removing a node orphans children with dirty=true
 *   - topo order respects dependency direction
 */

import { describe, it, expect } from 'vitest';
import {
  createFeatureTree,
  addFeatureNode,
  updateParam,
  markDirtyDownstream,
  topoOrder,
  removeNode,
  findByName,
  summarizeTree,
} from '../featureTree';

describe('featureTree', () => {
  it('starts empty', () => {
    const t = createFeatureTree();
    expect(Object.keys(t.nodes)).toHaveLength(0);
    expect(t.roots).toHaveLength(0);
  });

  it('addFeatureNode marks roots and assigns seq', () => {
    const t = createFeatureTree();
    addFeatureNode(t, { id: 'a', op: 'primitive', params: { r: 5 }, parents: [] });
    addFeatureNode(t, { id: 'b', op: 'fillet', params: { radius: 1 }, parents: ['a'] });
    expect(t.roots).toEqual(['a']);
    expect(t.nodes.a.seq).toBe(0);
    expect(t.nodes.b.seq).toBe(1);
  });

  it('updateParam marks node + all descendants dirty', () => {
    const t = createFeatureTree();
    addFeatureNode(t, { id: 'a', op: 'primitive', params: { r: 5 }, parents: [] });
    addFeatureNode(t, { id: 'b', op: 'fillet', params: { radius: 1 }, parents: ['a'] });
    addFeatureNode(t, { id: 'c', op: 'shell', params: { thickness: 2 }, parents: ['b'] });
    const r = updateParam(t, 'a', 'r', 10);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dirty).toEqual(['a', 'b', 'c']);
      expect(t.nodes.a.dirty).toBe(true);
      expect(t.nodes.b.dirty).toBe(true);
      expect(t.nodes.c.dirty).toBe(true);
    }
  });

  it('updateParam returns error for unknown node', () => {
    const t = createFeatureTree();
    const r = updateParam(t, 'ghost', 'x', 1);
    expect(r.ok).toBe(false);
  });

  it('topoOrder returns parents before children for a diamond graph', () => {
    const t = createFeatureTree();
    addFeatureNode(t, { id: 'a', op: 'primitive', params: {}, parents: [] });
    addFeatureNode(t, { id: 'b', op: 'fillet', params: {}, parents: ['a'] });
    addFeatureNode(t, { id: 'c', op: 'chamfer', params: {}, parents: ['a'] });
    addFeatureNode(t, { id: 'd', op: 'boolean', params: {}, parents: ['b', 'c'] });
    const order = topoOrder(t, ['a', 'b', 'c', 'd']);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  it('removeNode orphans children and flags them dirty', () => {
    const t = createFeatureTree();
    addFeatureNode(t, { id: 'a', op: 'primitive', params: {}, parents: [] });
    addFeatureNode(t, { id: 'b', op: 'fillet', params: {}, parents: ['a'] });
    const newRoots = removeNode(t, 'a');
    expect(newRoots).toContain('b');
    expect(t.nodes.b.parents).toHaveLength(0);
    expect(t.nodes.b.dirty).toBe(true);
  });

  it('findByName resolves user-friendly refs', () => {
    const t = createFeatureTree();
    addFeatureNode(t, { id: 'occt:1', op: 'primitive', params: {}, parents: [], name: 'mount_plate' });
    addFeatureNode(t, { id: 'occt:2', op: 'fillet', params: {}, parents: ['occt:1'] });
    const n = findByName(t, 'mount_plate');
    expect(n?.id).toBe('occt:1');
    expect(findByName(t, 'no_such_name')).toBeNull();
  });

  it('markDirtyDownstream is idempotent (calling twice yields same set)', () => {
    const t = createFeatureTree();
    addFeatureNode(t, { id: 'a', op: 'primitive', params: {}, parents: [] });
    addFeatureNode(t, { id: 'b', op: 'fillet', params: {}, parents: ['a'] });
    const r1 = markDirtyDownstream(t, 'a');
    const r2 = markDirtyDownstream(t, 'a');
    expect(r1.sort()).toEqual(r2.sort());
  });

  it('summarizeTree renders nodes with name and dependency arrows', () => {
    const t = createFeatureTree();
    addFeatureNode(t, { id: 'a', op: 'primitive', params: {}, parents: [], name: 'base' });
    addFeatureNode(t, { id: 'b', op: 'fillet', params: {}, parents: ['a'] });
    const text = summarizeTree(t);
    expect(text).toContain('a "base" : primitive');
    expect(text).toContain('b : fillet ← [a]');
  });

  it('handles disconnected sub-graphs in topoOrder', () => {
    const t = createFeatureTree();
    addFeatureNode(t, { id: 'a', op: 'primitive', params: {}, parents: [] });
    addFeatureNode(t, { id: 'b', op: 'primitive', params: {}, parents: [] });
    addFeatureNode(t, { id: 'a2', op: 'fillet', params: {}, parents: ['a'] });
    addFeatureNode(t, { id: 'b2', op: 'fillet', params: {}, parents: ['b'] });
    const order = topoOrder(t, ['a', 'b', 'a2', 'b2']);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('a2'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('b2'));
  });
});
