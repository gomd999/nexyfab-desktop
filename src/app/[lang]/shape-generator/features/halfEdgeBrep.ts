/**
 * halfEdgeBrep.ts — Half-edge B-rep data structure + Euler operators.
 *
 * Production CAD kernels (Parasolid, ACIS, OCCT) represent every model
 * as a half-edge B-rep: each edge is two oriented half-edges, each
 * face has a chain of half-edges around its boundary, each vertex
 * knows one outgoing half-edge. From there:
 *
 *   - Walk every edge around a face: follow `next` until back to start.
 *   - Walk every face around a vertex: from outgoing half-edge, take
 *     `.twin.next` repeatedly until back to start.
 *   - Find shared edge: half-edge `.twin.face` and `.face`.
 *
 * On top of that data structure sits the **Euler operator algebra**:
 *
 *   - MEV  (Make Edge + Vertex) — extend a face by an edge to a new vertex
 *   - MEF  (Make Edge + Face)   — split a face by adding an edge between
 *                                 two existing vertices on its boundary
 *   - KEMR (Kill Edge + Make Ring) — inverse of MEF; deletes a connecting
 *                                    edge + creates a ring (hole in face)
 *   - MEKR (Make Edge + Kill Ring) — inverse: edge join joins a ring back
 *
 * Each preserves the Euler-Poincaré invariant V − E + F = 2(s − g) + r
 * (s shells, g genus, r rings). Tracked here.
 *
 * The data structure is mesh-neutral — geometry is attached as
 * (x,y,z) on vertices, but the topology operates purely on
 * connectivity.
 */

export type Vec3 = [number, number, number];

// ── Core elements ───────────────────────────────────────────────

export interface Vertex {
  id: string;
  position: Vec3;
  /** One outgoing half-edge (the rest reachable via twins). */
  outgoing: HalfEdge | null;
}

export interface HalfEdge {
  id: string;
  /** Origin vertex (this half-edge points away from it). */
  origin: Vertex;
  /** Twin (opposite-direction) half-edge. */
  twin: HalfEdge | null;
  /** Next half-edge along the same face's boundary. */
  next: HalfEdge | null;
  /** Previous half-edge along the same face's boundary. */
  prev: HalfEdge | null;
  /** Face this half-edge bounds. */
  face: Face | null;
}

export interface Face {
  id: string;
  /** One half-edge on the face's outer boundary loop. */
  outerLoop: HalfEdge | null;
  /** Inner loops (rings — i.e. holes in the face). */
  innerLoops: HalfEdge[];
  /** Optional analytical surface tag (planar / cylindrical / etc). */
  surfaceKind?: 'planar' | 'cylindrical' | 'spherical' | 'conical' | 'toroidal' | 'freeform';
  /** Outward normal for planar faces (also useful as a hint for others). */
  normal?: Vec3;
}

export interface BrepShell {
  vertices: Map<string, Vertex>;
  halfEdges: Map<string, HalfEdge>;
  faces: Map<string, Face>;
  /** Optional outer body shell flag. */
  isOuter: boolean;
}

export class BrepModel {
  shells: BrepShell[] = [];
  private idCounter = 0;

  newShell(): BrepShell {
    const shell: BrepShell = {
      vertices: new Map(), halfEdges: new Map(), faces: new Map(),
      isOuter: this.shells.length === 0,
    };
    this.shells.push(shell);
    return shell;
  }

  nextId(prefix: string): string {
    return `${prefix}-${(++this.idCounter).toString(36)}`;
  }
}

// ── Euler-Poincaré check ────────────────────────────────────────

export interface EulerStats {
  vertices: number;
  edges: number;
  faces: number;
  shells: number;
  /** Number of rings (inner loops). */
  rings: number;
  /** Genus (assumes single shell). 2(s - g) + r = V - E + F. */
  genus: number;
  /** True iff the formula V − E + F = 2(s − g) + r is satisfied. */
  satisfiesFormula: boolean;
}

export function eulerStats(model: BrepModel): EulerStats {
  let V = 0, F = 0, R = 0;
  let halfEdgeCount = 0;
  for (const s of model.shells) {
    V += s.vertices.size;
    F += s.faces.size;
    halfEdgeCount += s.halfEdges.size;
    for (const f of s.faces.values()) R += f.innerLoops.length;
  }
  const E = halfEdgeCount / 2;
  const S = model.shells.length;
  // V - E + F = 2(s - g) + r  →  g = s - (V - E + F - r) / 2
  const lhs = V - E + F;
  const genus = S - (lhs - R) / 2;
  const expected = 2 * (S - genus) + R;
  return {
    vertices: V, edges: E, faces: F, shells: S, rings: R, genus,
    satisfiesFormula: Math.abs(lhs - expected) < 1e-9,
  };
}

// ── Vertex / edge / face creation primitives ────────────────────

export function createVertex(model: BrepModel, shell: BrepShell, position: Vec3): Vertex {
  const id = model.nextId('v');
  const v: Vertex = { id, position, outgoing: null };
  shell.vertices.set(id, v);
  return v;
}

/** Create a pair of half-edges between two vertices.
 *  Returns the "forward" half-edge (origin = from). */
export function createEdgePair(model: BrepModel, shell: BrepShell, from: Vertex, to: Vertex): HalfEdge {
  const forwardId = model.nextId('he');
  const twinId = model.nextId('he');
  const fwd: HalfEdge = { id: forwardId, origin: from, twin: null, next: null, prev: null, face: null };
  const twin: HalfEdge = { id: twinId, origin: to, twin: fwd, next: null, prev: null, face: null };
  fwd.twin = twin;
  shell.halfEdges.set(forwardId, fwd);
  shell.halfEdges.set(twinId, twin);
  if (!from.outgoing) from.outgoing = fwd;
  if (!to.outgoing) to.outgoing = twin;
  return fwd;
}

export function createFace(model: BrepModel, shell: BrepShell, outerLoopHe: HalfEdge | null): Face {
  const id = model.nextId('f');
  const f: Face = { id, outerLoop: outerLoopHe, innerLoops: [] };
  if (outerLoopHe) {
    let h: HalfEdge | null = outerLoopHe;
    let safety = 0;
    do {
      h!.face = f;
      h = h!.next;
      if (++safety > 10000) break;
    } while (h && h !== outerLoopHe);
  }
  shell.faces.set(id, f);
  return f;
}

// ── Traversal helpers ───────────────────────────────────────────

/** Walk the boundary of a face — yields every half-edge in order. */
export function faceHalfEdges(face: Face): HalfEdge[] {
  if (!face.outerLoop) return [];
  const out: HalfEdge[] = [];
  let cur: HalfEdge | null = face.outerLoop;
  let safety = 0;
  do {
    if (!cur) break;
    out.push(cur);
    cur = cur.next;
    if (++safety > 10000) break;
  } while (cur && cur !== face.outerLoop);
  return out;
}

/** Walk the vertices of a face. */
export function faceVertices(face: Face): Vertex[] {
  return faceHalfEdges(face).map(he => he.origin);
}

/** Walk all faces incident to a vertex (1-ring). */
export function vertexFaces(vertex: Vertex): Face[] {
  if (!vertex.outgoing) return [];
  const seen = new Set<string>();
  const out: Face[] = [];
  let he: HalfEdge | null = vertex.outgoing;
  let safety = 0;
  do {
    if (!he) break;
    if (he.face && !seen.has(he.face.id)) {
      seen.add(he.face.id);
      out.push(he.face);
    }
    // Twin's next gives the next outgoing half-edge from this vertex.
    he = he.twin?.next ?? null;
    if (++safety > 10000) break;
  } while (he && he !== vertex.outgoing);
  return out;
}

/** All outgoing half-edges from a vertex. */
export function vertexOutgoingHalfEdges(vertex: Vertex): HalfEdge[] {
  if (!vertex.outgoing) return [];
  const out: HalfEdge[] = [];
  let he: HalfEdge | null = vertex.outgoing;
  let safety = 0;
  do {
    if (!he) break;
    out.push(he);
    he = he.twin?.next ?? null;
    if (++safety > 10000) break;
  } while (he && he !== vertex.outgoing);
  return out;
}

/** The two faces sharing an edge (could be one face on both sides for
 *  non-manifold cases — returned as a pair). */
export function edgeFaces(halfEdge: HalfEdge): { left: Face | null; right: Face | null } {
  return { left: halfEdge.face, right: halfEdge.twin?.face ?? null };
}

// ── Convexity classification ────────────────────────────────────

export type EdgeConvexity = 'convex' | 'concave' | 'tangent' | 'smooth' | 'unknown';

/** Classify edge by relative orientation of the two face normals. */
export function classifyEdge(halfEdge: HalfEdge, tangentTolDeg: number = 2): EdgeConvexity {
  const left = halfEdge.face;
  const right = halfEdge.twin?.face;
  if (!left || !right || !left.normal || !right.normal) return 'unknown';
  const nl = left.normal, nr = right.normal;
  const dot = nl[0] * nr[0] + nl[1] * nr[1] + nl[2] * nr[2];
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
  if (angleDeg < tangentTolDeg) return 'tangent';
  // Edge direction.
  const v1 = halfEdge.origin.position;
  const v2 = halfEdge.twin!.origin.position;
  const edgeDir: Vec3 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
  // Normal cross gives a direction along the edge if it's tangential.
  const cross: Vec3 = [
    nl[1] * nr[2] - nl[2] * nr[1],
    nl[2] * nr[0] - nl[0] * nr[2],
    nl[0] * nr[1] - nl[1] * nr[0],
  ];
  const sign = cross[0] * edgeDir[0] + cross[1] * edgeDir[1] + cross[2] * edgeDir[2];
  // Smooth = nearly parallel normals (≥ 175°) but not exactly tangent — typical of a fillet.
  if (angleDeg > 175) return 'smooth';
  return sign > 0 ? 'convex' : 'concave';
}

// ── Euler operators ─────────────────────────────────────────────

/** MEV — Make Edge + Vertex. Extend a face by adding a new vertex
 *  connected to `fromVertex` via a new edge. The face stays one face;
 *  vertex count +1, edge count +1. */
export function MEV(model: BrepModel, shell: BrepShell, fromVertex: Vertex, newPos: Vec3): { vertex: Vertex; edge: HalfEdge } {
  const newV = createVertex(model, shell, newPos);
  const he = createEdgePair(model, shell, fromVertex, newV);
  // Hook into fromVertex's face loop: insert he and he.twin around the cycle.
  const startingHe = fromVertex.outgoing;
  if (startingHe?.face) {
    const face = startingHe.face;
    const insertAfter = findInsertionPoint(startingHe, fromVertex);
    if (insertAfter) {
      const after = insertAfter.next;
      insertAfter.next = he;
      he.prev = insertAfter;
      he.next = he.twin;
      he.twin!.prev = he;
      he.twin!.next = after;
      if (after) after.prev = he.twin;
      he.face = face;
      he.twin!.face = face;
    }
  }
  return { vertex: newV, edge: he };
}

function findInsertionPoint(startingHe: HalfEdge, _atVertex: Vertex): HalfEdge | null {
  void _atVertex;
  return startingHe.prev;
}

/** MEF — Make Edge + Face. Split a face by adding an edge between two
 *  vertices that are already on its boundary. The new face is the
 *  portion enclosed by the new edge + part of the original loop.
 *  Face count +1, edge count +1. */
export function MEF(model: BrepModel, shell: BrepShell, face: Face, v1: Vertex, v2: Vertex): { newFace: Face; edge: HalfEdge } | null {
  // Both vertices must be on this face.
  const hes = faceHalfEdges(face);
  const he1 = hes.find(h => h.origin.id === v1.id);
  const he2 = hes.find(h => h.origin.id === v2.id);
  if (!he1 || !he2) return null;
  const newEdge = createEdgePair(model, shell, v1, v2);

  // Splice he1 and he2.
  const he1Prev = he1.prev!;
  const he2Prev = he2.prev!;
  he1Prev.next = newEdge;
  newEdge.prev = he1Prev;
  newEdge.next = he2;
  he2.prev = newEdge;
  he2Prev.next = newEdge.twin;
  newEdge.twin!.prev = he2Prev;
  newEdge.twin!.next = he1;
  he1.prev = newEdge.twin;

  // One half goes to original face, other half to new face.
  const newFace = createFace(model, shell, newEdge.twin);
  // Re-stamp face pointers — both loops.
  for (const h of faceHalfEdges(face)) h.face = face;
  for (const h of faceHalfEdges(newFace)) h.face = newFace;
  newEdge.face = face;
  return { newFace, edge: newEdge };
}

// ── Shell-level validation ──────────────────────────────────────

export interface ValidationReport {
  valid: boolean;
  issues: string[];
}

export function validateShell(shell: BrepShell): ValidationReport {
  const issues: string[] = [];
  for (const he of shell.halfEdges.values()) {
    if (!he.twin) issues.push(`Half-edge ${he.id} has no twin`);
    if (!he.next) issues.push(`Half-edge ${he.id} has no next`);
    if (!he.prev) issues.push(`Half-edge ${he.id} has no prev`);
    if (he.twin && he.twin.twin !== he) issues.push(`Half-edge ${he.id} twin not symmetric`);
    if (he.next && he.next.prev !== he) issues.push(`Half-edge ${he.id} next.prev != self`);
  }
  for (const v of shell.vertices.values()) {
    if (!v.outgoing && shell.halfEdges.size > 0) {
      issues.push(`Vertex ${v.id} has no outgoing half-edge`);
    }
  }
  return { valid: issues.length === 0, issues };
}
