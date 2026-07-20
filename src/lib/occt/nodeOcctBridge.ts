/**
 * nodeOcctBridge — a REAL OcctBridge backed by the headless Node module
 * (loadOcctNode). This is K1b-real of ADR-014: feature tree → featureTreeToOcctPlan
 * → executeOcctPlan → THIS bridge → real OCCT B-rep.
 *
 * Implemented against opencascade.js embind (signatures locked by probe,
 * 2026-06-04): extrude (MakePolygon→MakeFace→MakePrism), revolve (MakeRevol
 * about Y), boolean (BRepAlgoAPI Fuse/Cut/Common, 2-arg), volume + bbox
 * (BRepGProp / Bnd_Box). fillet/chamfer need stable edge ids (K2) and STEP I/O
 * is K4 — both report a clear "not yet" rather than a wrong result.
 *
 * Node/server/test-only. The browser uses the worker bridge.
 */

import type { OcctBridge, OcctBooleanOps, BooleanOperandIds } from './bridge';
import type { OcctShape, OcctShapeKind, OcctOperationResult, Vec3 } from './types';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { OcctModule } from './nodeOcctLoader';
import { buildExtrudeTopo, edgeMidpoint, namesOf, buildRevolveTopo, revolveEdgeAnchors } from '@/lib/cad/topoNaming';
import { nearestByMidpoint } from '@/lib/cad/edgeMatch';
import { composeBooleanTopo, fromAnchors, qualifyName, type EdgeAnchorSource, type BooleanInput } from '@/lib/cad/composedTopo';
import { tessellateToMesh } from './occtViewerMesh';

// ─── embind typing helpers (no `any`) ──────────────────────────────────────

export type OcctInstance = Record<string, (...args: unknown[]) => unknown>;
type OcctCtor = new (...args: unknown[]) => OcctInstance;

/** Emscripten MEMFS surface used for STEP I/O (K4). */
interface OcctFS {
  writeFile(path: string, data: string): void;
  readFile(path: string, opts: { encoding: 'utf8' }): string;
  unlink(path: string): void;
}

/**
 * Fixed MEMFS scratch paths for STEP I/O. This opencascade.js build's STEP
 * Writer/Reader silently mis-handle many filenames (Write returns RetDone but
 * writes nothing; Reader returns RetError on a valid file — e.g. any path with
 * "_in_", or various digit-suffixed basenames). These two short names are
 * verified to round-trip reliably; each call unlinks after use so the next
 * Write always targets a fresh path. STEP ops are synchronous server-side, so
 * the shared scratch names never race.
 */
const STEP_WRITE_PATH = 'cadw.step';
const STEP_READ_PATH = 'cadr.step';

function maker(oc: OcctModule) {
  const ctor = (name: string): OcctCtor => oc[name] as OcctCtor;
  const stat = (name: string): OcctInstance => oc[name] as unknown as OcctInstance;
  const inst = (name: string, ...args: unknown[]): OcctInstance => new (ctor(name))(...args);
  return { ctor, stat, inst };
}

// ─── geometry helpers ───────────────────────────────────────────────────────

function extrudeZRange(f: ExtrudeFeature): { z0: number; h: number } {
  switch (f.direction) {
    case 'two_sided': return { z0: -f.depth, h: 2 * f.depth };
    case 'midplane': return { z0: -f.depth / 2, h: f.depth };
    default: return { z0: 0, h: f.depth };
  }
}

/** Planar face from a 2D loop at height z (an open surface / sheet body). */
function buildFace(oc: OcctModule, loop: ReadonlyArray<{ x: number; y: number }>, z: number): OcctInstance {
  const m = maker(oc);
  const poly = m.inst('BRepBuilderAPI_MakePolygon_1');
  for (const p of loop) poly.Add_1(m.inst('gp_Pnt_3', p.x, p.y, z));
  poly.Close();
  return m.inst('BRepBuilderAPI_MakeFace_15', poly.Wire(), false).Face() as OcctInstance;
}

type V3 = [number, number, number];
const cross3 = (a: V3, b: V3): V3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };

/** Planar face from a 2D loop placed in the plane (origin, normal) — lets callers
 *  build NON-parallel faces (XY-only buildFace can't cross for surfaceTrim). */
function buildFaceOriented(oc: OcctModule, loop: ReadonlyArray<{ x: number; y: number }>, origin: V3, normal: V3): OcctInstance {
  const m = maker(oc);
  const n = norm3(normal);
  const ref: V3 = Math.abs(n[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const u = norm3(cross3(ref, n));
  const v = cross3(n, u); // already unit (n,u orthonormal)
  const poly = m.inst('BRepBuilderAPI_MakePolygon_1');
  for (const p of loop) {
    poly.Add_1(m.inst('gp_Pnt_3',
      origin[0] + p.x * u[0] + p.y * v[0],
      origin[1] + p.x * u[1] + p.y * v[1],
      origin[2] + p.x * u[2] + p.y * v[2],
    ));
  }
  poly.Close();
  return m.inst('BRepBuilderAPI_MakeFace_15', poly.Wire(), false).Face() as OcctInstance;
}

/** Closed prism solid from a 2D loop at z0, extruded `h` along +Z. */
function buildPrism(oc: OcctModule, loop: ReadonlyArray<{ x: number; y: number }>, z0: number, h: number): OcctInstance {
  const m = maker(oc);
  const face = buildFace(oc, loop, z0);
  const vec = m.inst('gp_Vec_4', 0, 0, h);
  return m.inst('BRepPrimAPI_MakePrism_1', face, vec, false, true).Shape() as OcctInstance;
}

/** Total edge count (TopExp_Explorer over TopAbs_EDGE; not deduped). */
function rawEdgeCount(oc: OcctModule, shape: OcctInstance): number {
  const m = maker(oc);
  const en = oc.TopAbs_ShapeEnum as unknown as { TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
  const exp = m.inst('TopExp_Explorer_2', shape, en.TopAbs_EDGE, en.TopAbs_SHAPE);
  let n = 0;
  while (exp.More()) { n++; exp.Next(); }
  return n;
}

function volumeOf(oc: OcctModule, shape: OcctInstance): number {
  const m = maker(oc);
  const props = m.inst('GProp_GProps_1');
  m.stat('BRepGProp').VolumeProperties_1(shape, props, false, false, false);
  return props.Mass() as number;
}

function bboxOf(oc: OcctModule, shape: OcctInstance): { min: Vec3; max: Vec3 } | undefined {
  try {
    const m = maker(oc);
    const box = m.inst('Bnd_Box_1');
    m.stat('BRepBndLib').Add(shape, box, false);
    const lo = box.CornerMin() as OcctInstance;
    const hi = box.CornerMax() as OcctInstance;
    return {
      min: { x: lo.X() as number, y: lo.Y() as number, z: lo.Z() as number },
      max: { x: hi.X() as number, y: hi.Y() as number, z: hi.Z() as number },
    };
  } catch {
    return undefined;
  }
}

/**
 * Enumerate a shape's UNIQUE edges with their 3D midpoints. TopExp_Explorer
 * yields each edge once per adjacent face, so we dedupe by quantised midpoint.
 * The midpoint is the anchor edgeMatch uses to bind a stable name to a
 * kernel-reindexed `TopoDS_Edge`.
 */
function uniqueEdges(oc: OcctModule, shape: OcctInstance): Array<{ edge: OcctInstance; mid: Vec3 }> {
  const m = maker(oc);
  const shapeEnum = oc.TopAbs_ShapeEnum as unknown as { TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
  const topoDS = oc.TopoDS as unknown as { Edge_1: (s: unknown) => OcctInstance };
  const exp = m.inst('TopExp_Explorer_2', shape, shapeEnum.TopAbs_EDGE, shapeEnum.TopAbs_SHAPE);
  const seen = new Set<string>();
  const out: Array<{ edge: OcctInstance; mid: Vec3 }> = [];
  while (exp.More()) {
    const edge = topoDS.Edge_1(exp.Current());
    const curve = m.inst('BRepAdaptor_Curve_2', edge);
    const t0 = curve.FirstParameter() as number;
    const t1 = curve.LastParameter() as number;
    const p = curve.Value((t0 + t1) / 2) as OcctInstance;
    const mid: Vec3 = { x: p.X() as number, y: p.Y() as number, z: p.Z() as number };
    const key = `${Math.round(mid.x * 1000)},${Math.round(mid.y * 1000)},${Math.round(mid.z * 1000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ edge, mid });
    }
    exp.Next();
  }
  return out;
}

// ─── W3-A: kernel-history boolean naming (ADR-017 route (a), booleans only) ──
//
// A boolean's seam edges used to be named by their MIDPOINT SORT ORDER
// (`seam.k`) — a positional name that silently pointed at a different edge
// whenever a dimension change reordered the sort (S2 7.6% / S2b 4.2% silent
// mismatch, all seam-attributed). The kernel itself knows better:
// `BRepAlgoAPI_BooleanOperation.Generated(face)` lists the section edges each
// operand FACE generated, so a seam's identity is the PAIR of operand faces
// that intersect there — invariant to ordering. These helpers extract that
// history. They are exported so the ADR-017 spike harness replicates the
// shipping bridge with the SAME code (FIDELITY check).
//
// opencascade.js@1.1.1 exposure (probed 2026-07-20): `Modified(s)` /
// `Generated(s)` / `IsDeleted(s)` exist on the BRepAlgoAPI_* instances
// (inherited from BRepBuilderAPI_MakeShape), returning TopTools_ListOfShape.
// The list's embind `begin()/end()` iterators are UNBOUND — iterate by copying
// (`TopTools_ListOfShape_1` + `Assign`) then `First_1`/`RemoveFirst`, which
// leaves the underlying history intact.

/** A kernel face paired with its stable (possibly feature-qualified) name. */
export interface NamedKernelFace {
  face: OcctInstance;
  name: string;
}

/** One boolean operand's face-name table, for history extraction. */
export interface BooleanHistoryOperand {
  /** Stable feature id qualifying this operand's unqualified face names. */
  featureId?: string;
  faces: ReadonlyArray<NamedKernelFace>;
}

/** Copy a TopTools_ListOfShape into a JS array (history left untouched). */
function listToShapes(oc: OcctModule, list: OcctInstance): OcctInstance[] {
  const copy = new (oc.TopTools_ListOfShape_1 as OcctCtor)();
  copy.Assign(list);
  const out: OcctInstance[] = [];
  while ((copy.Size() as number) > 0) {
    out.push(copy.First_1() as OcctInstance);
    copy.RemoveFirst();
  }
  return out;
}

/** Area centroid of a face via BRepGProp, or null on kernel failure. */
function faceCentroid(oc: OcctModule, face: OcctInstance): Vec3 | null {
  try {
    const m = maker(oc);
    const props = m.inst('GProp_GProps_1');
    m.stat('BRepGProp').SurfaceProperties_1(face, props, false, false);
    const p = props.CentreOfMass() as OcctInstance;
    return { x: p.X() as number, y: p.Y() as number, z: p.Z() as number };
  } catch {
    return null;
  }
}

/** Unique faces of a shape (deduped by IsSame). */
function uniqueFaces(oc: OcctModule, shape: OcctInstance): OcctInstance[] {
  const m = maker(oc);
  const en = oc.TopAbs_ShapeEnum as unknown as { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
  const topoDS = oc.TopoDS as unknown as { Face_1: (s: unknown) => OcctInstance };
  const exp = m.inst('TopExp_Explorer_2', shape, en.TopAbs_FACE, en.TopAbs_SHAPE);
  const out: OcctInstance[] = [];
  while (exp.More()) {
    const face = topoDS.Face_1(exp.Current());
    exp.Next();
    if (out.some((f) => f.IsSame(face) as boolean)) continue;
    out.push(face);
  }
  return out;
}

/** Mirrors featureMesh.dedupeLoop so `f.side.{i}` indices match topoNaming. */
function dedupeLoop(loop: ReadonlyArray<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const EPS = 1e-9;
  for (const p of loop) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < EPS && Math.abs(prev.y - p.y) < EPS) continue;
    out.push({ x: p.x, y: p.y });
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && Math.abs(first.x - last.x) < EPS && Math.abs(first.y - last.y) < EPS) out.pop();
  return out;
}

/**
 * Stable names for the faces of an extrude prism, matched ANALYTICALLY (caps by
 * centroid z; each side face's area centroid IS the profile segment midpoint at
 * mid-height, exactly — prism sides are parallelograms). Names follow
 * topoNaming (`f.cap.bottom`, `f.cap.top`, `f.side.{i}`). A face that matches
 * nothing — or matches ambiguously — is left out rather than guessed (D1).
 */
export function classifyPrismFaces(
  oc: OcctModule,
  shape: OcctInstance,
  loop: ReadonlyArray<{ x: number; y: number }>,
  z0: number,
  z1: number,
  tol = 1e-4,
): NamedKernelFace[] {
  const profile = dedupeLoop(loop);
  const zMid = (z0 + z1) / 2;
  const sides = profile.map((p, i) => {
    const q = profile[(i + 1) % profile.length];
    return { name: `f.side.${i}`, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });

  const out: NamedKernelFace[] = [];
  const used = new Map<string, number>(); // name → count (dup names dropped)
  for (const face of uniqueFaces(oc, shape)) {
    const c = faceCentroid(oc, face);
    if (!c) continue;
    let name: string | null = null;
    if (Math.abs(c.z - z0) <= tol) name = 'f.cap.bottom';
    else if (Math.abs(c.z - z1) <= tol) name = 'f.cap.top';
    else if (Math.abs(c.z - zMid) <= tol) {
      let best: string | null = null;
      let bd = Infinity;
      let second = Infinity;
      for (const s of sides) {
        const d = Math.hypot(c.x - s.x, c.y - s.y);
        if (d < bd) { second = bd; bd = d; best = s.name; }
        else if (d < second) second = d;
      }
      if (bd <= tol && second > tol) name = best; // ambiguous double-hit → skip
    }
    if (!name) continue;
    used.set(name, (used.get(name) ?? 0) + 1);
    out.push({ face, name });
  }
  return out.filter((f) => used.get(f.name) === 1);
}

/**
 * Per-result-edge seam keys from the boolean's own history: for each named
 * operand face, `Generated(face)` lists the section edges it minted; a result
 * edge generated by ≥2 distinctly-named faces gets the sorted pair as its key
 * (`base/f.cap.top∩H0/f.side.2`). Fewer than 2 names is under-determined (the
 * sibling seam from the same single face would collide) → `null`, and
 * composeBooleanTopo leaves that edge explicitly unnamed. Never guesses.
 */
export function booleanSeamKeys(
  oc: OcctModule,
  algo: OcctInstance,
  operands: ReadonlyArray<BooleanHistoryOperand>,
  resultEdges: ReadonlyArray<{ edge: OcctInstance; mid: Vec3 }>,
): Array<string | null> {
  const edgeEnum = (oc.TopAbs_ShapeEnum as unknown as { TopAbs_EDGE: { value: number } }).TopAbs_EDGE;
  const gens: Array<Set<string>> = resultEdges.map(() => new Set());
  for (const op of operands) {
    for (const { face, name } of op.faces) {
      const qualified = qualifyName(op.featureId, name);
      let generated: OcctInstance[];
      try {
        generated = listToShapes(oc, algo.Generated(face) as OcctInstance);
      } catch {
        continue; // no history for this face → its seams stay unnamed
      }
      for (const g of generated) {
        try {
          const st = g.ShapeType() as { value?: number };
          if ((st?.value ?? st) !== edgeEnum.value) continue; // vertices etc.
        } catch {
          continue;
        }
        const idx = resultEdges.findIndex((re) => {
          try { return re.edge.IsSame(g) as boolean; } catch { return false; }
        });
        if (idx >= 0) gens[idx].add(qualified);
      }
    }
  }
  return gens.map((s) => (s.size >= 2 ? [...s].sort().join('∩') : null));
}

/** One boolean operand's named kernel EDGES, for Modified() inheritance. */
export interface BooleanEdgeHistoryOperand {
  /** Stable feature id qualifying this operand's unqualified edge names. */
  featureId?: string;
  namedEdges: ReadonlyArray<{ edge: OcctInstance; name: string }>;
}

/**
 * Kernel-history edge inheritance: for each named operand edge, `Modified()`
 * lists its descendants in the result — a TRIMMED edge whose midpoint moved
 * (so midpoint-coincidence inheritance cannot see it) still keeps its name.
 * Returns result-edge-index → composed-name bindings; collisions are left to
 * composeBooleanTopo, which refuses every colliding binding (D1).
 */
export function booleanModifiedEdgeNames(
  oc: OcctModule,
  algo: OcctInstance,
  operands: ReadonlyArray<BooleanEdgeHistoryOperand>,
  resultEdges: ReadonlyArray<{ edge: OcctInstance; mid: Vec3 }>,
): Array<{ index: number; name: string }> {
  const edgeEnum = (oc.TopAbs_ShapeEnum as unknown as { TopAbs_EDGE: { value: number } }).TopAbs_EDGE;
  const out: Array<{ index: number; name: string }> = [];
  for (const op of operands) {
    for (const { edge, name } of op.namedEdges) {
      const qualified = qualifyName(op.featureId, name);
      let modified: OcctInstance[];
      try {
        modified = listToShapes(oc, algo.Modified(edge) as OcctInstance);
      } catch {
        continue; // no history for this edge → it can only inherit by anchor
      }
      for (const g of modified) {
        try {
          const st = g.ShapeType() as { value?: number };
          if ((st?.value ?? st) !== edgeEnum.value) continue;
        } catch {
          continue;
        }
        const index = resultEdges.findIndex((re) => {
          try { return re.edge.IsSame(g) as boolean; } catch { return false; }
        });
        if (index >= 0) out.push({ index, name: qualified });
      }
    }
  }
  return out;
}

/**
 * Resolve a topo's stable edge names onto a live operand shape's kernel edges
 * (same-config midpoint anchoring, the standard K3 resolve — NOT a cross-config
 * guess). Input to {@link booleanModifiedEdgeNames}.
 */
export function namedKernelEdges(
  oc: OcctModule,
  live: OcctInstance,
  topo: EdgeAnchorSource | undefined,
  edges?: ReadonlyArray<{ edge: OcctInstance; mid: Vec3 }>,
): Array<{ edge: OcctInstance; name: string }> {
  if (!topo) return [];
  const opEdges = edges ?? uniqueEdges(oc, live);
  const mids = opEdges.map((e) => e.mid);
  const out: Array<{ edge: OcctInstance; name: string }> = [];
  for (const name of topo.names()) {
    const anchor = topo.anchor(name);
    if (!anchor) continue;
    const match = nearestByMidpoint(mids, anchor, 1e-3);
    if (match.index >= 0) out.push({ edge: opEdges[match.index].edge, name });
  }
  return out;
}

/**
 * Face-name table for a boolean RESULT, from kernel history: a result face
 * that IS an operand face (IsSame) or descends from one (`Modified`) inherits
 * that face's qualified name. 0 or ≥2 distinct candidates → unnamed (a split
 * face's parts DO share their source's name — that only ever degrades a later
 * seam key to an explicit ambiguity, never to a wrong pick).
 */
export function propagateBooleanFaceNames(
  oc: OcctModule,
  algo: OcctInstance,
  operands: ReadonlyArray<BooleanHistoryOperand>,
  resultShape: OcctInstance,
): NamedKernelFace[] {
  const resultFaces = uniqueFaces(oc, resultShape);
  const candidates: Array<Set<string>> = resultFaces.map(() => new Set());
  for (const op of operands) {
    for (const { face, name } of op.faces) {
      const qualified = qualifyName(op.featureId, name);
      try {
        if (algo.IsDeleted(face) as boolean) continue;
      } catch { /* keep going — IsSame/Modified below still decide */ }
      for (let i = 0; i < resultFaces.length; i++) {
        try {
          if (resultFaces[i].IsSame(face) as boolean) candidates[i].add(qualified);
        } catch { /* skip this pair */ }
      }
      try {
        for (const mShape of listToShapes(oc, algo.Modified(face) as OcctInstance)) {
          const idx = resultFaces.findIndex((rf) => {
            try { return rf.IsSame(mShape) as boolean; } catch { return false; }
          });
          if (idx >= 0) candidates[idx].add(qualified);
        }
      } catch { /* no modification history → unnamed */ }
    }
  }
  const out: NamedKernelFace[] = [];
  for (let i = 0; i < resultFaces.length; i++) {
    if (candidates[i].size === 1) {
      out.push({ face: resultFaces[i], name: [...candidates[i]][0] });
    }
  }
  return out;
}

// ─── bridge ─────────────────────────────────────────────────────────────────

export function createNodeOcctBridge(oc: OcctModule): OcctBridge {
  const m = maker(oc);
  const registry = new Map<string, OcctInstance>();
  /** Stable edge-name source per shape (primitive provenance or composed). */
  const topos = new Map<string, EdgeAnchorSource>();
  /** Stable face-name table per shape — feeds boolean seam keys (W3-A). */
  const faceTables = new Map<string, ReadonlyArray<NamedKernelFace>>();
  let seq = 0;

  const register = (
    shape: OcctInstance,
    topo?: EdgeAnchorSource,
    kind: OcctShapeKind = 'solid',
    faces?: ReadonlyArray<NamedKernelFace>,
  ): OcctShape => {
    const id = `occt_${++seq}`;
    registry.set(id, shape);
    if (topo) topos.set(id, topo);
    if (faces && faces.length > 0) faceTables.set(id, faces);
    // Volume is only meaningful for closed solids; lower-dim shapes (face/shell/
    // compound from a section) report it as undefined.
    const volume = kind === 'solid' ? volumeOf(oc, shape) : undefined;
    return { id, kind, volume, bbox: bboxOf(oc, shape) };
  };
  const result = (
    shape: OcctInstance,
    warnings: string[] = [],
    topo?: EdgeAnchorSource,
    kind: OcctShapeKind = 'solid',
    faces?: ReadonlyArray<NamedKernelFace>,
  ): OcctOperationResult => ({
    ok: true, shape: register(shape, topo, kind, faces), warnings,
  });
  const lookup = (s: OcctShape, where: string): OcctInstance => {
    const live = registry.get(s.id);
    if (!live) throw new Error(`${where}: shape ${s.id} not in registry (released?)`);
    return live;
  };

  const boolean: OcctBooleanOps = {
    async union(a, b, ids) { return runBool('Fuse', a, b, ids); },
    async subtract(a, b, ids) { return runBool('Cut', a, b, ids); },
    async intersect(a, b, ids) { return runBool('Common', a, b, ids); },
  };
  function runBool(kind: 'Fuse' | 'Cut' | 'Common', a: OcctShape, b: OcctShape, ids?: BooleanOperandIds): OcctOperationResult {
    try {
      const algo = m.inst(`BRepAlgoAPI_${kind}_3`, lookup(a, kind), lookup(b, kind));
      const shape = algo.Shape() as OcctInstance;
      // K2.2: re-derive a stable naming for the composed result by inheriting
      // the operands' edge names onto whichever edges survived the boolean.
      // W1-B: the inherited-name prefix is the operand's stable FEATURE id when
      // the caller provides one; the positional 'a'/'b' role is only the legacy
      // fallback (it degrades to explicit loss, never a silent mismatch).
      // W3-A: seams are named from the kernel's own Generated() history.
      const topoA = topos.get(a.id);
      const topoB = topos.get(b.id);
      const facesA = faceTables.get(a.id) ?? [];
      const facesB = faceTables.get(b.id) ?? [];
      const operands: BooleanHistoryOperand[] = [
        { featureId: ids?.baseId ?? 'a', faces: facesA },
        { featureId: ids?.toolId ?? 'b', faces: facesB },
      ];
      const haveFaces = facesA.length > 0 || facesB.length > 0;
      const resultEdges = uniqueEdges(oc, shape);
      const seamKeys = haveFaces ? booleanSeamKeys(oc, algo, operands, resultEdges) : undefined;
      let composed: EdgeAnchorSource | undefined;
      if (topoA || topoB) {
        const liveA = lookup(a, kind);
        const liveB = lookup(b, kind);
        // Kernel-history edge inheritance: trimmed operand edges keep their
        // names even though their anchors moved (Modified()).
        const historyInherited = booleanModifiedEdgeNames(oc, algo, [
          { featureId: ids?.baseId ?? 'a', namedEdges: namedKernelEdges(oc, liveA, topoA) },
          { featureId: ids?.toolId ?? 'b', namedEdges: namedKernelEdges(oc, liveB, topoB) },
        ], resultEdges);
        const inputA: BooleanInput = {
          ...(ids?.baseId ? { featureId: ids.baseId } : { role: 'a' }),
          names: topoA ? topoA.names() : [],
          anchorOf: (n) => (topoA ? topoA.anchor(n) : null),
        };
        const inputB: BooleanInput = {
          ...(ids?.toolId ? { featureId: ids.toolId } : { role: 'b' }),
          names: topoB ? topoB.names() : [],
          anchorOf: (n) => (topoB ? topoB.anchor(n) : null),
        };
        composed = composeBooleanTopo(
          [inputA, inputB],
          resultEdges.map((e) => e.mid),
          { opId: ids?.opId, seamKeys, historyInherited },
        );
      }
      const resultFaceTable = haveFaces
        ? propagateBooleanFaceNames(oc, algo, operands, shape)
        : undefined;
      return result(shape, [], composed, 'solid', resultFaceTable);
    } catch (e) {
      return { ok: false, error: `${kind}: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
    }
  }

  /**
   * Fillet/chamfer the selected edges. `edgeIds` are stable topoNaming names
   * (e.g. `e.vert.0`) resolved to a 3D anchor against the shape's stored
   * topology, then matched to the kernel's re-indexed edges by midpoint (K3).
   * `['sel:all']` rounds every edge (no topology needed).
   */
  /**
   * Resolve a list of stable edge names (or ['sel:all']) to live OCCT edges on
   * `shape`, IN INPUT ORDER (so callers can pair per-edge data like radii).
   * Returns the live shape + picked edges, or an error string.
   */
  function resolvePickedEdges(
    op: string,
    shape: OcctShape,
    edgeIds: string[],
  ): { live: OcctInstance; picked: OcctInstance[] } | { error: string } {
    let live: OcctInstance;
    try {
      live = lookup(shape, op);
    } catch (e) {
      return { error: `${op}: ${e instanceof Error ? e.message : String(e)}` };
    }
    const occtEdges = uniqueEdges(oc, live);
    if (edgeIds.length === 1 && edgeIds[0] === 'sel:all') {
      return { live, picked: occtEdges.map((e) => e.edge) };
    }
    const topo = topos.get(shape.id);
    if (!topo) {
      return { error: `${op}: shape ${shape.id} has no stable topology — name-based selection unavailable; use ['sel:all']` };
    }
    const mids = occtEdges.map((e) => e.mid);
    const picked: OcctInstance[] = [];
    const missing: string[] = [];
    for (const name of edgeIds) {
      const anchor = topo.anchor(name);
      if (!anchor) { missing.push(`${name} (unknown)`); continue; }
      const match = nearestByMidpoint(mids, anchor, 1e-3);
      if (match.index < 0) { missing.push(`${name} (no kernel edge near anchor)`); continue; }
      picked.push(occtEdges[match.index].edge);
    }
    if (missing.length) {
      return { error: `${op}: unresolved edges — ${missing.join(', ')}. known: ${topo.names().join(',')}` };
    }
    return { live, picked };
  }

  function roundEdges(
    op: 'fillet' | 'chamfer',
    shape: OcctShape,
    edgeIds: string[],
    size: number,
  ): OcctOperationResult {
    if (!(size > 0) || !Number.isFinite(size)) {
      return { ok: false, error: `${op} size must be positive finite, got ${size}`, warnings: [] };
    }
    const resolved = resolvePickedEdges(op, shape, edgeIds);
    if ('error' in resolved) return { ok: false, error: resolved.error, warnings: [] };
    const { live, picked } = resolved;
    if (picked.length === 0) {
      return { ok: false, error: `${op}: no edges selected`, warnings: [] };
    }

    try {
      // ChFi3d_Rational = 0 (second ctor arg) for fillet.
      const mk = op === 'fillet'
        ? m.inst('BRepFilletAPI_MakeFillet', live, 0)
        : m.inst('BRepFilletAPI_MakeChamfer', live);
      for (const edge of picked) mk.Add_2(size, edge);
      mk.Build();
      if (!(mk.IsDone() as boolean)) {
        return { ok: false, error: `${op}: kernel failed (radius/distance too large for edge?)`, warnings: [] };
      }
      return result(mk.Shape() as OcctInstance, [`${op}ed ${picked.length} edge(s) @ ${size}`]);
    } catch (e) {
      return { ok: false, error: `${op}: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
    }
  }

  /**
   * Variable-radius fillet: each named edge gets its OWN radius (BRepFilletAPI
   * MakeFillet.Add_2 per edge). The kernel blends the differing radii across
   * shared vertices. Real OCCT only — no stub/approx equivalent.
   */
  function variableFilletImpl(
    shape: OcctShape,
    edges: ReadonlyArray<{ edgeId: string; radius: number }>,
  ): OcctOperationResult {
    if (edges.length === 0) {
      return { ok: false, error: 'variableFillet: no edges given', warnings: [] };
    }
    for (const e of edges) {
      if (!(e.radius > 0) || !Number.isFinite(e.radius)) {
        return { ok: false, error: `variableFillet: radius for ${e.edgeId} must be positive finite, got ${e.radius}`, warnings: [] };
      }
    }
    const resolved = resolvePickedEdges('variableFillet', shape, edges.map((e) => e.edgeId));
    if ('error' in resolved) return { ok: false, error: resolved.error, warnings: [] };
    const { live, picked } = resolved;

    try {
      const mk = m.inst('BRepFilletAPI_MakeFillet', live, 0);
      picked.forEach((edge, i) => mk.Add_2(edges[i].radius, edge));
      mk.Build();
      if (!(mk.IsDone() as boolean)) {
        return { ok: false, error: 'variableFillet: kernel failed (radius too large for edge / blend conflict?)', warnings: [] };
      }
      return result(mk.Shape() as OcctInstance, [`variable-filleted ${picked.length} edge(s)`]);
    } catch (e) {
      return { ok: false, error: `variableFillet: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
    }
  }

  /** Outward unit normal of a planar face (null for non-planar / failure). */
  function planarFaceNormal(face: OcctInstance): Vec3 | null {
    try {
      const brepTool = oc.BRep_Tool as unknown as { Surface_2?: (f: unknown) => OcctInstance; Surface?: (f: unknown) => OcctInstance };
      const handle = (brepTool.Surface_2 ? brepTool.Surface_2(face) : brepTool.Surface!(face)) as OcctInstance;
      const surf = (typeof handle.get === 'function' ? handle.get() : handle) as OcctInstance;
      if (typeof surf.Pln !== 'function') return null; // non-planar
      const pln = surf.Pln() as OcctInstance;
      const dir = (pln.Axis() as OcctInstance).Direction() as OcctInstance;
      return { x: dir.X() as number, y: dir.Y() as number, z: dir.Z() as number };
    } catch {
      return null;
    }
  }

  /**
   * Draft (taper) the side walls of a solid for moulding/casting. Every planar
   * face whose normal is roughly perpendicular to the pull direction is tilted
   * by `angleDeg`, pivoting about the neutral plane (z = neutralZ, normal =
   * pull). Real OCCT BRepOffsetAPI_DraftAngle. Real-kernel only.
   */
  function draftImpl(
    shape: OcctShape,
    opts: { angleDeg: number; pullDir?: [number, number, number]; neutralZ?: number },
  ): OcctOperationResult {
    const angleDeg = opts.angleDeg;
    if (!Number.isFinite(angleDeg) || angleDeg <= 0 || angleDeg >= 90) {
      return { ok: false, error: `draft: angleDeg must be in (0, 90), got ${angleDeg}`, warnings: [] };
    }
    let live: OcctInstance;
    try {
      live = lookup(shape, 'draft');
    } catch (e) {
      return { ok: false, error: `draft: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
    }
    const pull = opts.pullDir ?? [0, 0, 1];
    const neutralZ = opts.neutralZ ?? 0;
    const angle = (angleDeg * Math.PI) / 180;

    try {
      const draft = m.inst('BRepOffsetAPI_DraftAngle_2', live);
      const pullDir = m.inst('gp_Dir_4', pull[0], pull[1], pull[2]);
      const neutralPln = m.inst('gp_Pln_3', m.inst('gp_Pnt_3', 0, 0, neutralZ), m.inst('gp_Dir_4', pull[0], pull[1], pull[2]));

      const shapeEnum = oc.TopAbs_ShapeEnum as unknown as { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
      const topoDS = oc.TopoDS as unknown as { Face_1: (s: unknown) => OcctInstance };
      const exp = m.inst('TopExp_Explorer_2', live, shapeEnum.TopAbs_FACE, shapeEnum.TopAbs_SHAPE);
      let added = 0;
      while (exp.More()) {
        const face = topoDS.Face_1(exp.Current());
        const n = planarFaceNormal(face);
        // Side wall: normal roughly perpendicular to the pull direction.
        if (n && Math.abs(n.x * pull[0] + n.y * pull[1] + n.z * pull[2]) < 0.5) {
          try {
            draft.Add(face, pullDir, angle, neutralPln, true);
            added++;
          } catch { /* face the kernel can't draft (e.g. already tapered) — skip */ }
        }
        exp.Next();
      }
      if (added === 0) {
        return { ok: false, error: 'draft: no draftable side faces found for the given pull direction', warnings: [] };
      }
      draft.Build();
      if (!(draft.IsDone() as boolean)) {
        return { ok: false, error: 'draft: kernel failed (angle too large / self-intersection?)', warnings: [] };
      }
      return result(draft.Shape() as OcctInstance, [`drafted ${added} wall(s) @ ${angleDeg}°`]);
    } catch (e) {
      return { ok: false, error: `draft: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
    }
  }

  /**
   * Thicken an open surface/shell into a solid of wall thickness `thickness`
   * via BRepOffsetAPI_MakeThickSolid.MakeThickSolidBySimple. The offset sign
   * the kernel accepts depends on the face orientation, so we try +t then −t and
   * keep whichever yields a finite non-zero volume. replicad cannot express this
   * (the kernel ceiling) — proven by ceilingSpike.thicken.test.ts (vol exact).
   */
  function thickenImpl(shape: OcctShape, thickness: number): OcctOperationResult {
    if (!(thickness > 0) || !Number.isFinite(thickness)) {
      return { ok: false, error: `thicken: thickness must be positive finite, got ${thickness}`, warnings: [] };
    }
    let live: OcctInstance;
    try {
      live = lookup(shape, 'thicken');
    } catch (e) {
      return { ok: false, error: `thicken: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
    }
    // The accepted offset sign depends on the face orientation: one sign yields
    // a correctly-oriented solid (+volume), the other an inside-out one
    // (−volume). Try both and PREFER the positively-oriented result.
    let solid: OcctInstance | null = null;
    let used = 0;
    let fallback: { shape: OcctInstance; off: number } | null = null;
    for (const off of [thickness, -thickness]) {
      try {
        const mts = m.inst('BRepOffsetAPI_MakeThickSolid_1');
        if (typeof mts.MakeThickSolidBySimple !== 'function') {
          return { ok: false, error: 'thicken: this OCCT build lacks MakeThickSolidBySimple', warnings: [] };
        }
        mts.MakeThickSolidBySimple(live, off);
        if (typeof mts.Build === 'function') mts.Build();
        if (typeof mts.IsDone === 'function' && !(mts.IsDone() as boolean)) continue;
        const s = mts.Shape() as OcctInstance;
        const v = volumeOf(oc, s);
        if (!Number.isFinite(v) || Math.abs(v) <= 1e-9) continue;
        if (v > 0) { solid = s; used = off; break; } // correctly oriented → done
        if (!fallback) fallback = { shape: s, off };  // keep the inverted one as a backup
      } catch {
        /* try the other offset sign */
      }
    }
    if (!solid && fallback) { solid = fallback.shape; used = fallback.off; }
    if (!solid) {
      return { ok: false, error: 'thicken: kernel produced no solid for ±thickness (degenerate surface?)', warnings: [] };
    }
    return result(solid, [`thickened surface → solid @ wall ${Math.abs(used)}`]);
  }

  /**
   * Surface–surface trim: the section (intersection curve) of two shapes via
   * BRepAlgoAPI_Section, returned as a compound of intersection edges. The mesh
   * path only does UV-space trim; this is the kernel-exact route.
   */
  function surfaceTrimImpl(a: OcctShape, b: OcctShape): OcctOperationResult {
    let liveA: OcctInstance, liveB: OcctInstance;
    try {
      liveA = lookup(a, 'surfaceTrim');
      liveB = lookup(b, 'surfaceTrim');
    } catch (e) {
      return { ok: false, error: `surfaceTrim: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
    }
    try {
      // BRepAlgoAPI_Section_3(S1, S2, PerformNow=true).
      const sec = m.inst('BRepAlgoAPI_Section_3', liveA, liveB, true);
      if (typeof sec.Build === 'function') sec.Build();
      const shape = sec.Shape() as OcctInstance;
      const edges = rawEdgeCount(oc, shape);
      if (edges === 0) {
        return { ok: false, error: 'surfaceTrim: shapes do not intersect (no section edges)', warnings: [] };
      }
      return result(shape, [`section: ${edges} intersection edge(s)`], undefined, 'compound');
    } catch (e) {
      return { ok: false, error: `surfaceTrim: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
    }
  }

  return {
    async buildPlanarFace(loop: ReadonlyArray<{ x: number; y: number }>, z = 0) {
      if (loop.length < 3) {
        return { ok: false, error: `buildPlanarFace: loop must have ≥3 points, got ${loop.length}`, warnings: [] };
      }
      try {
        const face = buildFace(oc, loop, z);
        return result(face, ['planar surface (sheet body)'], undefined, 'face');
      } catch (e) {
        return { ok: false, error: `buildPlanarFace: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
      }
    },

    async buildPlanarFaceOriented(loop: ReadonlyArray<{ x: number; y: number }>, origin: V3, normal: V3) {
      if (loop.length < 3) {
        return { ok: false, error: `buildPlanarFaceOriented: loop must have ≥3 points, got ${loop.length}`, warnings: [] };
      }
      try {
        const face = buildFaceOriented(oc, loop, origin, normal);
        return result(face, ['oriented planar surface'], undefined, 'face');
      } catch (e) {
        return { ok: false, error: `buildPlanarFaceOriented: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
      }
    },

    async thicken(shape, thickness) {
      return thickenImpl(shape, thickness);
    },
    async surfaceTrim(a, b) {
      return surfaceTrimImpl(a, b);
    },

    async buildFromExtrude(feature: ExtrudeFeature) {
      try {
        const { z0, h } = extrudeZRange(feature);
        const shape = buildPrism(oc, feature.loop, z0, h);
        // Stable-named topology so fillet/chamfer can pick edges by name (K3).
        const topo = buildExtrudeTopo(feature);
        const anchors = new Map<string, Vec3>();
        for (const name of namesOf(topo, 'edge')) {
          const mid = edgeMidpoint(topo, name);
          if (mid) anchors.set(name, mid);
        }
        // Face-name table (f.cap.*, f.side.i) — feeds kernel-history seam
        // naming when this shape becomes a boolean operand (W3-A).
        const faces = classifyPrismFaces(oc, shape, feature.loop, z0, z0 + h);
        return result(shape, [], fromAnchors(anchors), 'solid', faces);
      } catch (e) {
        return { ok: false, error: `extrude: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
      }
    },

    async buildFromRevolve(feature: RevolveFeature) {
      try {
        // Profile (X≥0, axis = Y) revolved about the Y axis.
        const poly = m.inst('BRepBuilderAPI_MakePolygon_1');
        for (const p of feature.loop) poly.Add_1(m.inst('gp_Pnt_3', p.x, p.y, 0));
        poly.Close();
        const face = m.inst('BRepBuilderAPI_MakeFace_15', poly.Wire(), false).Face() as OcctInstance;
        const axis = m.inst('gp_Ax1_2', m.inst('gp_Pnt_3', 0, 0, 0), m.inst('gp_Dir_4', 0, 1, 0));
        const angle = (Math.max(0, Math.min(360, feature.angleDegrees)) * Math.PI) / 180;
        const revol = m.inst('BRepPrimAPI_MakeRevol_1', face, axis, angle, false);
        // W3 통합 배선: revolve 위상 명명 등록 — W3-B 의 생성-이력 명명(755케이스 오매칭 0
        // 실측)을 브리지에 물려 revolve 부품에도 이름 기반 참조(필렛 선택 등)가 발화한다.
        // 명명 실패(위반 입력 등)는 topo 없이 등록 → 이름 선택 시 종전대로 명시 거부(D1).
        let revTopo: EdgeAnchorSource | undefined;
        try { revTopo = fromAnchors(revolveEdgeAnchors(buildRevolveTopo(feature))); } catch { revTopo = undefined; }
        return result(revol.Shape() as OcctInstance, [], revTopo);
      } catch (e) {
        return { ok: false, error: `revolve: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
      }
    },

    boolean,

    async fillet(shape, edgeIds, radius) {
      return roundEdges('fillet', shape, edgeIds, radius);
    },
    async chamfer(shape, edgeIds, distance) {
      return roundEdges('chamfer', shape, edgeIds, distance);
    },
    async variableFillet(shape, edges) {
      return variableFilletImpl(shape, edges);
    },
    async draft(shape, opts) {
      return draftImpl(shape, opts);
    },
    async exportSTEP(shape: OcctShape): Promise<string> {
      const live = lookup(shape, 'exportSTEP');
      const fs = (oc as unknown as { FS: OcctFS }).FS;
      const modelType = oc.STEPControl_StepModelType as unknown as { STEPControl_AsIs: unknown };
      const path = STEP_WRITE_PATH;
      const writer = m.inst('STEPControl_Writer_1');
      writer.Transfer(live, modelType.STEPControl_AsIs, true);
      writer.Write(path);
      const text = fs.readFile(path, { encoding: 'utf8' });
      // STEPControl_Writer/Reader share a global XSControl session — a leaked
      // instance corrupts the next read. Free it so only one is ever live.
      if (typeof writer.delete === 'function') writer.delete();
      try { fs.unlink(path); } catch { /* best-effort cleanup */ }
      if (typeof text !== 'string' || !text.startsWith('ISO-10303-21')) {
        throw new Error(`exportSTEP: writer produced no STEP for ${shape.id}`);
      }
      return text;
    },
    async importSTEP(source: string): Promise<OcctOperationResult> {
      try {
        const fs = (oc as unknown as { FS: OcctFS }).FS;
        const path = STEP_READ_PATH;
        fs.writeFile(path, source);
        const reader = m.inst('STEPControl_Reader_1');
        const status = reader.ReadFile(path);
        // Distinguish a PARSE failure (RetError/RetFail) from a successfully
        // parsed-but-empty model. Real-world AP203/AP214/AP242 exported by CAD
        // tools (Rhino, SolidWorks, …) can return RetError here: this
        // opencascade.js build's STEP reader cannot parse every schema variant
        // (both STEPControl_ and STEPCAFControl_Reader fail identically). The
        // mesh path (occt-import-js `ReadStepFile`) handles those files — so
        // surface an actionable error instead of a misleading "no roots".
        const retDone = (oc as unknown as { IFSelect_ReturnStatus?: { IFSelect_RetDone?: unknown } })
          .IFSelect_ReturnStatus?.IFSelect_RetDone;
        if (retDone !== undefined && status !== retDone) {
          if (typeof reader.delete === 'function') reader.delete();
          try { fs.unlink(path); } catch { /* best-effort cleanup */ }
          return {
            ok: false,
            error: 'importSTEP: this STEP could not be parsed as B-rep by the kernel — import it as a mesh instead',
            warnings: [],
          };
        }
        const n = reader.TransferRoots() as number;
        if (!n || n < 1) {
          if (typeof reader.delete === 'function') reader.delete();
          try { fs.unlink(path); } catch { /* best-effort cleanup */ }
          return { ok: false, error: 'importSTEP: no transferable roots in STEP', warnings: [] };
        }
        const imported = reader.OneShape() as OcctInstance;
        // Register (copies volume/bbox) before freeing the reader; the underlying
        // TopoDS_Shape is refcounted so it survives the reader's release.
        const out = result(imported, ['imported B-rep — no stable edge names (use sel:all)']);
        if (typeof reader.delete === 'function') reader.delete();
        try { fs.unlink(path); } catch { /* best-effort cleanup */ }
        return out;
      } catch (e) {
        return { ok: false, error: `importSTEP: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
      }
    },
    async tessellate(shape: OcctShape, deflection = 0.1) {
      try {
        const live = lookup(shape, 'tessellate');
        const mesh = tessellateToMesh(oc, live, deflection);
        if (mesh.triangleCount === 0) {
          return { ok: false, error: `tessellate: empty mesh for ${shape.id}`, warnings: [] };
        }
        return { ok: true, mesh, warnings: [] };
      } catch (e) {
        return { ok: false, error: `tessellate: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
      }
    },

    release(shape: OcctShape) {
      const live = registry.get(shape.id);
      if (live && typeof live.delete === 'function') live.delete();
      registry.delete(shape.id);
      topos.delete(shape.id);
      faceTables.delete(shape.id);
    },
  };
}
