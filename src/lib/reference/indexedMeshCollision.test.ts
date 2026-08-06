import { describe, expect, it } from 'vitest';
import { verifyIndexedMeshCollision, type IndexedCollisionMesh } from './indexedMeshCollision';
const open = (id: string, z: number): IndexedCollisionMesh => ({ id, verts: [[0, 0, z], [10, 0, z], [0, 10, z]], faces: [[0, 1, 2]] });
const tetra = (id: string, offset = 0, scale = 1): IndexedCollisionMesh => ({ id, verts: [[offset, offset, offset], [offset + 10 * scale, offset, offset], [offset, offset + 10 * scale, offset], [offset, offset, offset + 10 * scale]], faces: [[1, 2, 3], [0, 2, 1], [0, 1, 3], [0, 3, 2]] });
describe('indexed mesh collision evidence', () => {
  it('confirms an open-surface triangle intersection', () => expect(verifyIndexedMeshCollision(open('a', 0), { id: 'b', verts: [[2, 2, -1], [2, 2, 1], [8, 2, 0]], faces: [[0, 1, 2]] })).toMatchObject({ status: 'fail', intersects: true, mode: 'surface_intersection' }));
  it('does not clear separated open surfaces', () => expect(verifyIndexedMeshCollision(open('a', 0), open('b', 5))).toMatchObject({ status: 'not_run', intersects: null, reason: 'open_mesh_cannot_clear_containment' }));
  it('clears separated closed meshes with containment tested', () => expect(verifyIndexedMeshCollision(tetra('a'), tetra('b', 30))).toMatchObject({ status: 'pass', intersects: false, containmentTested: true }));
  it('detects closed-mesh containment', () => expect(verifyIndexedMeshCollision(tetra('outer', 0, 3), tetra('inner', 1, 0.1))).toMatchObject({ status: 'fail', intersects: true, reason: 'closed_mesh_containment' }));
  it('fails closed on an exhausted pair budget', () => { const a = { ...open('a', 0), faces: [[0, 1, 2], [0, 1, 2]] }, b: IndexedCollisionMesh = { id: 'b', verts: [[10, 10, 0], [10, 6, 0], [6, 10, 0]], faces: [[0, 1, 2], [0, 1, 2]] }; expect(verifyIndexedMeshCollision(a, b, 1)).toMatchObject({ status: 'not_run', mode: 'budget_exhausted' }); });
});
