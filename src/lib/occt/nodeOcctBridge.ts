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

// ─── bridge ─────────────────────────────────────────────────────────────────

export function createNodeOcctBridge(oc: OcctModule): OcctBridge {
  const m = maker(oc);
  const registry = new Map<string, OcctInstance>();
  let seq = 0;

  const register = (shape: OcctInstance): OcctShape => {
    const id = `occt_${++seq}`;
    registry.set(id, shape);
    return { id, kind: 'solid', volume: volumeOf(oc, shape), bbox: bboxOf(oc, shape) };
  };
  const result = (shape: OcctInstance, warnings: string[] = []): OcctOperationResult => ({
    ok: true, shape: register(shape), warnings,
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

  return {
    async buildFromExtrude(feature: ExtrudeFeature) {
      try {
        const { z0, h } = extrudeZRange(feature);
        return result(buildPrism(oc, feature.loop, z0, h));
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

    async fillet() {
      return { ok: false, error: 'fillet needs stable edge ids (K2) — not implemented', warnings: [] };
    },
    async chamfer() {
      return { ok: false, error: 'chamfer needs stable edge ids (K2) — not implemented', warnings: [] };
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
