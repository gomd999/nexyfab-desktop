/**
 * nonManifoldEdgeDetector.ts — Identify non-manifold edges in a
 * triangle mesh.
 *
 * In a manifold (water-tight) mesh, each edge is shared by exactly
 * two triangles. Non-manifold edges:
 *
 *   - Edge shared by ≥ 3 triangles → "T-junction" / non-manifold.
 *   - Edge shared by 1 triangle (boundary) → ok for open meshes,
 *     bad for solid bodies expected to be water-tight.
 *
 * Non-manifold edges break boolean ops, FEA meshers, 3D printing,
 * slicing, STL exporters.
 *
 * Module:
 *   - Builds an edge incidence map.
 *   - Classifies each edge by number of incident faces.
 *   - Returns the non-manifold and boundary edges + suggested fix
 *     (delete duplicate face / fill boundary).
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Triangle {
  id: string;
  v0: number;
  v1: number;
  v2: number;
}

export interface MeshData {
  vertices: Vec3[];
  triangles: Triangle[];
}

export type EdgeClass = 'manifold' | 'boundary' | 'non-manifold';

export interface EdgeRecord {
  /** Smaller-index vertex first. */
  v0: number;
  v1: number;
  triangleIds: string[];
  classification: EdgeClass;
}

export interface DetectionResult {
  edges: EdgeRecord[];
  manifoldCount: number;
  boundaryCount: number;
  nonManifoldCount: number;
  /** Whether the mesh is fully manifold (no boundary, no non-manifold). */
  isClosed: boolean;
}

// ── Top-level entry ────────────────────────────────────────────

export function detectNonManifoldEdges(mesh: MeshData): DetectionResult {
  const map = new Map<string, { v0: number; v1: number; tris: string[] }>();
  for (const tri of mesh.triangles) {
    addEdge(map, tri.v0, tri.v1, tri.id);
    addEdge(map, tri.v1, tri.v2, tri.id);
    addEdge(map, tri.v2, tri.v0, tri.id);
  }

  const edges: EdgeRecord[] = [];
  let manifold = 0;
  let boundary = 0;
  let nonManifold = 0;

  for (const rec of map.values()) {
    let cls: EdgeClass;
    if (rec.tris.length === 2) {
      cls = 'manifold';
      manifold++;
    } else if (rec.tris.length === 1) {
      cls = 'boundary';
      boundary++;
    } else {
      cls = 'non-manifold';
      nonManifold++;
    }
    edges.push({ v0: rec.v0, v1: rec.v1, triangleIds: rec.tris, classification: cls });
  }

  return {
    edges,
    manifoldCount: manifold,
    boundaryCount: boundary,
    nonManifoldCount: nonManifold,
    isClosed: boundary === 0 && nonManifold === 0,
  };
}

function addEdge(map: Map<string, { v0: number; v1: number; tris: string[] }>, a: number, b: number, triId: string): void {
  const v0 = Math.min(a, b);
  const v1 = Math.max(a, b);
  const key = `${v0}_${v1}`;
  let rec = map.get(key);
  if (!rec) {
    rec = { v0, v1, tris: [] };
    map.set(key, rec);
  }
  rec.tris.push(triId);
}

// ── Fix suggestions ───────────────────────────────────────────

export type FixAction = 'delete-duplicate-face' | 'fill-boundary' | 'no-action';

export interface FixSuggestion {
  edgeKey: string;
  classification: EdgeClass;
  action: FixAction;
  rationale: string;
}

export function suggestFixes(result: DetectionResult): FixSuggestion[] {
  const out: FixSuggestion[] = [];
  for (const e of result.edges) {
    if (e.classification === 'manifold') continue;
    const key = `${e.v0}_${e.v1}`;
    if (e.classification === 'non-manifold') {
      out.push({
        edgeKey: key,
        classification: 'non-manifold',
        action: 'delete-duplicate-face',
        rationale: `Edge shared by ${e.triangleIds.length} triangles; expected 2. Delete extras.`,
      });
    } else if (e.classification === 'boundary') {
      out.push({
        edgeKey: key,
        classification: 'boundary',
        action: 'fill-boundary',
        rationale: `Open edge; fill to close mesh.`,
      });
    }
  }
  return out;
}

// ── Boundary loop extraction ──────────────────────────────────

export function extractBoundaryLoops(result: DetectionResult): number[][] {
  const boundaries = result.edges.filter(e => e.classification === 'boundary');
  const adjacency = new Map<number, number[]>();
  for (const e of boundaries) {
    if (!adjacency.has(e.v0)) adjacency.set(e.v0, []);
    if (!adjacency.has(e.v1)) adjacency.set(e.v1, []);
    adjacency.get(e.v0)!.push(e.v1);
    adjacency.get(e.v1)!.push(e.v0);
  }
  const visited = new Set<number>();
  const loops: number[][] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [start];
    visited.add(start);
    let cur = start;
    while (true) {
      const neighbors = (adjacency.get(cur) ?? []).filter(n => !visited.has(n));
      if (neighbors.length === 0) break;
      const next = neighbors[0]!;
      visited.add(next);
      loop.push(next);
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// ── Summary ────────────────────────────────────────────────────

export interface NonManifoldSummary {
  totalEdges: number;
  manifoldFraction: number;
  isClosed: boolean;
  boundaryLoopCount: number;
  nonManifoldCount: number;
}

export function summarize(result: DetectionResult): NonManifoldSummary {
  const total = result.edges.length;
  return {
    totalEdges: total,
    manifoldFraction: total === 0 ? 1 : result.manifoldCount / total,
    isClosed: result.isClosed,
    boundaryLoopCount: extractBoundaryLoops(result).length,
    nonManifoldCount: result.nonManifoldCount,
  };
}
