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

import type { OcctBridge, OcctBooleanOps } from './bridge';
import type { OcctShape, OcctOperationResult, Vec3 } from './types';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { OcctModule } from './nodeOcctLoader';
import { buildExtrudeTopo, edgeMidpoint, namesOf, type NamedTopology } from '@/lib/cad/topoNaming';
import { nearestByMidpoint } from '@/lib/cad/edgeMatch';

// ─── embind typing helpers (no `any`) ──────────────────────────────────────

type OcctInstance = Record<string, (...args: unknown[]) => unknown>;
type OcctCtor = new (...args: unknown[]) => OcctInstance;

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

/** Closed prism solid from a 2D loop at z0, extruded `h` along +Z. */
function buildPrism(oc: OcctModule, loop: ReadonlyArray<{ x: number; y: number }>, z0: number, h: number): OcctInstance {
  const m = maker(oc);
  const poly = m.inst('BRepBuilderAPI_MakePolygon_1');
  for (const p of loop) poly.Add_1(m.inst('gp_Pnt_3', p.x, p.y, z0));
  poly.Close();
  const wire = poly.Wire();
  const face = (m.inst('BRepBuilderAPI_MakeFace_15', wire, false).Face()) as OcctInstance;
  const vec = m.inst('gp_Vec_4', 0, 0, h);
  return m.inst('BRepPrimAPI_MakePrism_1', face, vec, false, true).Shape() as OcctInstance;
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

// ─── bridge ─────────────────────────────────────────────────────────────────

export function createNodeOcctBridge(oc: OcctModule): OcctBridge {
  const m = maker(oc);
  const registry = new Map<string, OcctInstance>();
  /** Stable-named topology of shapes built directly from a primitive feature. */
  const topos = new Map<string, NamedTopology>();
  let seq = 0;

  const register = (shape: OcctInstance, topo?: NamedTopology): OcctShape => {
    const id = `occt_${++seq}`;
    registry.set(id, shape);
    if (topo) topos.set(id, topo);
    return { id, kind: 'solid', volume: volumeOf(oc, shape), bbox: bboxOf(oc, shape) };
  };
  const result = (shape: OcctInstance, warnings: string[] = [], topo?: NamedTopology): OcctOperationResult => ({
    ok: true, shape: register(shape, topo), warnings,
  });
  const lookup = (s: OcctShape, where: string): OcctInstance => {
    const live = registry.get(s.id);
    if (!live) throw new Error(`${where}: shape ${s.id} not in registry (released?)`);
    return live;
  };

  const boolean: OcctBooleanOps = {
    async union(a, b) { return runBool('Fuse', a, b); },
    async subtract(a, b) { return runBool('Cut', a, b); },
    async intersect(a, b) { return runBool('Common', a, b); },
  };
  function runBool(kind: 'Fuse' | 'Cut' | 'Common', a: OcctShape, b: OcctShape): OcctOperationResult {
    try {
      const algo = m.inst(`BRepAlgoAPI_${kind}_3`, lookup(a, kind), lookup(b, kind));
      return result(algo.Shape() as OcctInstance);
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
  function roundEdges(
    op: 'fillet' | 'chamfer',
    shape: OcctShape,
    edgeIds: string[],
    size: number,
  ): OcctOperationResult {
    if (!(size > 0) || !Number.isFinite(size)) {
      return { ok: false, error: `${op} size must be positive finite, got ${size}`, warnings: [] };
    }
    let live: OcctInstance;
    try {
      live = lookup(shape, op);
    } catch (e) {
      return { ok: false, error: `${op}: ${e instanceof Error ? e.message : String(e)}`, warnings: [] };
    }

    const occtEdges = uniqueEdges(oc, live);
    const all = edgeIds.length === 1 && edgeIds[0] === 'sel:all';

    // Resolve the requested edges (or take all of them).
    let picked: OcctInstance[];
    if (all) {
      picked = occtEdges.map((e) => e.edge);
    } else {
      const topo = topos.get(shape.id);
      if (!topo) {
        return {
          ok: false,
          error: `${op}: shape ${shape.id} has no stable topology (composed/boolean result) — name-based selection needs K2.2; use ['sel:all']`,
          warnings: [],
        };
      }
      const mids = occtEdges.map((e) => e.mid);
      picked = [];
      const missing: string[] = [];
      for (const name of edgeIds) {
        const anchor = edgeMidpoint(topo, name);
        if (!anchor) { missing.push(`${name} (unknown)`); continue; }
        const match = nearestByMidpoint(mids, anchor, 1e-3);
        if (match.index < 0) { missing.push(`${name} (no kernel edge near anchor)`); continue; }
        picked.push(occtEdges[match.index].edge);
      }
      if (missing.length) {
        return { ok: false, error: `${op}: unresolved edges — ${missing.join(', ')}. known: ${namesOf(topo, 'edge').join(',')}`, warnings: [] };
      }
    }
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

  return {
    async buildFromExtrude(feature: ExtrudeFeature) {
      try {
        const { z0, h } = extrudeZRange(feature);
        const shape = buildPrism(oc, feature.loop, z0, h);
        // Stable-named topology so fillet/chamfer can pick edges by name (K3).
        return result(shape, [], buildExtrudeTopo(feature));
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
        return result(revol.Shape() as OcctInstance);
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
    async exportSTEP() {
      throw new Error('exportSTEP via OCCT is K4 — not implemented');
    },
    async importSTEP() {
      return { ok: false, error: 'importSTEP via OCCT is K4 — not implemented', warnings: [] };
    },
    release(shape: OcctShape) {
      const live = registry.get(shape.id);
      if (live && typeof live.delete === 'function') live.delete();
      registry.delete(shape.id);
    },
  };
}
