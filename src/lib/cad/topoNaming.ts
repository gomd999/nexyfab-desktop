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
import { extrudePolyhedron, polyhedronEdges, revolvePolyhedron } from './featureMesh';
import type { ExtrudeFeature } from './extrudeProfile';
import type { RevolveFeature } from './revolveProfile';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { add, scale } from '@/lib/sketch/sketchPlane';

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

/**
 * 3D midpoint of a named edge on the current polyhedron, or null. This is the
 * bridge to a kernel: a stable name resolves to a geometric anchor, which the
 * OCCT layer (K3) matches against the kernel's own re-indexed edges to pick the
 * right `TopoDS_Edge` for a fillet/chamfer.
 */
export function edgeMidpoint(topo: NamedTopology, name: string): Vec3 | null {
  const loc = topo.byName.get(name);
  if (!loc || loc.kind !== 'edge') return null;
  const e = topo.edges[loc.index];
  return scale(add(topo.poly.vertices[e.a], topo.poly.vertices[e.b]), 0.5);
}

/** All stable names of a given kind (for UI pickers / fillet selection). */
export function namesOf(topo: NamedTopology, kind: TopoKind): string[] {
  const out: string[] = [];
  for (const [name, loc] of topo.byName) if (loc.kind === kind) out.push(name);
  return out.sort();
}

// ─── revolve (ADR-017 S5 — coverage was 0%) ─────────────────────────────────
//
// Same generative-provenance doctrine as buildExtrudeTopo, applied to the
// B-rep topology of a revolve: names derive from PROFILE indices + role, never
// from kernel enumeration order or geometry. Unlike the extrude namer (whose
// polyhedron edges coincide with the kernel's), a revolve's faceted mesh does
// NOT match the B-rep (32 chords ≠ 1 circle), so the revolve namer carries
// ANALYTIC anchors instead of a polyhedron: for every named edge, the exact 3D
// point where the kernel's curve-parameter midpoint sits. All anchor formulas
// below are MEASURED against the real kernel (BRepPrimAPI_MakeRevol about +Y,
// probe 2026-07-20, see revolveTopo.test.ts):
//
//   - rotation is right-handed about +Y:  (x, y, 0) @ θ → (x·cosθ, y, −x·sinθ)
//   - a partial arc's curve midpoint is the point at θ = angle/2
//   - a full circle's curve midpoint is the point at θ = 180°
//
// TOPOLOGY SPLIT — a partial sweep (angle < 360) and a full revolve are
// DIFFERENT topologies and get different name sets:
//
//   partial: e.lat.{i}        arc swept by off-axis profile vertex i
//            e.mer.start.{i}  profile edge i on the θ=0 cap
//            e.mer.end.{i}    profile edge i on the θ=angle cap
//            e.axis.{i}       profile edge i lying ON the axis (one shared
//                             edge — both caps border it)
//            f.side.{i} / f.cap.start / f.cap.end
//   full:    e.lat.{i}        full circle swept by off-axis profile vertex i
//            e.seam.{i}       seam of the PERIODIC surface swept by profile
//                             edge i (exists only when the edge sweeps a
//                             cylinder/cone, i.e. y varies; a radial edge
//                             sweeps a planar annulus — no seam, measured)
//            f.side.{i}       (no caps, no meridians, no axis edge — measured)
//
// Crossing full ↔ partial therefore drops the topology-bound names
// (caps/meridians/axis/seam) — an EXPLICIT loss per ADR-017 D1, never a silent
// reinterpretation (a seam is not the same entity as a cap-boundary meridian
// even though both sit at θ=0). `e.lat.{i}` and `f.side.{i}` survive the
// crossing, because the entity genuinely persists.

/** Vertex/edge counts as "on the revolve axis" below this |x|. */
const REVOLVE_AXIS_EPS = 1e-9;
/** angle ≥ 360 − ε ⇒ full (periodic) revolve. Matches featureMesh/the bridge. */
const REVOLVE_FULL_EPS = 1e-9;

export interface RevolveTopoEntity {
  kind: TopoKind;
  /**
   * Analytic anchor. For an EDGE: the exact point the kernel's curve-parameter
   * midpoint evaluates to (verified 1e-6 against MakeRevol). For a FACE: a
   * representative point ON the carrier surface at mid-sweep (caps: the
   * profile vertex centroid on the cap plane — may fall outside the boundary
   * of a non-convex profile; faces are not midpoint-matched by the bridge).
   */
  anchor: Vec3;
}

export interface RevolveNamedTopology {
  feature: RevolveFeature;
  /** Canonical deduped profile (axis = Y, X ≥ 0) that name indices refer to. */
  profile: ReadonlyArray<{ x: number; y: number }>;
  /** True when the sweep is a full 360° (periodic — no caps/meridians). */
  full: boolean;
  byName: Map<string, RevolveTopoEntity>;
}

/** Rotate a canonical profile point about +Y by θ degrees (right-handed). */
function rotProfilePoint(p: { x: number; y: number }, thetaDeg: number): Vec3 {
  const t = (thetaDeg * Math.PI) / 180;
  return { x: p.x * Math.cos(t), y: p.y, z: -p.x * Math.sin(t) };
}

/**
 * Deduplicate consecutive coincident points + a closing duplicate. Mirrors
 * featureMesh's loop canonicalisation AND BRepBuilderAPI_MakePolygon (which
 * skips coincident consecutive points), so name indices agree with both the
 * mesh and the kernel build.
 */
function dedupeProfile(loop: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number }[] {
  const EPS = 1e-9;
  const out: { x: number; y: number }[] = [];
  for (const p of loop) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < EPS && Math.abs(prev.y - p.y) < EPS) continue;
    out.push({ x: p.x, y: p.y });
  }
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f.x - l.x) < EPS && Math.abs(f.y - l.y) < EPS) out.pop();
  }
  return out;
}

/**
 * Build the stable-named topology of a revolve. Names derive purely from
 * profile vertex/edge indices + role (generative provenance) — invariant to
 * radius/height/angle edits that keep the profile's vertex count and
 * axis-touching pattern, which is exactly the invariance buildExtrudeTopo
 * provides for prisms.
 *
 * Refuses (throws) rather than guessing on: < 3 distinct profile points, a
 * profile point at x < 0 (revolveProfile guarantees the canonical X ≥ 0
 * frame — a violation means the caller skipped canonicalisation), or a
 * non-positive/non-finite angle.
 */
export function buildRevolveTopo(feature: RevolveFeature): RevolveNamedTopology {
  const profile = dedupeProfile(feature.loop);
  if (profile.length < 3) {
    throw new Error(`topoNaming: revolve profile needs ≥ 3 distinct points, got ${profile.length}`);
  }
  for (const p of profile) {
    if (p.x < -REVOLVE_AXIS_EPS) {
      throw new Error(
        `topoNaming: revolve profile point x=${p.x} < 0 — not in the canonical axis frame (axis = Y, X ≥ 0)`,
      );
    }
  }
  const angle = feature.angleDegrees;
  if (!Number.isFinite(angle) || angle <= 0 || angle > 360) {
    throw new Error(`topoNaming: revolve angle must be in (0, 360], got ${angle}`);
  }
  const full = angle >= 360 - REVOLVE_FULL_EPS;
  const n = profile.length;
  const onAxis = profile.map((p) => Math.abs(p.x) <= REVOLVE_AXIS_EPS);

  const byName = new Map<string, RevolveTopoEntity>();
  const put = (name: string, kind: TopoKind, anchor: Vec3) => byName.set(name, { kind, anchor });

  // Latitude edges — one per OFF-AXIS profile vertex (an on-axis vertex sweeps
  // to a point, not an edge). Anchor = the kernel curve midpoint: θ = angle/2
  // for an arc, θ = 180° for a full circle (measured).
  for (let i = 0; i < n; i++) {
    if (onAxis[i]) continue;
    put(`e.lat.${i}`, 'edge', rotProfilePoint(profile[i], full ? 180 : angle / 2));
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = profile[i];
    const b = profile[j];
    const bothOnAxis = onAxis[i] && onAxis[j];
    const mid2d = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    if (bothOnAxis) {
      // Sweeps no surface. Partial: one straight edge ON the axis, shared by
      // both caps (measured). Full: nothing at all (measured).
      if (!full) put(`e.axis.${i}`, 'edge', { x: 0, y: mid2d.y, z: 0 });
      continue;
    }

    // Swept surface of profile edge i.
    put(`f.side.${i}`, 'face', rotProfilePoint(mid2d, full ? 180 : angle / 2));

    if (full) {
      // Periodic surfaces (y varies ⇒ cylinder/cone) expose a seam edge at
      // θ = 0 — geometrically the profile edge itself. A radial edge
      // (y constant) sweeps a planar annulus: no seam (measured).
      if (Math.abs(a.y - b.y) > REVOLVE_AXIS_EPS) {
        put(`e.seam.${i}`, 'edge', { x: mid2d.x, y: mid2d.y, z: 0 });
      }
    } else {
      // Cap-boundary meridians: the profile edge at θ = 0 and at θ = angle.
      put(`e.mer.start.${i}`, 'edge', { x: mid2d.x, y: mid2d.y, z: 0 });
      put(`e.mer.end.${i}`, 'edge', rotProfilePoint(mid2d, angle));
    }
  }

  // Cap faces (partial only — a full revolve has none).
  if (!full) {
    let cx = 0;
    let cy = 0;
    for (const p of profile) {
      cx += p.x;
      cy += p.y;
    }
    const centroid = { x: cx / n, y: cy / n };
    put('f.cap.start', 'face', { x: centroid.x, y: centroid.y, z: 0 });
    put('f.cap.end', 'face', rotProfilePoint(centroid, angle));
  }

  return { feature, profile, full, byName };
}

/**
 * Anchor of a named revolve edge — the point the kernel's curve-parameter
 * midpoint sits at — or null when the name doesn't exist in THIS topology
 * (unknown, or bound to the other full/partial topology). Feed the result to
 * `nearestByMidpoint` against the kernel's edge midpoints, exactly like
 * `edgeMidpoint` for extrudes.
 */
export function revolveEdgeAnchor(topo: RevolveNamedTopology, name: string): Vec3 | null {
  const e = topo.byName.get(name);
  return e && e.kind === 'edge' ? e.anchor : null;
}

/** All stable revolve names of a given kind (for UI pickers / fillet selection). */
export function revolveNamesOf(topo: RevolveNamedTopology, kind: TopoKind): string[] {
  const out: string[] = [];
  for (const [name, e] of topo.byName) if (e.kind === kind) out.push(name);
  return out.sort();
}

/**
 * Edge name → anchor map, ready for `composedTopo.fromAnchors` — the same
 * interop shape extrude primitives use on the boolean path.
 */
export function revolveEdgeAnchors(topo: RevolveNamedTopology): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const [name, e] of topo.byName) if (e.kind === 'edge') out.set(name, e.anchor);
  return out;
}

// ─── revolve → measure adapter (WB-1 · coverage matrix ② A 승격) ─────────────
//
// `measureDimension` (lib/drawing/measure.ts) consumes a `NamedTopology`:
// a TESSELLATED polyhedron whose named faces carry vertex LOOPS, so it can
// verify concyclicity of a circular cap and read parallel-face separations.
// `RevolveNamedTopology` above carries ANALYTIC anchors (single points) for
// KERNEL edge matching — a different job, structurally incompatible with the
// measurer (no loops, and the ⌀-bearing latitude circle is named as an EDGE,
// which measure rejects because polyhedral edges are straight).
//
// This adapter bridges the gap the honest way (생성≠검증): it does NOT assert
// "radius = profile.x". It builds the REAL revolve mesh (featureMesh's
// `revolvePolyhedron`, the same tessellation the drawing draws) and exposes,
// for every OFF-AXIS profile vertex i, a circular cross-section FACE
// `f.lat.{i}` whose loop is that vertex's swept ring of mesh vertices. Those
// vertices sit on the true circle r = profile[i].x by construction, so
// measure's own circumcircle fit + concyclicity check (default 1e-6) MEASURES
// them and confirms it — the tessellation is verified, not trusted.
//
// Naming — same generative-provenance doctrine, shared index space with the
// analytic namer: `f.lat.{i}` is the planar cross-section circle bounded by the
// latitude circle `e.lat.{i}`. A dimension attaches to it as:
//   diametric / radial  f.lat.{i}   ⌀ / R of the rim at (profile[i].x, .y),
//                                    measured on the axis-normal view (the view
//                                    whose viewDir ∥ the revolve axis = +Y,
//                                    i.e. 'front'/'back'). Other views fail
//                                    'oblique-in-view' — no ellipse fabrication.
//   linear  f.lat.{i}, f.lat.{k}    axial length |y_i − y_k| between two rims,
//                                    measured on an axis-parallel view ('top'
//                                    etc.) where both disks are edge-on.
// On-axis profile vertices sweep to a point (no rim) and get no name.

/**
 * Build the MEASURE-facing named topology of a revolve — a `NamedTopology`
 * (tessellated) that `measureDimension` consumes directly, exposing each rim
 * as a circular cross-section face `f.lat.{i}`. Same canonical-frame refusals
 * as `buildRevolveTopo` (≥ 3 distinct points; X ≥ 0 axis frame; angle ∈ (0,360]).
 *
 * The polyhedron's vertices ARE the drawn revolve mesh's vertices (identical
 * `revolvePolyhedron` tessellation), so a measured ⌀ is the model's real rim,
 * not an analytic shortcut. `segments` must match the mesh used elsewhere for
 * the names to co-refer (default 32, featureMesh's default).
 */
export function buildRevolveMeasureTopo(
  feature: RevolveFeature,
  segments = 32,
): NamedTopology {
  // Mirror buildRevolveTopo's canonical-frame refusals (explicit, no guessing).
  const profile = dedupeProfile(feature.loop);
  if (profile.length < 3) {
    throw new Error(
      `topoNaming: revolve profile needs ≥ 3 distinct points, got ${profile.length}`,
    );
  }
  for (const p of profile) {
    if (p.x < -REVOLVE_AXIS_EPS) {
      throw new Error(
        `topoNaming: revolve profile point x=${p.x} < 0 — not in the canonical axis frame (axis = Y, X ≥ 0)`,
      );
    }
  }
  const angle = feature.angleDegrees;
  if (!Number.isFinite(angle) || angle <= 0 || angle > 360) {
    throw new Error(`topoNaming: revolve angle must be in (0, 360], got ${angle}`);
  }

  // The actual drawn tessellation — vertices ordered ring-major: idx(i, j) =
  // j * n + i, matching featureMesh (which dedupes the loop identically).
  const mesh = revolvePolyhedron(feature, segments);
  const n = profile.length;
  const full = angle >= 360 - REVOLVE_FULL_EPS;
  const rings = full ? segments : segments + 1;
  const onAxis = profile.map((p) => Math.abs(p.x) <= REVOLVE_AXIS_EPS);

  const faces: PolyFace[] = [];
  const byName = new Map<string, { kind: TopoKind; index: number }>();
  const faceNameByIndex: string[] = [];

  for (let i = 0; i < n; i++) {
    if (onAxis[i]) continue; // sweeps to a point — no rim circle
    const loopIdx: number[] = [];
    for (let j = 0; j < rings; j++) loopIdx.push(j * n + i);
    // Cross-section plane is y = profile[i].y ⇒ plane normal ∥ +Y. measure uses
    // the normal only up to sign (radial: |n × viewDir|; linear: |n · Δ|).
    const faceIndex = faces.length;
    faces.push({ vertices: loopIdx, normal: { x: 0, y: 1, z: 0 } });
    const name = `f.lat.${i}`;
    byName.set(name, { kind: 'face', index: faceIndex });
    faceNameByIndex[faceIndex] = name;
  }

  const poly: Polyhedron = { vertices: mesh.vertices, faces };
  const edges: PolyEdge[] = []; // ⌀/axial dims are face-based; no named edges here

  return {
    poly,
    edges,
    byName,
    faceName: (i: number) => faceNameByIndex[i] ?? `f.unknown.${i}`,
    edgeName: (i: number) => `e.unknown.${i}`,
  };
}
