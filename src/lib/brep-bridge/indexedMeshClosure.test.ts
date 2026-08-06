import { describe, expect, it } from 'vitest';
import { analyzeIndexedMeshClosure, classifyIndexedMeshBoundaries, repairIndexedMeshDegenerateFaces } from './indexedMeshClosure';

const verts = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
const tetra = [[1, 2, 3], [0, 2, 1], [0, 1, 3], [0, 3, 2]];
describe('indexed mesh closure', () => {
  it('accepts an oriented watertight tetrahedron and measures volume', () => expect(analyzeIndexedMeshClosure(verts, tetra)).toMatchObject({ watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, degenerateFaces: 0, volumeMm3: 1000 / 6 }));
  it('reports boundary edges on an open tetrahedron', () => expect(analyzeIndexedMeshClosure(verts, tetra.slice(0, 3))).toMatchObject({ watertight: false, boundaryEdges: 3, volumeMm3: 0 }));
  it('rejects inconsistent shared-edge orientation', () => expect(analyzeIndexedMeshClosure(verts, [[1, 2, 3], [0, 1, 2], [0, 1, 3], [0, 3, 2]])).toMatchObject({ watertight: false, orientationConsistent: false }));
  it('removes only degenerate faces and preserves a closed tetrahedron', () => expect(repairIndexedMeshDegenerateFaces(verts, [...tetra, [0, 0, 1]])).toMatchObject({ accepted: true, removedFaces: 1, after: { watertight: true, degenerateFaces: 0 } }));
  it('does not invent closure for a boundary hole', () => expect(repairIndexedMeshDegenerateFaces(verts, [...tetra.slice(0, 3), [0, 0, 1]])).toMatchObject({ accepted: true, removedFaces: 1, after: { watertight: false, boundaryEdges: 3 } }));
  it('classifies a missing tetrahedron face as one planar closed loop', () => expect(classifyIndexedMeshBoundaries(verts, tetra.slice(0, 3))).toMatchObject({ components: 1, closedLoops: 1, openChains: 0, branchedComponents: 0, planarClosedLoops: 1 }));
  it('rejects invalid sewing tolerances', () => expect(() => classifyIndexedMeshBoundaries(verts, tetra, 0)).toThrow('invalid_sewing_tolerance'));
});
