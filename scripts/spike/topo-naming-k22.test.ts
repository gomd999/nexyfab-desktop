// @vitest-environment node
/**
 * ADR-017 §D2 — 위상 명명 K2.2 스파이크 (MEASUREMENT ONLY).
 *
 * MEASURES the current state of the two naming systems. Changes nothing,
 * asserts almost nothing — emits numbers to `topo-naming-k22.result.json`.
 *
 * Systems under test
 * ──────────────────
 *  A) PROVENANCE naming — `src/lib/cad/topoNaming.ts` (extrude primitives) +
 *     `composedTopo.ts` (boolean inheritance, W1-B feature-id prefixes, W3-A
 *     kernel-history seam keys from `BRepAlgoAPI.Generated()`), resolved
 *     through `edgeMatch.nearestByMidpoint(tol 1e-3)`. This replicates
 *     `nodeOcctBridge.resolvePickedEdges` / `runBool` exactly, via the same
 *     exported history helpers the shipping bridge uses.
 *     A reference is a stable NAME.
 *  B) GEOMETRIC SIGNATURE — `edgeCorrespondence.bestEdgeMatch` +
 *     `topologyEdgeFinder.remapPointThroughBbox` (the shape-generator path).
 *     A reference is a stored (mid, dir, length) + the authoring bbox.
 *
 * Ground truth is GEOMETRIC and independent of both systems: every part comes
 * from a parametric recipe whose edge midpoints are known analytically, so for
 * any config we compute where a semantic edge MUST be and take the kernel edge
 * sitting there (1e-6). Verdicts:
 *   ok       — resolved index === ground-truth index
 *   lost     — system explicitly said "no match" (index < 0)   ← acceptable (D1)
 *   mismatch — system silently returned a DIFFERENT kernel edge ← FATAL (D1)
 *   nogt     — the edge genuinely no longer exists; excluded from rates
 *
 * Deliberately adversarial part families (a box at the origin is a trivial case
 * and scores 100% for both systems — see `box`): negative coordinates, an
 * L-shaped profile, a skewed profile whose edge DIRECTIONS change with a
 * parameter, off-centre holes that move independently of the outer dimensions,
 * a blind pocket with short vertical edges, and a corner hole placed to bait
 * the signature matcher.
 */
import { describe, it, beforeAll, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { loadOcctNode, type OcctModule } from '@/lib/occt/nodeOcctLoader';
import {
  createNodeOcctBridge, classifyPrismFaces, booleanSeamKeys, propagateBooleanFaceNames,
  booleanModifiedEdgeNames, namedKernelEdges,
  type NamedKernelFace,
} from '@/lib/occt/nodeOcctBridge';
import type { OcctBridge } from '@/lib/occt/bridge';
import { buildExtrudeTopo, edgeMidpoint, namesOf } from '@/lib/cad/topoNaming';
import { composeBooleanTopo, fromAnchors, type EdgeAnchorSource } from '@/lib/cad/composedTopo';
import { nearestByMidpoint } from '@/lib/cad/edgeMatch';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import { applyEdit } from '@/lib/cad/featureTreeEdit';
import { featureTreeToOcctPlan } from '@/lib/occt/featurePlan';
import { executeOcctPlan } from '@/lib/occt/planExecutor';
import { bestEdgeMatch, type EdgeSig } from '../../src/app/[lang]/shape-generator/features/edgeCorrespondence';
import { remapPointThroughBbox, type BBox3 } from '../../src/app/[lang]/shape-generator/features/topologyEdgeFinder';

// ─── basics ───────────────────────────────────────────────────────────────

type V3 = { x: number; y: number; z: number };
type P2 = { x: number; y: number };
type Verdict = 'ok' | 'lost' | 'mismatch' | 'nogt';
type OcctInstance = Record<string, (...a: unknown[]) => unknown>;

interface Tally { cases: number; ok: number; lost: number; mismatch: number; nogt: number }
const newTally = (): Tally => ({ cases: 0, ok: 0, lost: 0, mismatch: 0, nogt: 0 });
const bump = (t: Tally, v: Verdict) => { t.cases++; t[v]++; };
const merge = (...ts: Tally[]): Tally => ts.reduce((a, b) => ({
  cases: a.cases + b.cases, ok: a.ok + b.ok, lost: a.lost + b.lost,
  mismatch: a.mismatch + b.mismatch, nogt: a.nogt + b.nogt,
}), newTally());
function rates(t: Tally) {
  const n = t.cases - t.nogt;
  const pct = (x: number) => (n > 0 ? Number(((x / n) * 100).toFixed(1)) : null);
  return { ...t, scored: n, survivalPct: pct(t.ok), lostPct: pct(t.lost), mismatchPct: pct(t.mismatch) };
}
const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ─── kernel helpers ───────────────────────────────────────────────────────

let oc: OcctModule | null = null;
let bridge: OcctBridge;
let loadReason = '';

const ctor = (n: string) => oc![n] as unknown as new (...a: unknown[]) => OcctInstance;
const inst = (n: string, ...a: unknown[]) => new (ctor(n))(...a);

interface KEdge { mid: V3; dir: [number, number, number]; length: number; edge: OcctInstance }

/** Unique kernel edges. Dedupe key REPLICATES `nodeOcctBridge.uniqueEdges`
 *  (round to 1e-3), so System A's indices match the shipping bridge's. */
function kernelEdges(shape: OcctInstance): KEdge[] {
  const en = oc!.TopAbs_ShapeEnum as unknown as { TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
  const topoDS = oc!.TopoDS as unknown as { Edge_1: (s: unknown) => OcctInstance };
  const exp = inst('TopExp_Explorer_2', shape, en.TopAbs_EDGE, en.TopAbs_SHAPE);
  const seen = new Set<string>();
  const out: KEdge[] = [];
  while (exp.More()) {
    const edge = topoDS.Edge_1(exp.Current());
    const curve = inst('BRepAdaptor_Curve_2', edge);
    const t0 = curve.FirstParameter() as number, t1 = curve.LastParameter() as number;
    const at = (t: number) => { const p = curve.Value(t) as OcctInstance; return { x: p.X() as number, y: p.Y() as number, z: p.Z() as number }; };
    const mid = at((t0 + t1) / 2), p0 = at(t0), p1 = at(t1);
    const key = `${Math.round(mid.x * 1000)},${Math.round(mid.y * 1000)},${Math.round(mid.z * 1000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
      const len = Math.hypot(dx, dy, dz);
      out.push({ mid, dir: len > 1e-12 ? [dx / len, dy / len, dz / len] : [0, 0, 0], length: len, edge });
    }
    exp.Next();
  }
  return out;
}

function prismFromLoop(loop: ReadonlyArray<P2>, z0: number, h: number): OcctInstance {
  const poly = inst('BRepBuilderAPI_MakePolygon_1');
  for (const p of loop) poly.Add_1(inst('gp_Pnt_3', p.x, p.y, z0));
  poly.Close();
  const face = inst('BRepBuilderAPI_MakeFace_15', poly.Wire(), false).Face() as OcctInstance;
  return inst('BRepPrimAPI_MakePrism_1', face, inst('gp_Vec_4', 0, 0, h), false, true).Shape() as OcctInstance;
}
const cutShapes = (a: OcctInstance, b: OcctInstance) => new (ctor('BRepAlgoAPI_Cut_3'))(a, b).Shape() as OcctInstance;

function bboxOfRaw(shape: OcctInstance): BBox3 {
  const box = inst('Bnd_Box_1');
  (oc!.BRepBndLib as unknown as OcctInstance).Add(shape, box, false);
  const lo = box.CornerMin() as OcctInstance, hi = box.CornerMax() as OcctInstance;
  return { min: [lo.X() as number, lo.Y() as number, lo.Z() as number], max: [hi.X() as number, hi.Y() as number, hi.Z() as number] };
}

function groundTruthIndex(edges: KEdge[], expected: V3, tol = 1e-6): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < edges.length; i++) { const d = dist(edges[i].mid, expected); if (d < bd) { bd = d; best = i; } }
  return bd <= tol ? best : -1;
}
const toSig = (e: KEdge): EdgeSig => ({ mid: [e.mid.x, e.mid.y, e.mid.z], dir: e.dir, length: e.length });

// ─── parametric part model ────────────────────────────────────────────────

interface Solid { loop: P2[]; z0: number; z1: number }
interface Part { base: Solid; tools: Array<Solid & { id: string }> }

/** Config knobs. Different families read different subsets. */
interface Cfg { w: number; d: number; h: number; skew: number; holeX: number; holeY: number }
const BASE_CFG: Cfg = { w: 40, d: 30, h: 20, skew: 0.30, holeX: 0.50, holeY: 0.50 };

const featOf = (s: Solid, mode: 'add' | 'cut'): ExtrudeFeature =>
  ({ kind: 'extrude', loop: s.loop, depth: s.z1 - s.z0, direction: 'one_sided', mode }) as ExtrudeFeature;

/** Square tool loop centred at (cx,cy) with half-side a. */
const sq = (cx: number, cy: number, a: number): P2[] =>
  [{ x: cx - a, y: cy - a }, { x: cx + a, y: cy - a }, { x: cx + a, y: cy + a }, { x: cx - a, y: cy + a }];

type Family = 'box' | 'lshape' | 'skew' | 'movingHole' | 'blindPocket' | 'cornerHoleBait';

function buildPart(fam: Family, c: Cfg): Part {
  const w = c.w, d = c.d, h = c.h;
  // All families are CENTRED on the origin → negative coordinates everywhere
  // (the origin-anchored positive-octant box is the easy case; see `box`).
  const rect: P2[] = [{ x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }];
  const zBase = { z0: -h / 2, z1: h / 2 };
  const through = { z0: -h, z1: h };

  switch (fam) {
    case 'box':
      return { base: { loop: rect, ...zBase }, tools: [] };

    case 'lshape': {
      // 6-vertex re-entrant profile; the notch scales with w,d.
      const loop: P2[] = [
        { x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 + d * 0.40 },
        { x: -w / 2 + w * 0.40, y: -d / 2 + d * 0.40 }, { x: -w / 2 + w * 0.40, y: d / 2 }, { x: -w / 2, y: d / 2 },
      ];
      return { base: { loop, ...zBase }, tools: [] };
    }

    case 'skew': {
      // Parallelogram: `skew` tilts the two side edges, so their DIRECTION is a
      // function of the parameter — not just their position.
      const s = c.skew * w;
      const loop: P2[] = [
        { x: -w / 2 - s / 2, y: -d / 2 }, { x: w / 2 - s / 2, y: -d / 2 },
        { x: w / 2 + s / 2, y: d / 2 }, { x: -w / 2 + s / 2, y: d / 2 },
      ];
      return { base: { loop, ...zBase }, tools: [] };
    }

    case 'movingHole': {
      // Through hole whose CENTRE is its own parameter (holeX/holeY as a
      // fraction of the part), so it slides independently of the outer size.
      const a = Math.min(w, d) * 0.13;
      const cx = -w / 2 + c.holeX * w, cy = -d / 2 + c.holeY * d;
      return { base: { loop: rect, ...zBase }, tools: [{ id: 'H0', loop: sq(cx, cy, a), ...through }] };
    }

    case 'blindPocket': {
      // Through hole + a BLIND pocket open at the top: the pocket's vertical
      // edges are short (h/3) and parallel to the part's own vertical edges.
      const a = Math.min(w, d) * 0.12;
      const cx = -w / 2 + c.holeX * w, cy = -d / 2 + c.holeY * d;
      return {
        base: { loop: rect, ...zBase },
        tools: [
          { id: 'H0', loop: sq(cx, cy, a), ...through },
          { id: 'P0', loop: sq(-cx * 0.8, -cy * 0.8, a * 1.4), z0: h / 6, z1: h },
        ],
      };
    }

    case 'cornerHoleBait': {
      // A hole tucked hard against a corner: its vertical edges are parallel to
      // and very close to the part's corner vertical edge — deliberate bait for
      // a nearest-neighbour / signature matcher.
      const a = Math.min(w, d) * 0.10;
      const cx = -w / 2 + a * 2.2, cy = -d / 2 + a * 2.2;
      return { base: { loop: rect, ...zBase }, tools: [{ id: 'B0', loop: sq(cx, cy, a), ...through }] };
    }
  }
}

/** Every semantic edge label of a part, with its ANALYTIC midpoint. */
function semanticEdges(p: Part): Array<{ label: string; mid: V3 }> {
  const out: Array<{ label: string; mid: V3 }> = [];
  const ring = (tag: string, loop: P2[], zLo: number, zHi: number) => {
    const n = loop.length;
    for (let i = 0; i < n; i++) out.push({ label: `${tag}.vert.${i}`, mid: { x: loop[i].x, y: loop[i].y, z: (zLo + zHi) / 2 } });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mx = (loop[i].x + loop[j].x) / 2, my = (loop[i].y + loop[j].y) / 2;
      out.push({ label: `${tag}.bot.${i}`, mid: { x: mx, y: my, z: zLo } });
      out.push({ label: `${tag}.top.${i}`, mid: { x: mx, y: my, z: zHi } });
    }
  };
  ring('base', p.base.loop, p.base.z0, p.base.z1);
  for (const t of p.tools) {
    // A tool's contribution to the result spans the OVERLAP with the base.
    ring(t.id, t.loop, Math.max(t.z0, p.base.z0), Math.min(t.z1, p.base.z1));
  }
  return out;
}

/** Kernel solid for a part (base minus each tool, in order). */
function kernelSolid(p: Part): OcctInstance {
  let acc = prismFromLoop(p.base.loop, p.base.z0, p.base.z1 - p.base.z0);
  for (const t of p.tools) acc = cutShapes(acc, prismFromLoop(t.loop, t.z0, t.z1 - t.z0));
  return acc;
}

// ─── System A: provenance names (replica of runBool chaining) ─────────────

function primitiveAnchors(s: Solid): EdgeAnchorSource {
  const topo = buildExtrudeTopo(featOf(s, 'add'));
  const anchors = new Map<string, V3>();
  for (const n of namesOf(topo, 'edge')) { const m = edgeMidpoint(topo, n); if (m) anchors.set(n, m); }
  // buildExtrudeTopo places the prism at z0 per `direction`; our solids carry an
  // explicit z0, so shift the anchors to the real placement.
  const shifted = new Map<string, V3>();
  for (const [k, v] of anchors) shifted.set(k, { x: v.x, y: v.y, z: v.z + s.z0 });
  return fromAnchors(shifted);
}

/** Mirrors `planExecutor.runBoolean` + `nodeOcctBridge.runBool`: each tool is a
 *  separate Cut. W1-B: the operand prefix is the operand's FEATURE ID (`base`,
 *  `H0`, …) rather than its slot ('a'/'b'), and each boolean scopes the seams it
 *  mints under its own id — so inserting a later cut cannot rename or shadow an
 *  earlier feature's edges. W3-A: seams are named from the kernel's OWN
 *  `Generated()` history (via the same exported helpers the shipping bridge
 *  uses), not from the midpoint sort order. */
function partAnchors(p: Part): EdgeAnchorSource {
  let acc = primitiveAnchors(p.base);
  let accId = 'base';
  let shape = prismFromLoop(p.base.loop, p.base.z0, p.base.z1 - p.base.z0);
  let accFaces: ReadonlyArray<NamedKernelFace> =
    classifyPrismFaces(oc!, shape, p.base.loop, p.base.z0, p.base.z1);
  for (const t of p.tools) {
    const toolShape = prismFromLoop(t.loop, t.z0, t.z1 - t.z0);
    const toolFaces = classifyPrismFaces(oc!, toolShape, t.loop, t.z0, t.z1);
    const accShape = shape;
    const algo = inst('BRepAlgoAPI_Cut_3', accShape, toolShape);
    shape = algo.Shape() as OcctInstance;
    const resultEdges = kernelEdges(shape);
    const operands = [
      { featureId: accId, faces: accFaces },
      { featureId: t.id, faces: toolFaces },
    ];
    const seamKeys = booleanSeamKeys(oc!, algo, operands, resultEdges);
    const tb = primitiveAnchors(t);
    const ta = acc;
    const historyInherited = booleanModifiedEdgeNames(oc!, algo, [
      { featureId: accId, namedEdges: namedKernelEdges(oc!, accShape, ta) },
      { featureId: t.id, namedEdges: namedKernelEdges(oc!, toolShape, tb) },
    ], resultEdges);
    const opId = `cut.${t.id}`;
    acc = composeBooleanTopo(
      [
        { featureId: accId, names: ta.names(), anchorOf: (n) => ta.anchor(n) },
        { featureId: t.id, names: tb.names(), anchorOf: (n) => tb.anchor(n) },
      ],
      resultEdges.map((e) => e.mid),
      { opId, seamKeys, historyInherited },
    );
    accFaces = propagateBooleanFaceNames(oc!, algo, operands, shape);
    accId = opId;
  }
  return acc;
}

const resolveA = (topo: EdgeAnchorSource | undefined, name: string | undefined, edges: KEdge[]): number => {
  if (!topo || !name) return -1;
  const anchor = topo.anchor(name);
  if (!anchor) return -1;
  return nearestByMidpoint(edges.map((e) => e.mid), anchor, 1e-3).index;
};

const resolveB = (
  stored: { sig: EdgeSig; bbox: BBox3 },
  now: { edges: KEdge[]; bbox: BBox3 },
): number => {
  const remapped = remapPointThroughBbox(stored.sig.mid, stored.bbox, now.bbox);
  const scale = Math.max(now.bbox.max[0] - now.bbox.min[0], now.bbox.max[1] - now.bbox.min[1], now.bbox.max[2] - now.bbox.min[2]);
  return bestEdgeMatch({ ...stored.sig, mid: remapped }, now.edges.map(toSig), { scale }).index;
};

const verdict = (resolved: number, gt: number): Verdict =>
  gt < 0 ? 'nogt' : resolved < 0 ? 'lost' : resolved === gt ? 'ok' : 'mismatch';

// ─── authoring / rebuild loop ─────────────────────────────────────────────

interface Authored {
  label: string;
  /** The System A NAME the user would be handed when clicking this edge. */
  name?: string;
  sig: EdgeSig;
  bbox: BBox3;
}

function author(fam: Family, c: Cfg): { part: Part; authored: Authored[]; edges: KEdge[] } {
  const part = buildPart(fam, c);
  const shape = kernelSolid(part);
  const edges = kernelEdges(shape);
  const bbox = bboxOfRaw(shape);
  const topo = partAnchors(part);
  const names = topo.names();
  const authored: Authored[] = [];
  for (const { label, mid } of semanticEdges(part)) {
    const gt = groundTruthIndex(edges, mid);
    if (gt < 0) continue; // this semantic edge isn't in the authoring solid
    const name = names.find((n) => { const a = topo.anchor(n); return a && dist(a, mid) <= 1e-6; });
    authored.push({ label, name, sig: toSig(edges[gt]), bbox });
  }
  return { part, authored, edges };
}

interface RunOut { A: Tally; B: Tally; unnamedAtAuthor: number; authoredCount: number; examples: unknown[] }

/** Author at cfg0, rebuild at each cfg1, score both systems. */
function runFamily(fam: Family, cfg0: Cfg, sweep: Cfg[]): RunOut {
  const A = newTally(), B = newTally();
  const examples: unknown[] = [];
  const { authored } = author(fam, cfg0);
  const unnamedAtAuthor = authored.filter((a) => !a.name).length;

  for (const c1 of sweep) {
    const part1 = buildPart(fam, c1);
    const shape1 = kernelSolid(part1);
    const edges1 = kernelEdges(shape1);
    const bbox1 = bboxOfRaw(shape1);
    const topo1 = partAnchors(part1);
    const gtMap = new Map(semanticEdges(part1).map((e) => [e.label, e.mid]));
    for (const a of authored) {
      const expect = gtMap.get(a.label);
      const gt = expect ? groundTruthIndex(edges1, expect) : -1;
      const va = verdict(resolveA(topo1, a.name, edges1), gt);
      const vb = verdict(resolveB({ sig: a.sig, bbox: a.bbox }, { edges: edges1, bbox: bbox1 }), gt);
      bump(A, va); bump(B, vb);
      if ((va === 'mismatch' || vb === 'mismatch') && examples.length < 12) {
        examples.push({ fam, cfg: c1, label: a.label, name: a.name, A: va, B: vb });
      }
    }
  }
  return { A, B, unnamedAtAuthor, authoredCount: authored.length, examples };
}

const withC = (o: Partial<Cfg>): Cfg => ({ ...BASE_CFG, ...o });

/** 12 rebuild configs — dimensions, skew angle and hole position all vary. */
const SWEEP: Cfg[] = [
  withC({ w: 44 }), withC({ d: 33 }), withC({ h: 24 }),
  withC({ w: 48, d: 36, h: 24 }), withC({ w: 32, d: 24, h: 16 }),
  withC({ w: 60 }), withC({ d: 60 }), withC({ h: 45 }),
  withC({ w: 55, d: 22, h: 30, skew: 0.10, holeX: 0.30 }),
  withC({ w: 25, d: 45, h: 12, skew: 0.55, holeY: 0.28 }),
  withC({ w: 70, d: 18, h: 35, skew: 0.05, holeX: 0.72, holeY: 0.66 }),
  withC({ w: 18, d: 55, h: 8, skew: 0.48, holeX: 0.35, holeY: 0.75 }),
];

const FAMILIES: Family[] = ['box', 'lshape', 'skew', 'movingHole', 'blindPocket', 'cornerHoleBait'];
const S1_FAMILIES: Family[] = ['box', 'lshape', 'skew'];                                  // no booleans
const S2_FAMILIES: Family[] = ['movingHole', 'blindPocket', 'cornerHoleBait'];             // boolean cut present

const report: Record<string, unknown> = {
  meta: {
    adr: 'ADR-017 §D2',
    generatedAt: new Date().toISOString(),
    note: 'Measurement only. Rates exclude nogt (edge genuinely gone). mismatch = SILENT wrong entity.',
    systemA: 'topoNaming + composedTopo (feature-id prefixes W1-B, kernel-history seam keys W3-A), resolved via nearestByMidpoint(1e-3) — replica of nodeOcctBridge.resolvePickedEdges',
    systemB: 'edgeCorrespondence.bestEdgeMatch + remapPointThroughBbox — shape-generator path',
  },
};

beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) { oc = r.oc; bridge = createNodeOcctBridge(r.oc); }
  else loadReason = r.reason ?? 'unknown';
}, 120_000);

describe('ADR-017 K2.2 spike — measurement', () => {
  it('S0 kernel availability', () => {
    report.kernel = oc ? { available: true } : { available: false, reason: loadReason };
    expect(true).toBe(true);
  });

  it('S1 extrude → upstream dimension change', () => {
    if (!oc) { report.S1 = { measurable: false, reason: loadReason }; return; }
    const per: Record<string, unknown> = {};
    const allA: Tally[] = [], allB: Tally[] = [];
    for (const fam of S1_FAMILIES) {
      const r = runFamily(fam, BASE_CFG, SWEEP);
      per[fam] = { authoredEdges: r.authoredCount, unnamedAtAuthor: r.unnamedAtAuthor, A: rates(r.A), B: rates(r.B), mismatchExamples: r.examples };
      allA.push(r.A); allB.push(r.B);
    }
    report.S1 = { measurable: true, perFamily: per, total: { A: rates(merge(...allA)), B: rates(merge(...allB)) } };
  }, 240_000);

  it('S2 extrude → boolean cut inserted → upstream dimension change', () => {
    if (!oc) { report.S2 = { measurable: false, reason: loadReason }; return; }
    const per: Record<string, unknown> = {};
    const allA: Tally[] = [], allB: Tally[] = [];
    for (const fam of S2_FAMILIES) {
      const r = runFamily(fam, BASE_CFG, SWEEP);
      per[fam] = { authoredEdges: r.authoredCount, unnamedAtAuthor: r.unnamedAtAuthor, A: rates(r.A), B: rates(r.B), mismatchExamples: r.examples };
      allA.push(r.A); allB.push(r.B);
    }

    // S2b — TOPOLOGY change: a SECOND cut is inserted after authoring, then the
    // dimensions change. This is the realistic "insert a boolean cut" case.
    const A2 = newTally(), B2 = newTally();
    // Attribution: split System A's verdicts by the KIND of name the reference
    // holds. `seam.*` names are minted by the boolean itself and ordered by
    // midpoint (ADR-017 root cause ①, Wave 3 / W3-A scope); everything else is a
    // feature-qualified inherited name (root cause ②, THIS track's target).
    const A2seam = newTally(), A2feat = newTally();
    const ex2: unknown[] = [];
    const { authored } = author('movingHole', BASE_CFG);
    for (const c1 of SWEEP) {
      const part1 = buildPart('movingHole', c1);
      // Add a SECOND, non-coincident through hole at a fixed fractional spot
      // (0.82, 0.18) — chosen to never overlap H0 for any sweep config.
      const a = Math.min(c1.w, c1.d) * 0.13;
      const cx = -c1.w / 2 + 0.82 * c1.w, cy = -c1.d / 2 + 0.18 * c1.d;
      part1.tools.push({ id: 'H1', loop: sq(cx, cy, a), z0: -c1.h, z1: c1.h });
      const shape1 = kernelSolid(part1);
      const edges1 = kernelEdges(shape1), bbox1 = bboxOfRaw(shape1);
      const topo1 = partAnchors(part1);
      const gtMap = new Map(semanticEdges(part1).map((e) => [e.label, e.mid]));
      for (const au of authored) {
        const expect = gtMap.get(au.label);
        const gt = expect ? groundTruthIndex(edges1, expect) : -1;
        const va = verdict(resolveA(topo1, au.name, edges1), gt);
        const vb = verdict(resolveB({ sig: au.sig, bbox: au.bbox }, { edges: edges1, bbox: bbox1 }), gt);
        bump(A2, va); bump(B2, vb);
        // seam names: legacy positional `seam.k` OR kernel-history `seam(...)`.
      bump(/(^|\/)seam[.(]/.test(au.name ?? '') ? A2seam : A2feat, va);
        if ((va === 'mismatch' || vb === 'mismatch') && ex2.length < 12) ex2.push({ cfg: c1, label: au.label, name: au.name, A: va, B: vb });
      }
    }

    report.S2 = {
      measurable: true,
      perFamily: per,
      total: { A: rates(merge(...allA)), B: rates(merge(...allB)) },
      s2b_secondCutInserted: {
        A: rates(A2), B: rates(B2), mismatchExamples: ex2,
        A_byNameKind: {
          featureQualified: rates(A2feat),
          seam: rates(A2seam),
          note: 'featureQualified = W1-B target (role prefix → feature id). seam = W3-A target — now named by kernel Generated() history (face-pair keys), no longer by midpoint order.',
        },
      },
    };
  }, 240_000);

  it('S3 fillet → upstream dimension change', async () => {
    if (!oc) { report.S3 = { measurable: false, reason: loadReason }; return; }
    const A = newTally(), B = newTally();
    const ex: unknown[] = [];
    const kernelApply = { attempted: 0, succeeded: 0, failures: [] as string[] };

    // Fillet targets = the vertical edges (the classic fillet selection).
    for (const fam of ['box', 'lshape', 'skew', 'cornerHoleBait'] as Family[]) {
      const { authored } = author(fam, BASE_CFG);
      const targets = authored.filter((a) => /\.vert\.\d+$/.test(a.label));
      for (const c1 of SWEEP) {
        const part1 = buildPart(fam, c1);
        const shape1 = kernelSolid(part1);
        const edges1 = kernelEdges(shape1), bbox1 = bboxOfRaw(shape1);
        const topo1 = partAnchors(part1);
        const gtMap = new Map(semanticEdges(part1).map((e) => [e.label, e.mid]));
        for (const a of targets) {
          const expect = gtMap.get(a.label);
          const gt = expect ? groundTruthIndex(edges1, expect) : -1;
          const va = verdict(resolveA(topo1, a.name, edges1), gt);
          const vb = verdict(resolveB({ sig: a.sig, bbox: a.bbox }, { edges: edges1, bbox: bbox1 }), gt);
          bump(A, va); bump(B, vb);
          if ((va === 'mismatch' || vb === 'mismatch') && ex.length < 12) ex.push({ fam, cfg: c1, label: a.label, A: va, B: vb });
        }
        // End-to-end through the SHIPPING bridge (extrude families only — the
        // bridge builds a primitive extrude and fillets it by name).
        if (fam === 'box' || fam === 'lshape' || fam === 'skew') {
          const feat = featOf(part1.base, 'add');
          const built = await bridge.buildFromExtrude(feat);
          if (built.ok && built.shape) {
            const nVerts = part1.base.loop.length;
            const names = Array.from({ length: nVerts }, (_, i) => `e.vert.${i}`);
            const radius = Math.min(c1.w, c1.d, c1.h) * 0.06;
            kernelApply.attempted++;
            const fr = await bridge.fillet(built.shape, names, radius);
            if (fr.ok) kernelApply.succeeded++;
            else if (kernelApply.failures.length < 8) kernelApply.failures.push(`${fam} ${JSON.stringify(c1)}: ${fr.error}`);
          }
        }
      }
    }

    // Coverage probe: can a reference be authored ON a filleted result?
    let postFillet = 'n/a';
    const b0 = await bridge.buildFromExtrude(featOf(buildPart('box', BASE_CFG).base, 'add'));
    if (b0.ok && b0.shape) {
      const f1 = await bridge.fillet(b0.shape, ['e.vert.0'], 2);
      postFillet = f1.ok && f1.shape
        ? ((await bridge.fillet(f1.shape, ['e.vert.1'], 2)).ok ? 'SUPPORTED' : `NOT SUPPORTED — ${(await bridge.fillet(f1.shape, ['e.vert.1'], 2)).error}`)
        : `first fillet failed — ${f1.error}`;
    }
    report.S3 = { measurable: true, A: rates(A), B: rates(B), mismatchExamples: ex, kernelReapply: kernelApply, postFilletReferenceCoverage: postFillet };
  }, 300_000);

  it('S4 feature mid-insert / reorder (EditOp) → replay', async () => {
    if (!oc) { report.S4 = { measurable: false, reason: loadReason }; return; }
    const A = newTally(), B = newTally();
    const notes: string[] = [];
    const node = (id: string, payload: FeatureNode['payload'], deps: string[] = []): FeatureNode => ({ id, name: id, dependencies: deps, payload });
    let replayOk = 0, replayTried = 0;

    for (const c1 of SWEEP) {
      const p0 = buildPart('box', c1);
      const s0 = kernelSolid(p0), e0 = kernelEdges(s0), bb0 = bboxOfRaw(s0);
      const topo0 = partAnchors(p0);
      const authored: Authored[] = [];
      for (const { label, mid } of semanticEdges(p0)) {
        const gt = groundTruthIndex(e0, mid);
        if (gt < 0) continue;
        const name = topo0.names().find((n) => { const a = topo0.anchor(n); return a && dist(a, mid) <= 1e-6; });
        authored.push({ label, name, sig: toSig(e0[gt]), bbox: bb0 });
      }

      // EditOp: insert a tool + a boolean cut in the MIDDLE of the tree, then replay.
      const toolSolid = buildPart('movingHole', c1).tools[0];
      const tree0: FeatureTree = { nodes: [node('base', featOf(p0.base, 'add'))] };
      const tree1 = applyEdit(
        applyEdit(tree0, { type: 'insert_node', node: node('tool', featOf(toolSolid, 'cut')), atIndex: 1 }),
        { type: 'insert_node', node: node('cutOp', { kind: 'boolean', op: 'difference', bodies: ['base', 'tool'] } as unknown as FeatureNode['payload'], ['base', 'tool']), atIndex: 2 },
      );
      replayTried++;
      const exec = await executeOcctPlan(featureTreeToOcctPlan(tree1), bridge);
      if (!exec.ok) { if (notes.length < 5) notes.push(`replay failed ${JSON.stringify(c1)}: ${exec.error}`); }
      else replayOk++;

      const p1: Part = { base: p0.base, tools: [{ ...toolSolid }] };
      const s1 = kernelSolid(p1), e1 = kernelEdges(s1), bb1 = bboxOfRaw(s1);
      const topo1 = partAnchors(p1);
      const gtMap = new Map(semanticEdges(p1).map((e) => [e.label, e.mid]));
      for (const a of authored) {
        const expect = gtMap.get(a.label);
        const gt = expect ? groundTruthIndex(e1, expect) : -1;
        bump(A, verdict(resolveA(topo1, a.name, e1), gt));
        bump(B, verdict(resolveB({ sig: a.sig, bbox: a.bbox }, { edges: e1, bbox: bb1 }), gt));
      }
    }
    report.S4 = {
      measurable: true, A: rates(A), B: rates(B),
      planReplay: { tried: replayTried, ok: replayOk },
      note: 'Reference authored BEFORE the insert. System A name is the bare `e.vert.i`; after the insert the namespace is feature-qualified (`base/e.vert.i`), so the bare name is an explicit loss (never a mismatch).',
      notes,
    };
  }, 300_000);

  it('S5 revolve + pattern naming coverage', async () => {
    if (!oc) { report.S5 = { measurable: false, reason: loadReason }; return; }
    const rev: RevolveFeature = { kind: 'revolve', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }], angleDegrees: 360, mode: 'add' };
    const rr = await bridge.buildFromRevolve(rev);
    let revolveNamed = 'revolve build failed';
    if (rr.ok && rr.shape) {
      const fr = await bridge.fillet(rr.shape, ['e.vert.0'], 1);
      revolveNamed = fr.ok ? 'named selection resolved' : `NO stable names — ${fr.error}`;
    }
    const patternTree: FeatureTree = {
      nodes: [{
        id: 'lp', name: 'lp', dependencies: [],
        payload: { kind: 'linear_pattern', body: featOf(buildPart('box', BASE_CFG).base, 'add'), count: 3, direction: { x: 1, y: 0, z: 0 }, spacing: 60 } as unknown as FeatureNode['payload'],
      }],
    };
    let patternPlan: unknown;
    try { const p = featureTreeToOcctPlan(patternTree); patternPlan = { commands: p.commands.map((c) => c.op), unsupported: p.unsupported }; }
    catch (e) { patternPlan = { error: e instanceof Error ? e.message : String(e) }; }

    report.S5 = {
      measurable: true,
      revolveNameCoverage: revolveNamed,
      revolveNamerExists: 'no buildRevolveTopo in src/lib/cad — buildExtrudeTopo is extrude-only; nodeOcctBridge.buildFromRevolve registers the shape with NO topo',
      patternPlanCoverage: patternPlan,
      namedEdgeCoverage: { extrude: '100% (all edges named)', revolve: '0%', linearPattern: '0% (not compiled to OCCT at all)', filletResult: '0% (fillet result registers no topo)' },
    };
  }, 120_000);

  it('S6 large parameter excursion ×0.2 .. ×5', () => {
    if (!oc) { report.S6 = { measurable: false, reason: loadReason }; return; }
    const factors = [0.2, 0.3, 0.5, 0.75, 0.9, 1.1, 1.5, 2, 3, 4, 5];
    const rows: unknown[] = [];
    for (const fam of FAMILIES) {
      const { authored } = author(fam, BASE_CFG);
      for (const k of factors) {
        // Anisotropic: only w scales → proportions genuinely change.
        const c1 = withC({ w: BASE_CFG.w * k });
        const part1 = buildPart(fam, c1);
        const s1 = kernelSolid(part1);
        const e1 = kernelEdges(s1), bb1 = bboxOfRaw(s1);
        const topo1 = partAnchors(part1);
        const gtMap = new Map(semanticEdges(part1).map((e) => [e.label, e.mid]));
        const A = newTally(), B = newTally();
        for (const a of authored) {
          const expect = gtMap.get(a.label);
          const gt = expect ? groundTruthIndex(e1, expect) : -1;
          bump(A, verdict(resolveA(topo1, a.name, e1), gt));
          bump(B, verdict(resolveB({ sig: a.sig, bbox: a.bbox }, { edges: e1, bbox: bb1 }), gt));
        }
        rows.push({ family: fam, factor: k, A: rates(A), B: rates(B) });
      }
    }
    report.S6 = { measurable: true, axis: 'w × k (d, h, skew, hole position fixed) — anisotropic', rows };
  }, 300_000);

  /**
   * FIDELITY — the System A numbers above come from a replica of
   * `nodeOcctBridge.resolvePickedEdges` + `runBool`. This check runs the SAME
   * references through the SHIPPING bridge and compares resolve/lose verdicts,
   * so the replica can be trusted (or not).
   */
  it('FIDELITY — replica vs shipping bridge', async () => {
    if (!oc) { report.fidelity = { measurable: false, reason: loadReason }; return; }
    // Use the bridge's own placement convention: one_sided (z0=0) base,
    // two_sided (z0=-depth) tool, so replica and bridge build identical solids.
    const mk = (w: number, d: number, h: number) => {
      const base: ExtrudeFeature = { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }], depth: h, direction: 'one_sided', mode: 'add' };
      const a = Math.min(w, d) * 0.15;
      const tool: ExtrudeFeature = { kind: 'extrude', loop: sq(w / 2, d / 2, a), depth: h, direction: 'two_sided', mode: 'cut' };
      return { base, tool };
    };
    let agree = 0, disagree = 0;
    const disagreements: unknown[] = [];
    for (const [w, d, h] of [[40, 30, 20], [55, 22, 30], [25, 45, 12]] as Array<[number, number, number]>) {
      const { base, tool } = mk(w, d, h);
      const sb = await bridge.buildFromExtrude(base);
      const st = await bridge.buildFromExtrude(tool);
      if (!sb.ok || !st.ok || !sb.shape || !st.shape) continue;
      const cutRes = await bridge.boolean.subtract(sb.shape, st.shape);
      if (!cutRes.ok || !cutRes.shape) continue;

      // Replica of the same composed topology — id-less bridge call, so the
      // prefixes fall back to the positional 'a'/'b' and the seam keys are
      // qualified the same way (exactly what runBool does without ids).
      const shapeA = prismFromLoop(base.loop, 0, h);
      const shapeB = prismFromLoop(tool.loop, -h, 2 * h);
      const algo = inst('BRepAlgoAPI_Cut_3', shapeA, shapeB);
      const shape = algo.Shape() as OcctInstance;
      const edges = kernelEdges(shape);
      const ta = primitiveAnchors({ loop: [...base.loop], z0: 0, z1: h });
      const tb = primitiveAnchors({ loop: [...tool.loop], z0: -h, z1: h });
      const seamKeys = booleanSeamKeys(oc!, algo, [
        { featureId: 'a', faces: classifyPrismFaces(oc!, shapeA, base.loop, 0, h) },
        { featureId: 'b', faces: classifyPrismFaces(oc!, shapeB, tool.loop, -h, h) },
      ], edges);
      const historyInherited = booleanModifiedEdgeNames(oc!, algo, [
        { featureId: 'a', namedEdges: namedKernelEdges(oc!, shapeA, ta) },
        { featureId: 'b', namedEdges: namedKernelEdges(oc!, shapeB, tb) },
      ], edges);
      const topo = composeBooleanTopo(
        [{ role: 'a', names: ta.names(), anchorOf: (n) => ta.anchor(n) },
         { role: 'b', names: tb.names(), anchorOf: (n) => tb.anchor(n) }],
        edges.map((e) => e.mid),
        { seamKeys, historyInherited },
      );
      // Probe a mix of real names, a kernel-history seam name, and one
      // deliberately bogus name.
      const seamProbe = topo.names().find((n) => n.includes('seam('));
      const probes = [
        ...topo.names().slice(0, 10),
        ...(seamProbe ? [seamProbe] : []),
        'e.vert.0', 'no.such.edge',
      ];
      for (const name of probes) {
        const replicaResolves = resolveA(topo, name, edges) >= 0;
        const fr = await bridge.fillet(cutRes.shape, [name], 0.5);
        // The bridge reports an unresolved NAME distinctly from a kernel failure.
        const bridgeResolves = !(fr.error ?? '').includes('unresolved edges');
        if (replicaResolves === bridgeResolves) agree++;
        else { disagree++; if (disagreements.length < 10) disagreements.push({ w, d, h, name, replicaResolves, bridgeResolves, err: fr.error }); }
      }
    }
    report.fidelity = { measurable: true, agree, disagree, disagreements, note: 'compares "does this NAME resolve to a kernel edge" between the replica and the shipping nodeOcctBridge' };
  }, 300_000);

  it('write result json', () => {
    const out = path.resolve(process.cwd(), 'scripts/spike/topo-naming-k22.result.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n[spike] wrote ${out}`);
    expect(fs.existsSync(out)).toBe(true);
  });
});
