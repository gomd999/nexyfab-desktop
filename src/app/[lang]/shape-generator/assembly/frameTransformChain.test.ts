import { describe, it, expect } from 'vitest';
import {
  createRegistry,
  addFrame,
  computeWorldMatrices,
  identityMatrix,
  translationMatrix,
  rotationMatrixZ,
  matrixMultiply,
  invertRigidTransform,
  applyMatrix,
  relativeTransform,
  getChildren,
  ancestorChain,
  summarize,
  type Frame,
} from './frameTransformChain';

describe('createRegistry', () => {
  it('empty input → empty registry', () => {
    const r = createRegistry([]);
    expect(r.frames.size).toBe(0);
  });

  it('populates from list', () => {
    const r = createRegistry([
      { id: 'A', parentId: null, localMatrix: identityMatrix() },
      { id: 'B', parentId: 'A', localMatrix: identityMatrix() },
    ]);
    expect(r.frames.size).toBe(2);
  });
});

describe('addFrame', () => {
  it('adds to registry', () => {
    const r = createRegistry([]);
    addFrame(r, { id: 'X', parentId: null, localMatrix: identityMatrix() });
    expect(r.frames.has('X')).toBe(true);
  });
});

describe('computeWorldMatrices', () => {
  it('root frame world = local', () => {
    const r = createRegistry([
      { id: 'A', parentId: null, localMatrix: translationMatrix({ x: 10, y: 0, z: 0 }) },
    ]);
    const result = computeWorldMatrices(r);
    expect(result.matrices.get('A')![3]).toBe(10);
  });

  it('child world composes with parent', () => {
    const r = createRegistry([
      { id: 'A', parentId: null, localMatrix: translationMatrix({ x: 10, y: 0, z: 0 }) },
      { id: 'B', parentId: 'A', localMatrix: translationMatrix({ x: 5, y: 0, z: 0 }) },
    ]);
    const result = computeWorldMatrices(r);
    expect(result.matrices.get('B')![3]).toBe(15);
  });

  it('detects cycles', () => {
    const r = createRegistry([
      { id: 'A', parentId: 'B', localMatrix: identityMatrix() },
      { id: 'B', parentId: 'A', localMatrix: identityMatrix() },
    ]);
    const result = computeWorldMatrices(r);
    expect(result.cycles.length).toBeGreaterThan(0);
  });

  it('three-level hierarchy', () => {
    const r = createRegistry([
      { id: 'A', parentId: null, localMatrix: translationMatrix({ x: 10, y: 0, z: 0 }) },
      { id: 'B', parentId: 'A', localMatrix: translationMatrix({ x: 0, y: 5, z: 0 }) },
      { id: 'C', parentId: 'B', localMatrix: translationMatrix({ x: 0, y: 0, z: 3 }) },
    ]);
    const result = computeWorldMatrices(r);
    const cWorld = result.matrices.get('C')!;
    expect(cWorld[3]).toBe(10);
    expect(cWorld[7]).toBe(5);
    expect(cWorld[11]).toBe(3);
  });
});

describe('matrix helpers', () => {
  it('identity × any = any', () => {
    const t = translationMatrix({ x: 1, y: 2, z: 3 });
    expect(matrixMultiply(identityMatrix(), t)).toEqual(t);
  });

  it('translation × translation = sum', () => {
    const t1 = translationMatrix({ x: 1, y: 0, z: 0 });
    const t2 = translationMatrix({ x: 2, y: 0, z: 0 });
    const composed = matrixMultiply(t1, t2);
    expect(composed[3]).toBe(3);
  });

  it('rotation Z(180) negates X and Y', () => {
    const r = rotationMatrixZ(Math.PI);
    const p = applyMatrix(r, { x: 1, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(-1, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('inverse of translation is negation', () => {
    const t = translationMatrix({ x: 5, y: 0, z: 0 });
    const inv = invertRigidTransform(t);
    expect(inv[3]).toBe(-5);
  });

  it('applyMatrix to origin returns translation', () => {
    const t = translationMatrix({ x: 1, y: 2, z: 3 });
    const p = applyMatrix(t, { x: 0, y: 0, z: 0 });
    expect(p).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('relativeTransform', () => {
  it('A → A is identity-like', () => {
    const r = createRegistry([
      { id: 'A', parentId: null, localMatrix: translationMatrix({ x: 5, y: 0, z: 0 }) },
    ]);
    const t = relativeTransform(r, 'A', 'A');
    expect(t).not.toBeNull();
    const p = applyMatrix(t!, { x: 0, y: 0, z: 0 });
    expect(Math.abs(p.x)).toBeLessThan(1e-9);
  });

  it('null for unknown ids', () => {
    const r = createRegistry([]);
    expect(relativeTransform(r, 'A', 'B')).toBeNull();
  });
});

describe('getChildren', () => {
  it('finds direct children only', () => {
    const r = createRegistry([
      { id: 'A', parentId: null, localMatrix: identityMatrix() },
      { id: 'B', parentId: 'A', localMatrix: identityMatrix() },
      { id: 'C', parentId: 'A', localMatrix: identityMatrix() },
    ]);
    const kids = getChildren(r, 'A');
    expect(kids.map(k => k.id).sort()).toEqual(['B', 'C']);
  });
});

describe('ancestorChain', () => {
  it('walks up to root', () => {
    const r = createRegistry([
      { id: 'A', parentId: null, localMatrix: identityMatrix() },
      { id: 'B', parentId: 'A', localMatrix: identityMatrix() },
      { id: 'C', parentId: 'B', localMatrix: identityMatrix() },
    ]);
    const chain = ancestorChain(r, 'C').map(f => f.id);
    expect(chain).toEqual(['C', 'B', 'A']);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = createRegistry([
      { id: 'A', parentId: null, localMatrix: identityMatrix() },
      { id: 'B', parentId: 'A', localMatrix: identityMatrix() },
    ]);
    const s = summarize(r);
    expect(s.frameCount).toBe(2);
    expect(s.rootCount).toBe(1);
  });

  it('detects cycles', () => {
    const r = createRegistry([
      { id: 'A', parentId: 'B', localMatrix: identityMatrix() },
      { id: 'B', parentId: 'A', localMatrix: identityMatrix() },
    ]);
    expect(summarize(r).hasCycles).toBe(true);
  });

  it('reports max depth', () => {
    const r = createRegistry([
      { id: 'A', parentId: null, localMatrix: identityMatrix() },
      { id: 'B', parentId: 'A', localMatrix: identityMatrix() },
      { id: 'C', parentId: 'B', localMatrix: identityMatrix() },
    ]);
    expect(summarize(r).maxDepth).toBe(3);
  });
});
