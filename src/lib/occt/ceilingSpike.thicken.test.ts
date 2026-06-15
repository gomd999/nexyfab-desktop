// @vitest-environment node
/**
 * ceilingSpike — ADR-014 de-risking spike (Tier 0, 2026-06-08).
 *
 * PURPOSE: prove that the real `opencascade.js` K-series (loaded headless in
 * Node) can perform the kernel ops that replicad's high-level API CANNOT —
 * the "kernel ceiling" documented in
 * `docs/strategy/3D_MODELER_STATUS_AND_ROADMAP.md` §3:
 *
 *   1. THICKEN a surface (open sheet) → a solid          (BRepOffsetAPI_MakeThickSolid)
 *   2. SURFACE–SURFACE TRIM (section curve between faces)  (BRepAlgoAPI_Section)
 *
 * Both are verified numerically (volume of the thickened solid; non-empty
 * intersection edges from the section). A green run is the evidence that
 * promoting the K-series to the UI kernel (path b) closes a real gap — i.e. it
 * is worth the migration, BEFORE committing to it.
 *
 * This is a SPIKE, not production wiring: it operates on the raw `oc` module
 * with defensive signature probing so it self-reports which embind variants
 * this build exposes. If the wasm is unavailable it skips (like the sibling
 * nodeOcctBridge tests). Run: `npx vitest run ceilingSpike.thicken`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcctNode } from './nodeOcctLoader';
import type { OcctModule } from './nodeOcctLoader';

type OcctInstance = Record<string, (...args: unknown[]) => unknown>;
type OcctCtor = new (...args: unknown[]) => OcctInstance;

let oc: OcctModule | null = null;

beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) oc = r.oc;
  else console.warn(`[ceilingSpike] skipped — ${r.reason}`);
}, 60_000);

/** Construct an embind class by trying a list of variant names in order. */
function instAny(mod: OcctModule, names: string[], ...args: unknown[]): { inst: OcctInstance; name: string } {
  const tried: string[] = [];
  for (const n of names) {
    const Ctor = mod[n] as OcctCtor | undefined;
    if (typeof Ctor === 'function') {
      try {
        return { inst: new Ctor(...args), name: n };
      } catch (e) {
        tried.push(`${n}(${e instanceof Error ? e.message : String(e)})`);
      }
    } else {
      tried.push(`${n}(absent)`);
    }
  }
  throw new Error(`no usable ctor among [${names.join(', ')}] — tried: ${tried.join('; ')}`);
}

function inst(mod: OcctModule, name: string, ...args: unknown[]): OcctInstance {
  const Ctor = mod[name] as OcctCtor;
  if (typeof Ctor !== 'function') throw new Error(`ctor ${name} absent`);
  return new Ctor(...args);
}
function stat(mod: OcctModule, name: string): OcctInstance {
  return mod[name] as unknown as OcctInstance;
}

/** Volume (mass with unit density) of a solid via BRepGProp. */
function volumeOf(mod: OcctModule, shape: OcctInstance): number {
  const props = inst(mod, 'GProp_GProps_1');
  stat(mod, 'BRepGProp').VolumeProperties_1(shape, props, false, false, false);
  return props.Mass() as number;
}

/** A planar rectangular FACE (sheet/surface body) at z=`z`, corners (0,0)-(w,h). */
function makeRectFace(mod: OcctModule, w: number, h: number, z: number): OcctInstance {
  const poly = inst(mod, 'BRepBuilderAPI_MakePolygon_1');
  poly.Add_1(inst(mod, 'gp_Pnt_3', 0, 0, z));
  poly.Add_1(inst(mod, 'gp_Pnt_3', w, 0, z));
  poly.Add_1(inst(mod, 'gp_Pnt_3', w, h, z));
  poly.Add_1(inst(mod, 'gp_Pnt_3', 0, h, z));
  poly.Close();
  return inst(mod, 'BRepBuilderAPI_MakeFace_15', poly.Wire(), false).Face() as OcctInstance;
}

/** Count edges in a shape (TopExp_Explorer over TopAbs_EDGE). */
function edgeCount(mod: OcctModule, shape: OcctInstance): number {
  const en = mod.TopAbs_ShapeEnum as unknown as { TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
  const exp = inst(mod, 'TopExp_Explorer_2', shape, en.TopAbs_EDGE, en.TopAbs_SHAPE);
  let n = 0;
  while (exp.More()) { n++; exp.Next(); }
  return n;
}

describe('ADR-014 ceiling spike — real OCCT does what replicad cannot', () => {
  it('introspects which ceiling-op embind variants this build exposes', () => {
    if (!oc) return;
    const probe = (base: string): string[] =>
      Object.keys(oc as object).filter((k) => k === base || k.startsWith(`${base}_`)).sort();
    const report = {
      MakeThickSolid: probe('BRepOffsetAPI_MakeThickSolid'),
      MakeOffsetShape: probe('BRepOffsetAPI_MakeOffsetShape'),
      MakeOffset: probe('BRepOffset_MakeOffset'),
      Section: probe('BRepAlgoAPI_Section'),
      Sewing: probe('BRepBuilderAPI_Sewing'),
    };
    console.log('[ceilingSpike] available ceiling-op ctors:', JSON.stringify(report, null, 2));
    // At minimum the thick-solid and section classes must be present for path (b).
    expect(report.MakeThickSolid.length + report.MakeOffset.length).toBeGreaterThan(0);
    expect(report.Section.length).toBeGreaterThan(0);
  });

  it('CEILING #1: thickens an open surface (face) into a solid with the expected volume', () => {
    if (!oc) return;
    const mod = oc;
    const W = 10, H = 10, T = 2;
    const face = makeRectFace(mod, W, H, 0);

    // BRepOffsetAPI_MakeThickSolid: default-construct, then MakeThickSolidBySimple
    // (offsets an open shell/face into a thin solid of wall thickness |T|).
    const { inst: mts, name } = instAny(mod, [
      'BRepOffsetAPI_MakeThickSolid_1',
      'BRepOffsetAPI_MakeThickSolid',
    ]);
    console.log(`[ceilingSpike] using ${name}.MakeThickSolidBySimple`);
    if (typeof mts.MakeThickSolidBySimple !== 'function') {
      throw new Error('this build has no MakeThickSolidBySimple — record for ADR-014 (try ByJoin / BRepOffset_MakeOffset)');
    }

    let solid: OcctInstance | null = null;
    for (const off of [T, -T]) {
      try {
        mts.MakeThickSolidBySimple(face, off);
        if (typeof mts.Build === 'function') mts.Build(); // no-arg Build works in this build (see draftImpl)
        if (typeof mts.IsDone === 'function' && !(mts.IsDone() as boolean)) continue;
        const s = mts.Shape() as OcctInstance;
        const v = volumeOf(mod, s);
        if (Number.isFinite(v) && Math.abs(v) > 1e-6) { solid = s; break; }
      } catch {
        /* try the other offset sign */
      }
    }
    expect(solid, 'MakeThickSolidBySimple produced no solid for ±T').not.toBeNull();

    const vol = Math.abs(volumeOf(mod, solid!));
    // Thickening a flat 10×10 sheet by 2 → a slab ≈ 10×10×2 = 200.
    console.log(`[ceilingSpike] thickened-surface volume = ${vol.toFixed(3)} (expect ≈ ${W * H * T})`);
    expect(vol).toBeGreaterThan(W * H * T * 0.6); // generous: edge rounding/caps vary by build
    expect(vol).toBeLessThan(W * H * T * 1.6);
    expect(edgeCount(mod, solid!)).toBeGreaterThanOrEqual(4); // a real B-rep solid, not a sheet
  });

  it('CEILING #2: surface–surface trim — section of two crossing faces yields intersection edges', () => {
    if (!oc) return;
    const mod = oc;
    // Two large planar faces that cross: one in the XY plane (z=0), one we build
    // in a vertical plane. Their BRepAlgoAPI_Section is the trim/intersection curve.
    const flat = makeRectFace(mod, 20, 20, 0); // z = 0 plane patch over (0..20, 0..20)

    // Vertical face in the plane y = 10, spanning x:0..20, z:-5..5.
    const poly = inst(mod, 'BRepBuilderAPI_MakePolygon_1');
    poly.Add_1(inst(mod, 'gp_Pnt_3', 0, 10, -5));
    poly.Add_1(inst(mod, 'gp_Pnt_3', 20, 10, -5));
    poly.Add_1(inst(mod, 'gp_Pnt_3', 20, 10, 5));
    poly.Add_1(inst(mod, 'gp_Pnt_3', 0, 10, 5));
    poly.Close();
    const vert = inst(mod, 'BRepBuilderAPI_MakeFace_15', poly.Wire(), false).Face() as OcctInstance;

    // BRepAlgoAPI_Section_3(theShape1, theShape2, PerformNow=true).
    const sec = inst(mod, 'BRepAlgoAPI_Section_3', flat, vert, true);
    console.log('[ceilingSpike] using BRepAlgoAPI_Section_3 for surface-surface section');
    if (typeof sec.Build === 'function') sec.Build();
    const result = sec.Shape() as OcctInstance;
    const edges = edgeCount(mod, result);
    // The two faces cross along the line y=10, x:0..20 → at least one section edge.
    console.log(`[ceilingSpike] section produced ${edges} intersection edge(s)`);
    expect(edges).toBeGreaterThanOrEqual(1);
  });
});
