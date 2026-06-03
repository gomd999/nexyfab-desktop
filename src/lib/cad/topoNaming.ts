/**
 * topoNaming — stable topological names for a feature's faces + edges (K2 of
 * ADR-014, the "topological naming problem").
 *
 * The kernel re-indexes faces/edges on every rebuild, so a fillet that selected
 * "face #3" breaks the moment an upstream parameter changes. The fix is a name
 * derived from GENERATIVE PROVENANCE — which feature created the entity and its
 * role — not the volatile kernel index. An extrude prism's faces are
 * `f.cap.bottom`, `f.cap.top`, `f.side.{i}` (i = profile-edge index); its edges
 * are `e.bottom.{i}-{j}`, `e.top.{i}-{j}`, `e.vert.{i}`. Those names are
 * INVARIANT to coordinate / depth edits (same profile-vertex count), so a
 * selection survives a rebuild.
 *
 * This is the deterministic-provenance layer (extrude / revolve primitives).
 * Booleans split + merge faces, so they need a geometric re-match pass on top
 * (K2.2) — out of scope here. Pure TS, kernel-agnostic; the names resolve
 * against the featureMesh polyhedron, and the OCCT bridge consumes them in K3.
 */

import type { Polyhedron, PolyFace, PolyEdge } from './featureMesh';
import { extrudePolyhedron, polyhedronEdges } from './featureMesh';
import type { ExtrudeFeature } from './extrudeProfile';

export type TopoKind = 'face' | 'edge';

export interface NamedTopology {
  poly: Polyhedron;
  edges: PolyEdge[];
  /** Stable name → entity locator. */
  byName: Map<string, { kind: TopoKind; index: number }>;
  /** faceIndex → stable name. */
  faceName: (faceIndex: number) => string;
  /** edgeIndex (into `edges`) → stable name. */
  edgeName: (edgeIndex: number) => string;
}

/**
 * Build the stable-named topology of an extrude prism. featureMesh emits faces
 * in a fixed order (bottom cap, top cap, then one side per profile edge) and
 * the vertex rings are [0,n) bottom / [n,2n) top — so names derive purely from
 * profile indices + construction order, independent of the actual coordinates.
 */
export function buildExtrudeTopo(feature: ExtrudeFeature): NamedTopology {
  const poly = extrudePolyhedron(feature);
  const n = poly.vertices.length / 2; // deduped profile vertex count
  const edges = polyhedronEdges(poly);

  const faceName = (i: number): string => {
    if (i === 0) return 'f.cap.bottom';
    if (i === 1) return 'f.cap.top';
    return `f.side.${i - 2}`;
  };

  const edgeName = (ei: number): string => {
    const e = edges[ei];
    const aBottom = e.a < n;
    const bBottom = e.b < n;
    if (aBottom && bBottom) {
      const [lo, hi] = e.a < e.b ? [e.a, e.b] : [e.b, e.a];
      return `e.bottom.${lo}-${hi}`;
    }
    if (!aBottom && !bBottom) {
      const lo = Math.min(e.a, e.b) - n;
      const hi = Math.max(e.a, e.b) - n;
      return `e.top.${lo}-${hi}`;
    }
    // Vertical edge connects loop vertex i (bottom) to i (top) → i = the bottom index.
    const i = aBottom ? e.a : e.b;
    return `e.vert.${i}`;
  };

  const byName = new Map<string, { kind: TopoKind; index: number }>();
  poly.faces.forEach((_f, i) => byName.set(faceName(i), { kind: 'face', index: i }));
  edges.forEach((_e, i) => byName.set(edgeName(i), { kind: 'edge', index: i }));

  return { poly, edges, byName, faceName, edgeName };
}

/** Resolve a stable name to its current face on the polyhedron, or null. */
export function resolveFace(topo: NamedTopology, name: string): PolyFace | null {
  const loc = topo.byName.get(name);
  return loc && loc.kind === 'face' ? topo.poly.faces[loc.index] : null;
}

/** Resolve a stable name to its current edge, or null. */
export function resolveEdge(topo: NamedTopology, name: string): PolyEdge | null {
  const loc = topo.byName.get(name);
  return loc && loc.kind === 'edge' ? topo.edges[loc.index] : null;
}

/** All stable names of a given kind (for UI pickers / fillet selection). */
export function namesOf(topo: NamedTopology, kind: TopoKind): string[] {
  const out: string[] = [];
  for (const [name, loc] of topo.byName) if (loc.kind === kind) out.push(name);
  return out.sort();
}
