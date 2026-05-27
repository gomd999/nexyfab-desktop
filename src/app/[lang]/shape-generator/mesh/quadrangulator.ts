/**
 * quadrangulator.ts — Convert a triangle mesh to a quad-dominant mesh
 * by greedy pairing.
 *
 * Strategy: walk shared edges between adjacent triangles; when a
 * pair forms a near-coplanar, near-rectangular quad, merge them.
 *
 * Quad-dominant meshes are preferred for:
 *   - FEA (better element shape quality).
 *   - Subdivision-surface modelling.
 *   - Rendering (lower triangle count).
 *
 * Module:
 *   - Triangle pair scoring (coplanarity + aspect ratio).
 *   - Greedy pair selection.
 *   - Returns the new quad list + remaining un-paired triangles.
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

export interface Quad {
  id: string;
  v0: number;
  v1: number;
  v2: number;
  v3: number;
}

export interface QuadrangulateOptions {
  /** Maximum dihedral angle for coplanarity (deg). */
  maxDihedralDeg: number;
  /** Minimum corner angle ratio (smallest / largest). */
  minAngleRatio: number;
}

export const DEFAULT_OPTIONS: QuadrangulateOptions = {
  maxDihedralDeg: 5,
  minAngleRatio: 0.3,
};

export interface QuadrangulateResult {
  quads: Quad[];
  remainingTriangles: Triangle[];
  pairCount: number;
  coverage: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function quadrangulate(mesh: MeshData, options: Partial<QuadrangulateOptions> = {}): QuadrangulateResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const edgeMap = new Map<string, string[]>();
  for (const t of mesh.triangles) {
    for (const [a, b] of [[t.v0, t.v1], [t.v1, t.v2], [t.v2, t.v0]] as [number, number][]) {
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key)!.push(t.id);
    }
  }

  const remaining = new Set(mesh.triangles.map(t => t.id));
  const quads: Quad[] = [];
  let counter = 0;
  for (const [edge, tris] of edgeMap) {
    if (tris.length !== 2) continue;
    const [aId, bId] = tris as [string, string];
    if (!remaining.has(aId) || !remaining.has(bId)) continue;
    const ta = mesh.triangles.find(t => t.id === aId)!;
    const tb = mesh.triangles.find(t => t.id === bId)!;
    const score = pairScore(ta, tb, mesh.vertices, opts);
    if (!score.acceptable) continue;
    const quad = buildQuad(ta, tb, edge, mesh.vertices, counter++);
    if (!quad) continue;
    quads.push(quad);
    remaining.delete(aId);
    remaining.delete(bId);
  }

  const remainingTriangles = mesh.triangles.filter(t => remaining.has(t.id));
  const coverage = mesh.triangles.length === 0 ? 0 : (mesh.triangles.length - remaining.size) / mesh.triangles.length;
  return { quads, remainingTriangles, pairCount: quads.length, coverage };
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// ── Pair score ────────────────────────────────────────────────

interface PairScore {
  dihedralDeg: number;
  angleRatio: number;
  acceptable: boolean;
}

function pairScore(a: Triangle, b: Triangle, vertices: Vec3[], opts: QuadrangulateOptions): PairScore {
  const va0 = vertices[a.v0]!, va1 = vertices[a.v1]!, va2 = vertices[a.v2]!;
  const vb0 = vertices[b.v0]!, vb1 = vertices[b.v1]!, vb2 = vertices[b.v2]!;
  const na = normalize(cross(sub(va1, va0), sub(va2, va0)));
  const nb = normalize(cross(sub(vb1, vb0), sub(vb2, vb0)));
  const dot = na.x * nb.x + na.y * nb.y + na.z * nb.z;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
  const ratio = quadAngleRatio(a, b, vertices);
  return {
    dihedralDeg: angle,
    angleRatio: ratio,
    acceptable: angle <= opts.maxDihedralDeg && ratio >= opts.minAngleRatio,
  };
}

function quadAngleRatio(a: Triangle, b: Triangle, vertices: Vec3[]): number {
  // Compute interior angles of the formed quad approximately.
  const angles = [
    triCornerAngle(vertices[a.v0]!, vertices[a.v1]!, vertices[a.v2]!),
    triCornerAngle(vertices[a.v1]!, vertices[a.v2]!, vertices[a.v0]!),
    triCornerAngle(vertices[b.v0]!, vertices[b.v1]!, vertices[b.v2]!),
    triCornerAngle(vertices[b.v1]!, vertices[b.v2]!, vertices[b.v0]!),
  ];
  const min = Math.min(...angles);
  const max = Math.max(...angles);
  return max === 0 ? 0 : min / max;
}

function triCornerAngle(p: Vec3, a: Vec3, b: Vec3): number {
  const v1 = sub(a, p);
  const v2 = sub(b, p);
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const len = norm(v1) * norm(v2);
  if (len === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / len)));
}

// ── Build quad from shared edge ──────────────────────────────

function buildQuad(a: Triangle, b: Triangle, sharedEdge: string, _vertices: Vec3[], idx: number): Quad | null {
  const aVerts = [a.v0, a.v1, a.v2];
  const bVerts = [b.v0, b.v1, b.v2];
  const sharedNodes = aVerts.filter(v => bVerts.includes(v));
  if (sharedNodes.length !== 2) return null;
  const aUnique = aVerts.find(v => !sharedNodes.includes(v))!;
  const bUnique = bVerts.find(v => !sharedNodes.includes(v))!;
  const [s0, s1] = sharedNodes as [number, number];
  return {
    id: `quad-${idx}-${sharedEdge}`,
    v0: aUnique,
    v1: s0,
    v2: bUnique,
    v3: s1,
  };
}

// ── Vector ───────────────────────────────────────────────────

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(v: Vec3): number { return Math.hypot(v.x, v.y, v.z); }
function normalize(v: Vec3): Vec3 {
  const n = norm(v);
  if (n === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

// ── Quality metrics ──────────────────────────────────────────

export interface QualityReport {
  meanQuadAspect: number;
  worstQuadAspect: number;
  trianglesRemaining: number;
}

export function qualityReport(result: QuadrangulateResult, vertices: Vec3[]): QualityReport {
  let mean = 0;
  let worst = 0;
  for (const q of result.quads) {
    const lens = [
      distance(vertices[q.v0]!, vertices[q.v1]!),
      distance(vertices[q.v1]!, vertices[q.v2]!),
      distance(vertices[q.v2]!, vertices[q.v3]!),
      distance(vertices[q.v3]!, vertices[q.v0]!),
    ];
    const ratio = Math.max(...lens) / Math.max(0.001, Math.min(...lens));
    mean += ratio;
    if (ratio > worst) worst = ratio;
  }
  return {
    meanQuadAspect: result.quads.length === 0 ? 0 : mean / result.quads.length,
    worstQuadAspect: worst,
    trianglesRemaining: result.remainingTriangles.length,
  };
}

function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

// ── Summary ────────────────────────────────────────────────────

export interface QuadrangulateSummary {
  inputTriangles: number;
  outputQuads: number;
  remainingTriangles: number;
  coveragePercent: number;
}

export function summarize(mesh: MeshData, result: QuadrangulateResult): QuadrangulateSummary {
  return {
    inputTriangles: mesh.triangles.length,
    outputQuads: result.quads.length,
    remainingTriangles: result.remainingTriangles.length,
    coveragePercent: result.coverage * 100,
  };
}
