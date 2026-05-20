import { describe, it, expect } from 'vitest';
import {
  buildSkeleton,
  computeWorldTransforms,
  captureInverseBindMatrices,
  normalizeInfluences,
  skinLinearBlend,
  skinDualQuaternion,
  identityMat4,
  multiplyMat4,
  inverseMat4,
  mat4ToDualQuaternion,
  type Bone,
  type SkinnedMesh,
  type SkinnedVertex,
} from './meshSkinning';

function rootBone(id: string): Bone {
  return { id, parentId: null, localTransform: identityMat4() };
}

function translateMat(x: number, y: number, z: number): number[] {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

describe('buildSkeleton', () => {
  it('indexes bones by id', () => {
    const sk = buildSkeleton([rootBone('a'), rootBone('b')]);
    expect(sk.boneIndex.get('a')).toBe(0);
    expect(sk.boneIndex.get('b')).toBe(1);
  });
});

describe('computeWorldTransforms', () => {
  it('root bone world = local', () => {
    const sk = buildSkeleton([{ id: 'r', parentId: null, localTransform: translateMat(5, 0, 0) }]);
    const w = computeWorldTransforms(sk);
    expect(w[0]![3]).toBe(5);
  });

  it('child accumulates parent transform', () => {
    const sk = buildSkeleton([
      { id: 'root', parentId: null, localTransform: translateMat(5, 0, 0) },
      { id: 'child', parentId: 'root', localTransform: translateMat(3, 0, 0) },
    ]);
    const w = computeWorldTransforms(sk);
    expect(w[1]![3]).toBe(8);
  });
});

describe('captureInverseBindMatrices', () => {
  it('every bone gets an inverse bind matrix', () => {
    const sk = buildSkeleton([rootBone('a'), rootBone('b')]);
    captureInverseBindMatrices(sk);
    expect(sk.bones[0]!.inverseBindMatrix).toBeDefined();
    expect(sk.bones[1]!.inverseBindMatrix).toBeDefined();
  });
});

describe('normalizeInfluences', () => {
  it('weights sum to 1', () => {
    const v: SkinnedVertex[] = [{ boneIndices: [0, 1], weights: [3, 1] }];
    normalizeInfluences(v);
    const sum = v[0]!.weights.reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('truncates above maxInfluences', () => {
    const v: SkinnedVertex[] = [{ boneIndices: [0, 1, 2, 3, 4], weights: [0.1, 0.2, 0.3, 0.3, 0.1] }];
    normalizeInfluences(v, 3);
    expect(v[0]!.boneIndices).toHaveLength(3);
  });

  it('biggest weights kept', () => {
    const v: SkinnedVertex[] = [{ boneIndices: [0, 1, 2], weights: [0.1, 0.7, 0.2] }];
    normalizeInfluences(v, 2);
    expect(v[0]!.boneIndices).toContain(1);
  });
});

describe('matrix helpers', () => {
  it('identity4 is correct', () => {
    const id = identityMat4();
    expect(id[0]).toBe(1);
    expect(id[5]).toBe(1);
    expect(id[10]).toBe(1);
    expect(id[15]).toBe(1);
  });

  it('multiply by identity = same', () => {
    const m = translateMat(3, 4, 5);
    const r = multiplyMat4(m, identityMat4());
    expect(r).toEqual(m);
  });

  it('inverse × matrix = identity', () => {
    const m = translateMat(3, 4, 5);
    const inv = inverseMat4(m);
    const prod = multiplyMat4(m, inv);
    expect(prod[0]).toBeCloseTo(1, 5);
    expect(prod[3]).toBeCloseTo(0, 5);
  });
});

describe('skinLinearBlend', () => {
  function singleBoneMesh(): SkinnedMesh {
    const skeleton = buildSkeleton([rootBone('root')]);
    captureInverseBindMatrices(skeleton);
    return {
      positionsBind: [1, 2, 3],
      indices: [],
      influences: [{ boneIndices: [0], weights: [1] }],
      skeleton,
    };
  }

  it('identity skeleton leaves verts unchanged', () => {
    const mesh = singleBoneMesh();
    const out = skinLinearBlend(mesh);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(2, 5);
    expect(out[2]).toBeCloseTo(3, 5);
  });

  it('translated bone moves vert', () => {
    const mesh = singleBoneMesh();
    mesh.skeleton.bones[0]!.localTransform = translateMat(10, 0, 0);
    const out = skinLinearBlend(mesh);
    expect(out[0]).toBeCloseTo(11, 5);
  });

  it('vertex with no influence stays at bind pose', () => {
    const skeleton = buildSkeleton([rootBone('root')]);
    captureInverseBindMatrices(skeleton);
    skeleton.bones[0]!.localTransform = translateMat(10, 0, 0);
    const mesh: SkinnedMesh = {
      positionsBind: [7, 8, 9],
      indices: [],
      influences: [{ boneIndices: [], weights: [] }],
      skeleton,
    };
    const out = skinLinearBlend(mesh);
    expect(out[0]).toBe(7);
  });
});

describe('skinDualQuaternion', () => {
  it('produces vertex output of correct length', () => {
    const skeleton = buildSkeleton([rootBone('root')]);
    captureInverseBindMatrices(skeleton);
    const mesh: SkinnedMesh = {
      positionsBind: [1, 2, 3, 4, 5, 6],
      indices: [],
      influences: [
        { boneIndices: [0], weights: [1] },
        { boneIndices: [0], weights: [1] },
      ],
      skeleton,
    };
    const out = skinDualQuaternion(mesh);
    expect(out).toHaveLength(6);
  });
});

describe('mat4ToDualQuaternion', () => {
  it('identity maps to (0,0,0,1) real', () => {
    const dq = mat4ToDualQuaternion(identityMat4());
    expect(dq.real[3]).toBeCloseTo(1, 5);
  });
});
