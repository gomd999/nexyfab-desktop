import { describe, it, expect } from 'vitest';
import {
  computeWorldTransforms,
  applyLocalTransformDelta,
  multiplyMat4,
  identityMatrix,
  type AssemblyTree,
  type AssemblyNode,
} from './subAssemblyMotion';

function tree(nodes: AssemblyNode[]): AssemblyTree {
  const map = new Map<string, AssemblyNode>();
  for (const n of nodes) map.set(n.id, n);
  return { rootId: nodes[0]!.id, nodes: map };
}

function translation(x: number, y: number, z: number): number[] {
  return [1, 0, 0, x,  0, 1, 0, y,  0, 0, 1, z,  0, 0, 0, 1];
}

describe('multiplyMat4', () => {
  it('identity × identity = identity', () => {
    const r = multiplyMat4(identityMatrix(), identityMatrix());
    expect(r).toEqual(identityMatrix());
  });

  it('translation composes', () => {
    const r = multiplyMat4(translation(10, 0, 0), translation(0, 20, 0));
    expect(r[3]).toBe(10);
    expect(r[7]).toBe(20);
  });
});

describe('computeWorldTransforms', () => {
  it('single root has identity world transform', () => {
    const t = tree([{ id: 'root', localTransform: identityMatrix(), childIds: [], componentRef: 'a' }]);
    const r = computeWorldTransforms(t);
    expect(r.worldTransforms.get('root')).toEqual(identityMatrix());
    expect(r.depths.get('root')).toBe(0);
  });

  it('child world = parent × child local', () => {
    const t = tree([
      { id: 'root', localTransform: translation(10, 0, 0), childIds: ['child'], componentRef: 'a' },
      { id: 'child', localTransform: translation(0, 20, 0), childIds: [], componentRef: 'b' },
    ]);
    const r = computeWorldTransforms(t);
    const childWorld = r.worldTransforms.get('child')!;
    expect(childWorld[3]).toBe(10);  // x offset from root
    expect(childWorld[7]).toBe(20);  // y offset from child local
  });

  it('depths increase down the tree', () => {
    const t = tree([
      { id: 'a', localTransform: identityMatrix(), childIds: ['b'], componentRef: 'a' },
      { id: 'b', localTransform: identityMatrix(), childIds: ['c'], componentRef: 'b' },
      { id: 'c', localTransform: identityMatrix(), childIds: [], componentRef: 'c' },
    ]);
    const r = computeWorldTransforms(t);
    expect(r.depths.get('a')).toBe(0);
    expect(r.depths.get('b')).toBe(1);
    expect(r.depths.get('c')).toBe(2);
  });

  it('detects cycles', () => {
    const t = tree([
      { id: 'a', localTransform: identityMatrix(), childIds: ['b'], componentRef: 'a' },
      { id: 'b', localTransform: identityMatrix(), childIds: ['a'], componentRef: 'b' },
    ]);
    const r = computeWorldTransforms(t);
    expect(r.cycleDetected).not.toBeNull();
  });
});

describe('applyLocalTransformDelta', () => {
  it('returns the subtree affected by a local change', () => {
    const t = tree([
      { id: 'root', localTransform: identityMatrix(), childIds: ['a', 'b'], componentRef: 'r' },
      { id: 'a', localTransform: identityMatrix(), childIds: ['c'], componentRef: 'a' },
      { id: 'b', localTransform: identityMatrix(), childIds: [], componentRef: 'b' },
      { id: 'c', localTransform: identityMatrix(), childIds: [], componentRef: 'c' },
    ]);
    const affected = applyLocalTransformDelta(t, 'a', translation(5, 0, 0));
    expect(new Set(affected)).toEqual(new Set(['a', 'c']));
  });

  it('returns empty array for unknown node', () => {
    const t = tree([{ id: 'root', localTransform: identityMatrix(), childIds: [], componentRef: 'r' }]);
    expect(applyLocalTransformDelta(t, 'ghost', identityMatrix())).toEqual([]);
  });
});
