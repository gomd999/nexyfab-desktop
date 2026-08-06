import { pointInMesh, trianglesIntersect, type Tri } from '../ai/design-driver/interferencePrecise';
import { analyzeIndexedMeshClosure } from '../brep-bridge/indexedMeshClosure';

export interface IndexedCollisionMesh { id: string; verts: number[][]; faces: number[][]; }
export interface IndexedMeshCollisionEvidence { status: 'pass' | 'fail' | 'not_run'; intersects: boolean | null; mode: 'surface_intersection' | 'closed_mesh_complete' | 'budget_exhausted'; trianglePairsTested: number; trianglesA: number; trianglesB: number; containmentTested: boolean; reason: string; }

const triangles = (mesh: IndexedCollisionMesh): Tri[] => mesh.faces.flatMap(face => {
  if (face.length !== 3) return []; const points = face.map(index => mesh.verts[index]); if (points.some(point => !point || point.length < 3 || !point!.slice(0, 3).every(Number.isFinite))) return [];
  const [a, b, c] = points as number[][]; return [{ a: { x: a[0]!, y: a[1]!, z: a[2]! }, b: { x: b[0]!, y: b[1]!, z: b[2]! }, c: { x: c[0]!, y: c[1]!, z: c[2]! } }];
});
const box = (triangle: Tri) => ({ min: [Math.min(triangle.a.x, triangle.b.x, triangle.c.x), Math.min(triangle.a.y, triangle.b.y, triangle.c.y), Math.min(triangle.a.z, triangle.b.z, triangle.c.z)], max: [Math.max(triangle.a.x, triangle.b.x, triangle.c.x), Math.max(triangle.a.y, triangle.b.y, triangle.c.y), Math.max(triangle.a.z, triangle.b.z, triangle.c.z)] });
const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => [0, 1, 2].every(axis => a.min[axis]! <= b.max[axis]! && b.min[axis]! <= a.max[axis]!);
const centroid = (triangle: Tri) => ({ x: (triangle.a.x + triangle.b.x + triangle.c.x) / 3, y: (triangle.a.y + triangle.b.y + triangle.c.y) / 3, z: (triangle.a.z + triangle.b.z + triangle.c.z) / 3 });

export function verifyIndexedMeshCollision(a: IndexedCollisionMesh, b: IndexedCollisionMesh, maxTrianglePairs = 2_000_000): IndexedMeshCollisionEvidence {
  if (!Number.isInteger(maxTrianglePairs) || maxTrianglePairs < 1) throw new Error('invalid_collision_pair_budget');
  const A = triangles(a), B = triangles(b); if (!A.length || !B.length) return { status: 'not_run', intersects: null, mode: 'budget_exhausted', trianglePairsTested: 0, trianglesA: A.length, trianglesB: B.length, containmentTested: false, reason: 'collision_mesh_empty' };
  const boxesA = A.map(box), boxesB = B.map(box); let tested = 0;
  for (let ai = 0; ai < A.length; ai++) for (let bi = 0; bi < B.length; bi++) { if (!overlap(boxesA[ai]!, boxesB[bi]!)) continue; if (++tested > maxTrianglePairs) return { status: 'not_run', intersects: null, mode: 'budget_exhausted', trianglePairsTested: tested - 1, trianglesA: A.length, trianglesB: B.length, containmentTested: false, reason: 'collision_pair_budget_exhausted' }; if (trianglesIntersect(A[ai]!, B[bi]!)) return { status: 'fail', intersects: true, mode: 'surface_intersection', trianglePairsTested: tested, trianglesA: A.length, trianglesB: B.length, containmentTested: false, reason: 'triangle_surface_intersection' }; }
  const closedA = analyzeIndexedMeshClosure(a.verts, a.faces).watertight, closedB = analyzeIndexedMeshClosure(b.verts, b.faces).watertight;
  if (!closedA || !closedB) return { status: 'not_run', intersects: null, mode: 'surface_intersection', trianglePairsTested: tested, trianglesA: A.length, trianglesB: B.length, containmentTested: false, reason: 'open_mesh_cannot_clear_containment' };
  const contained = pointInMesh(centroid(A[0]!), B) || pointInMesh(centroid(B[0]!), A);
  return { status: contained ? 'fail' : 'pass', intersects: contained, mode: 'closed_mesh_complete', trianglePairsTested: tested, trianglesA: A.length, trianglesB: B.length, containmentTested: true, reason: contained ? 'closed_mesh_containment' : 'closed_mesh_separated' };
}
