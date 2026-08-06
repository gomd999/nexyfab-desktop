export interface IndexedMeshClosure {
  watertight: boolean;
  orientationConsistent: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateFaces: number;
  volumeMm3: number;
}
export interface IndexedMeshDegenerateRepair { accepted: boolean; verts: number[][]; faces: number[][]; removedFaces: number; before: IndexedMeshClosure; after: IndexedMeshClosure; }
export interface IndexedMeshBoundaryClassification { components: number; closedLoops: number; openChains: number; branchedComponents: number; planarClosedLoops: number; microGapCandidates: number; totalBoundaryLengthMm: number; maxBoundaryLengthMm: number; sewingToleranceMm: number; }

const validTriangle = (verts: number[][], face: number[]) => {
  if (face.length !== 3 || new Set(face).size !== 3 || face.some(index => !Number.isInteger(index) || index < 0 || index >= verts.length)) return false;
  const [p, q, r] = face.map(index => verts[index]!), cross = [(q![1]! - p![1]!) * (r![2]! - p![2]!) - (q![2]! - p![2]!) * (r![1]! - p![1]!), (q![2]! - p![2]!) * (r![0]! - p![0]!) - (q![0]! - p![0]!) * (r![2]! - p![2]!), (q![0]! - p![0]!) * (r![1]! - p![1]!) - (q![1]! - p![1]!) * (r![0]! - p![0]!)];
  return [p, q, r].every(vertex => vertex!.length >= 3 && vertex!.slice(0, 3).every(Number.isFinite)) && Math.hypot(...cross) > 1e-9;
};

export function analyzeIndexedMeshClosure(verts: number[][], faces: number[][]): IndexedMeshClosure {
  const edges = new Map<string, { count: number; direction: number }>(); let degenerateFaces = 0, volume6 = 0;
  for (const face of faces) {
    if (face.length !== 3 || new Set(face).size !== 3 || face.some(index => !Number.isInteger(index) || index < 0 || index >= verts.length)) { degenerateFaces++; continue; }
    const [a, b, c] = face, p = verts[a!]!, q = verts[b!]!, r = verts[c!]!;
    if ([p, q, r].some(vertex => vertex.length < 3 || !vertex.slice(0, 3).every(Number.isFinite))) { degenerateFaces++; continue; }
    const cross = [(q[1]! - p[1]!) * (r[2]! - p[2]!) - (q[2]! - p[2]!) * (r[1]! - p[1]!), (q[2]! - p[2]!) * (r[0]! - p[0]!) - (q[0]! - p[0]!) * (r[2]! - p[2]!), (q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!)];
    if (Math.hypot(...cross) <= 1e-9) { degenerateFaces++; continue; }
    volume6 += p[0]! * (q[1]! * r[2]! - q[2]! * r[1]!) + p[1]! * (q[2]! * r[0]! - q[0]! * r[2]!) + p[2]! * (q[0]! * r[1]! - q[1]! * r[0]!);
    for (const [from, to] of [[a!, b!], [b!, c!], [c!, a!]]) { const low = Math.min(from, to), high = Math.max(from, to), key = `${low}:${high}`, prior = edges.get(key) ?? { count: 0, direction: 0 }; prior.count++; prior.direction += from === low ? 1 : -1; edges.set(key, prior); }
  }
  const boundaryEdges = [...edges.values()].filter(edge => edge.count === 1).length, nonManifoldEdges = [...edges.values()].filter(edge => edge.count > 2).length, orientationConsistent = [...edges.values()].every(edge => edge.count !== 2 || edge.direction === 0);
  const watertight = faces.length > 0 && degenerateFaces === 0 && boundaryEdges === 0 && nonManifoldEdges === 0 && orientationConsistent;
  return { watertight, orientationConsistent, boundaryEdges, nonManifoldEdges, degenerateFaces, volumeMm3: watertight ? Math.abs(volume6 / 6) : 0 };
}

export function repairIndexedMeshDegenerateFaces(verts: number[][], faces: number[][]): IndexedMeshDegenerateRepair {
  const before = analyzeIndexedMeshClosure(verts, faces), repairedFaces = faces.filter(face => validTriangle(verts, face)), after = analyzeIndexedMeshClosure(verts, repairedFaces), removedFaces = faces.length - repairedFaces.length;
  const accepted = removedFaces > 0 && after.boundaryEdges <= before.boundaryEdges && after.nonManifoldEdges <= before.nonManifoldEdges && after.degenerateFaces === 0;
  return { accepted, verts, faces: accepted ? repairedFaces : faces, removedFaces: accepted ? removedFaces : 0, before, after: accepted ? after : before };
}

export function classifyIndexedMeshBoundaries(verts: number[][], faces: number[][], sewingToleranceMm = 0.01): IndexedMeshBoundaryClassification {
  if (!Number.isFinite(sewingToleranceMm) || sewingToleranceMm <= 0) throw new Error('invalid_sewing_tolerance');
  const counts = new Map<string, { a: number; b: number; count: number }>();
  for (const face of faces.filter(face => validTriangle(verts, face))) for (const [a, b] of [[face[0]!, face[1]!], [face[1]!, face[2]!], [face[2]!, face[0]!]]) { const low = Math.min(a, b), high = Math.max(a, b), key = `${low}:${high}`, item = counts.get(key) ?? { a: low, b: high, count: 0 }; item.count++; counts.set(key, item); }
  const boundary = [...counts.values()].filter(edge => edge.count === 1), adjacency = new Map<number, Set<number>>();
  for (const edge of boundary) { if (!adjacency.has(edge.a)) adjacency.set(edge.a, new Set()); if (!adjacency.has(edge.b)) adjacency.set(edge.b, new Set()); adjacency.get(edge.a)!.add(edge.b); adjacency.get(edge.b)!.add(edge.a); }
  const visited = new Set<number>(); let closedLoops = 0, openChains = 0, branchedComponents = 0, planarClosedLoops = 0, microGapCandidates = 0, totalBoundaryLengthMm = 0, maxBoundaryLengthMm = 0, components = 0;
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue; components++; const pending = [start], vertices: number[] = [];
    while (pending.length) { const id = pending.pop()!; if (visited.has(id)) continue; visited.add(id); vertices.push(id); for (const next of adjacency.get(id) ?? []) if (!visited.has(next)) pending.push(next); }
    const set = new Set(vertices), edges = boundary.filter(edge => set.has(edge.a) && set.has(edge.b)), degrees = vertices.map(id => adjacency.get(id)?.size ?? 0), closed = degrees.every(value => value === 2), chain = degrees.filter(value => value === 1).length === 2 && degrees.every(value => value === 1 || value === 2);
    const length = edges.reduce((sum, edge) => { const a = verts[edge.a]!, b = verts[edge.b]!; return sum + Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!); }, 0); totalBoundaryLengthMm += length; maxBoundaryLengthMm = Math.max(maxBoundaryLengthMm, length);
    if (closed) { closedLoops++; const points = vertices.map(id => verts[id]!); let nx = 0, ny = 0, nz = 0; for (let index = 0; index < points.length; index++) { const p = points[index]!, q = points[(index + 1) % points.length]!; nx += (p[1]! - q[1]!) * (p[2]! + q[2]!); ny += (p[2]! - q[2]!) * (p[0]! + q[0]!); nz += (p[0]! - q[0]!) * (p[1]! + q[1]!); } const norm = Math.hypot(nx, ny, nz), origin = points[0]!, planar = norm > 1e-12 && points.every(point => Math.abs(nx * (point[0]! - origin[0]!) + ny * (point[1]! - origin[1]!) + nz * (point[2]! - origin[2]!)) / norm <= sewingToleranceMm); if (planar) planarClosedLoops++; if (planar && length <= sewingToleranceMm * 8) microGapCandidates++; }
    else if (chain) openChains++; else branchedComponents++;
  }
  return { components, closedLoops, openChains, branchedComponents, planarClosedLoops, microGapCandidates, totalBoundaryLengthMm, maxBoundaryLengthMm, sewingToleranceMm };
}
