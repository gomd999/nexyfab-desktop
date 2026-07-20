// @vitest-environment node
/**
 * buildRevolveTopo — REAL-KERNEL stability measurement (ADR-017 S5 follow-up).
 *
 * Same methodology as the K2.2 spike (scripts/spike/topo-naming-k22.test.ts,
 * W3-A owned — NOT touched): build a revolve with the real OCCT kernel
 * (BRepPrimAPI_MakeRevol, replicating nodeOcctBridge.buildFromRevolve), author
 * references at a base config, rebuild at swept configs, and score how names
 * resolve through `nearestByMidpoint(1e-3)` — the bridge's resolution path —
 * against an ANALYTIC ground truth (1e-6).
 *
 * Ground truth is independent of the namer: each family's semantic edges have
 * harness-side analytic midpoints, and the KERNEL arbitrates — a ground-truth
 * label only scores when a real kernel edge sits at the analytic point within
 * 1e-6. Verdicts (spike vocabulary):
 *   ok       — resolved kernel index === ground-truth kernel index
 *   lost     — name explicitly unresolvable (anchor null / out of tolerance)
 *   mismatch — name silently resolved to a DIFFERENT kernel edge  ← FATAL (D1)
 *   nogt     — the semantic edge doesn't exist in the rebuilt solid (excluded)
 *
 * Scenarios:
 *   R1 partial→partial  dims + angle both vary (topology preserved)
 *   R2 full→full        dims vary at 360°
 *   R3 partial↔full     topology CROSSING — lat/side names must survive,
 *                       caps/meridians/axis/seam names must be EXPLICITLY lost
 *                       (never silently re-resolved)
 *   R0 coverage         at every author config, kernel edges ↔ names bijection
 */
import { describe, it, beforeAll, expect } from 'vitest';
import { loadOcctNode, type OcctModule } from '@/lib/occt/nodeOcctLoader';
import { buildRevolveTopo, revolveEdgeAnchor, revolveNamesOf } from './topoNaming';
import { nearestByMidpoint } from './edgeMatch';
import type { RevolveFeature } from './revolveProfile';

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

// ─── kernel helpers (replica of the spike's, + degenerate-edge guard) ───────

let oc: OcctModule | null = null;
let loadReason = '';
const ctor = (n: string) => oc![n] as unknown as new (...a: unknown[]) => OcctInstance;
const inst = (n: string, ...a: unknown[]) => new (ctor(n))(...a);

interface KEdge { mid: V3 }

/** Unique non-degenerate kernel edges. Dedupe key replicates
 *  `nodeOcctBridge.uniqueEdges` (midpoint rounded to 1e-3). A revolve of a
 *  profile touching the axis at a single vertex carries a DEGENERATED edge
 *  (cone apex — measured: BRep_Tool.Degenerated=true, its "curve" evaluates to
 *  the apex point). Degenerated edges are not fillet-able geometry, so they are
 *  excluded from the coverage denominator and counted separately. */
function kernelEdges(shape: OcctInstance): { edges: KEdge[]; degenerate: number } {
  const en = oc!.TopAbs_ShapeEnum as unknown as { TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
  const topoDS = oc!.TopoDS as unknown as { Edge_1: (s: unknown) => OcctInstance };
  const bt = oc!.BRep_Tool as unknown as Record<string, (e: unknown) => boolean>;
  const isDegenerated = bt.Degenerated ?? bt.Degenerated_1;
  const exp = inst('TopExp_Explorer_2', shape, en.TopAbs_EDGE, en.TopAbs_SHAPE);
  const seen = new Set<string>();
  const edges: KEdge[] = [];
  let degenerate = 0;
  while (exp.More()) {
    const edge = topoDS.Edge_1(exp.Current());
    try {
      if (isDegenerated && isDegenerated(edge)) {
        degenerate++;
        exp.Next();
        continue;
      }
      const curve = inst('BRepAdaptor_Curve_2', edge);
      const t0 = curve.FirstParameter() as number, t1 = curve.LastParameter() as number;
      const p = curve.Value((t0 + t1) / 2) as OcctInstance;
      const mid = { x: p.X() as number, y: p.Y() as number, z: p.Z() as number };
      const key = `${Math.round(mid.x * 1000)},${Math.round(mid.y * 1000)},${Math.round(mid.z * 1000)}`;
      if (!seen.has(key)) { seen.add(key); edges.push({ mid }); }
    } catch {
      degenerate++; // no usable 3D curve — treat as non-referenceable, count
    }
    exp.Next();
  }
  return { edges, degenerate };
}

/** REPLICATES nodeOcctBridge.buildFromRevolve exactly: polygon profile in the
 *  XY plane revolved about +Y. */
function revolveShape(feature: RevolveFeature): OcctInstance {
  const poly = inst('BRepBuilderAPI_MakePolygon_1');
  for (const p of feature.loop) poly.Add_1(inst('gp_Pnt_3', p.x, p.y, 0));
  poly.Close();
  const face = inst('BRepBuilderAPI_MakeFace_15', poly.Wire(), false).Face() as OcctInstance;
  const axis = inst('gp_Ax1_2', inst('gp_Pnt_3', 0, 0, 0), inst('gp_Dir_4', 0, 1, 0));
  const angle = (Math.max(0, Math.min(360, feature.angleDegrees)) * Math.PI) / 180;
  return inst('BRepPrimAPI_MakeRevol_1', face, axis, angle, false).Shape() as OcctInstance;
}

function groundTruthIndex(edges: KEdge[], expected: V3, tol = 1e-6): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < edges.length; i++) { const d = dist(edges[i].mid, expected); if (d < bd) { bd = d; best = i; } }
  return bd <= tol ? best : -1;
}

// ─── parametric families ─────────────────────────────────────────────────────

interface Cfg { r0: number; r1: number; h: number; angle: number }
type Family = 'cylinder' | 'ring' | 'cone' | 'step' | 'slantRing';

/** Canonical profile (axis = Y, X ≥ 0) per family. */
function profileOf(fam: Family, c: Cfg): P2[] {
  switch (fam) {
    case 'cylinder': // on-axis edge, 2 lat circles
      return [{ x: 0, y: 0 }, { x: c.r1, y: 0 }, { x: c.r1, y: c.h }, { x: 0, y: c.h }];
    case 'ring': // fully off-axis rectangle (square-section torus at 360°)
      return [{ x: c.r0, y: 0 }, { x: c.r1, y: 0 }, { x: c.r1, y: c.h }, { x: c.r0, y: c.h }];
    case 'cone': // apex ON the axis → degenerate apex edge at 360°, slant seam
      return [{ x: 0, y: 0 }, { x: c.r1, y: 0 }, { x: 0, y: c.h }];
    case 'step': // stepped shaft, 6 vertices, mixed radial/vertical edges
      return [
        { x: 0, y: 0 }, { x: c.r1, y: 0 }, { x: c.r1, y: c.h * 0.4 },
        { x: c.r0, y: c.h * 0.4 }, { x: c.r0, y: c.h }, { x: 0, y: c.h },
      ];
    case 'slantRing': // off-axis with a CONICAL outer wall (slanted profile edge)
      return [
        { x: c.r0, y: 0 }, { x: c.r1, y: 0 },
        { x: (c.r0 + c.r1) / 2, y: c.h }, { x: c.r0, y: c.h },
      ];
  }
}

const featOf = (fam: Family, c: Cfg): RevolveFeature =>
  ({ kind: 'revolve', loop: profileOf(fam, c), angleDegrees: c.angle, mode: 'add' });

// ─── harness-side ANALYTIC ground truth (independent of the namer) ──────────
//
// Written from the measured kernel conventions directly (probe 2026-07-20):
// right-handed rotation about +Y (z = −x·sinθ), arc curve-midpoint at θ=a/2,
// full-circle curve-midpoint at θ=180°. The kernel arbitrates: a label only
// scores when a kernel edge actually sits at this point (1e-6).

const AX = 1e-9;
function gtRot(p: P2, deg: number): V3 {
  const t = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(t), y: p.y, z: -p.x * Math.sin(t) };
}

/** Semantic edges of a revolved profile with analytic curve-midpoints. */
function semanticEdges(profile: P2[], angle: number): Array<{ label: string; mid: V3 }> {
  const full = angle >= 360 - 1e-9;
  const n = profile.length;
  const out: Array<{ label: string; mid: V3 }> = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(profile[i].x) <= AX) continue;
    out.push({ label: `lat.${i}`, mid: gtRot(profile[i], full ? 180 : angle / 2) });
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = profile[i], b = profile[j];
    const bothOnAxis = Math.abs(a.x) <= AX && Math.abs(b.x) <= AX;
    const m: P2 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (bothOnAxis) {
      if (!full) out.push({ label: `axis.${i}`, mid: { x: 0, y: m.y, z: 0 } });
      continue;
    }
    if (full) {
      if (Math.abs(a.y - b.y) > AX) out.push({ label: `seam.${i}`, mid: { x: m.x, y: m.y, z: 0 } });
    } else {
      out.push({ label: `merS.${i}`, mid: { x: m.x, y: m.y, z: 0 } });
      out.push({ label: `merE.${i}`, mid: gtRot(m, angle) });
    }
  }
  return out;
}

// ─── authoring / rebuild ────────────────────────────────────────────────────

interface Authored { label: string; name?: string }

interface AuthorOut {
  authored: Authored[];
  kernelEdgeCount: number;
  degenerate: number;
  /** kernel edges NOT hit by any name's anchor (coverage gap). */
  unnamedKernelEdges: number;
  /** two names resolving to the same kernel edge (would be ambiguous). */
  nameCollisions: number;
}

function author(fam: Family, c: Cfg): AuthorOut {
  const feat = featOf(fam, c);
  const { edges, degenerate } = kernelEdges(revolveShape(feat));
  const topo = buildRevolveTopo(feat);
  const names = revolveNamesOf(topo, 'edge');

  // name → kernel index (via the bridge's resolution path)
  const hit = new Map<number, string[]>();
  for (const nm of names) {
    const a = revolveEdgeAnchor(topo, nm);
    if (!a) continue;
    const r = nearestByMidpoint(edges.map((e) => e.mid), a, 1e-3);
    if (r.index >= 0) hit.set(r.index, [...(hit.get(r.index) ?? []), nm]);
  }
  const unnamedKernelEdges = edges.length - hit.size;
  const nameCollisions = [...hit.values()].filter((v) => v.length > 1).length;

  const authored: Authored[] = [];
  for (const { label, mid } of semanticEdges(profileOf(fam, c), c.angle)) {
    const gt = groundTruthIndex(edges, mid);
    if (gt < 0) continue; // semantic edge not present in the authored solid
    const name = names.find((nm) => {
      const a = revolveEdgeAnchor(topo, nm);
      return a !== null && dist(a, mid) <= 1e-6;
    });
    authored.push({ label, name });
  }
  return { authored, kernelEdgeCount: edges.length, degenerate, unnamedKernelEdges, nameCollisions };
}

/** Rebuild at c1 and score every authored reference. */
function score(fam: Family, authored: Authored[], c1: Cfg, tally: Tally, examples: unknown[]): void {
  const feat1 = featOf(fam, c1);
  const { edges } = kernelEdges(revolveShape(feat1));
  const topo1 = buildRevolveTopo(feat1);
  const gtMap = new Map(semanticEdges(profileOf(fam, c1), c1.angle).map((e) => [e.label, e.mid]));
  for (const a of authored) {
    const expected = gtMap.get(a.label);
    const gt = expected ? groundTruthIndex(edges, expected) : -1;
    let resolved = -1;
    if (a.name) {
      const anchor = revolveEdgeAnchor(topo1, a.name);
      if (anchor) resolved = nearestByMidpoint(edges.map((e) => e.mid), anchor, 1e-3).index;
    }
    const v: Verdict = gt < 0 ? 'nogt' : resolved < 0 ? 'lost' : resolved === gt ? 'ok' : 'mismatch';
    bump(tally, v);
    if (v === 'mismatch' && examples.length < 12) examples.push({ fam, cfg: c1, label: a.label, name: a.name });
  }
}

const FAMILIES: Family[] = ['cylinder', 'ring', 'cone', 'step', 'slantRing'];
const BASE: Cfg = { r0: 6, r1: 15, h: 20, angle: 120 };
const withC = (o: Partial<Cfg>): Cfg => ({ ...BASE, ...o });

/** Dimension + angle sweep for partial→partial (topology preserved). */
const SWEEP_PARTIAL: Cfg[] = [
  withC({ r1: 22 }), withC({ r0: 3, r1: 9 }), withC({ h: 35 }),
  withC({ r0: 10, r1: 12, h: 8 }), withC({ angle: 30 }), withC({ angle: 90 }),
  withC({ angle: 200 }), withC({ angle: 300 }),
  withC({ r0: 2, r1: 40, h: 5, angle: 45 }), withC({ r0: 12, r1: 14, h: 60, angle: 275 }),
];
/** Dimension sweep at 360° for full→full. */
const SWEEP_FULL: Cfg[] = [
  withC({ angle: 360, r1: 22 }), withC({ angle: 360, r0: 3, r1: 9 }),
  withC({ angle: 360, h: 35 }), withC({ angle: 360, r0: 10, r1: 12, h: 8 }),
  withC({ angle: 360, r0: 2, r1: 40, h: 5 }), withC({ angle: 360, r0: 12, r1: 14, h: 60 }),
];

beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) oc = r.oc;
  else loadReason = r.reason ?? 'unknown';
}, 120_000);

// Kernel availability is a hard requirement for this suite — a skipped
// measurement must never read as a passed one.
describe('buildRevolveTopo — real-kernel stability (ADR-017 S5)', () => {
  it('S0 kernel loads', () => {
    expect(oc, `OCCT kernel failed to load: ${loadReason}`).not.toBeNull();
  });

  it('R0 coverage — every kernel edge gets exactly one name at author time', () => {
    if (!oc) return;
    const perFam: Record<string, unknown> = {};
    let totalKernel = 0, totalUnnamed = 0, totalCollisions = 0, totalDegenerate = 0;
    for (const fam of FAMILIES) {
      for (const c of [BASE, withC({ angle: 360 })]) {
        const a = author(fam, c);
        totalKernel += a.kernelEdgeCount;
        totalUnnamed += a.unnamedKernelEdges;
        totalCollisions += a.nameCollisions;
        totalDegenerate += a.degenerate;
        perFam[`${fam}@${c.angle}`] = {
          kernelEdges: a.kernelEdgeCount, unnamed: a.unnamedKernelEdges,
          collisions: a.nameCollisions, degenerate: a.degenerate,
          authoredRefs: a.authored.length,
          unnamedRefs: a.authored.filter((x) => !x.name).length,
        };
      }
    }
    console.log('[revolveTopo] R0 coverage:', JSON.stringify(perFam, null, 1));
    console.log(`[revolveTopo] R0 total: kernelEdges=${totalKernel} unnamed=${totalUnnamed} collisions=${totalCollisions} degenerateSkipped=${totalDegenerate}`);
    expect(totalUnnamed).toBe(0);     // 100% edge-name coverage on these families
    expect(totalCollisions).toBe(0);  // bijective — no two names on one edge
  }, 120_000);

  it('R1 partial→partial — dims + angle vary, 0 mismatch', () => {
    if (!oc) return;
    const per: Record<string, unknown> = {};
    const all: Tally[] = [];
    const examples: unknown[] = [];
    for (const fam of FAMILIES) {
      const t = newTally();
      const { authored } = author(fam, BASE);
      expect(authored.every((a) => !!a.name), `${fam}: unnamed authored refs`).toBe(true);
      for (const c1 of SWEEP_PARTIAL) score(fam, authored, c1, t, examples);
      per[fam] = rates(t);
      all.push(t);
    }
    const total = rates(merge(...all));
    console.log('[revolveTopo] R1 partial→partial:', JSON.stringify({ perFamily: per, total, examples }, null, 1));
    expect(total.mismatch).toBe(0);
    expect(total.survivalPct).toBe(100); // topology preserved ⇒ full survival
  }, 240_000);

  it('R2 full→full — dims vary at 360°, 0 mismatch', () => {
    if (!oc) return;
    const per: Record<string, unknown> = {};
    const all: Tally[] = [];
    const examples: unknown[] = [];
    for (const fam of FAMILIES) {
      const t = newTally();
      const { authored } = author(fam, withC({ angle: 360 }));
      expect(authored.every((a) => !!a.name), `${fam}: unnamed authored refs`).toBe(true);
      for (const c1 of SWEEP_FULL) score(fam, authored, c1, t, examples);
      per[fam] = rates(t);
      all.push(t);
    }
    const total = rates(merge(...all));
    console.log('[revolveTopo] R2 full→full:', JSON.stringify({ perFamily: per, total, examples }, null, 1));
    expect(total.mismatch).toBe(0);
    expect(total.survivalPct).toBe(100);
  }, 240_000);

  it('R3 partial↔full crossing — lat survives, topology-bound names are EXPLICITLY lost', () => {
    if (!oc) return;
    const t = newTally();
    const examples: unknown[] = [];
    let latOk = 0, latTotal = 0, boundLost = 0, boundTotal = 0;
    for (const fam of FAMILIES) {
      // partial → full
      {
        const { authored } = author(fam, BASE);
        const before = t.mismatch;
        score(fam, authored, withC({ angle: 360 }), t, examples);
        expect(t.mismatch).toBe(before); // crossing must not create silent mismatches
        const feat1 = featOf(fam, withC({ angle: 360 }));
        const topo1 = buildRevolveTopo(feat1);
        for (const a of authored) {
          if (!a.name) continue;
          const resolves = revolveEdgeAnchor(topo1, a.name) !== null;
          if (a.label.startsWith('lat.')) { latTotal++; if (resolves) latOk++; }
          else { boundTotal++; if (!resolves) boundLost++; } // merS/merE/axis: must be lost
        }
      }
      // full → partial
      {
        const { authored } = author(fam, withC({ angle: 360 }));
        score(fam, authored, BASE, t, examples);
        const topo1 = buildRevolveTopo(featOf(fam, BASE));
        for (const a of authored) {
          if (!a.name) continue;
          const resolves = revolveEdgeAnchor(topo1, a.name) !== null;
          if (a.label.startsWith('lat.')) { latTotal++; if (resolves) latOk++; }
          else { boundTotal++; if (!resolves) boundLost++; } // seam: must be lost
        }
      }
    }
    console.log(`[revolveTopo] R3 crossing: ${JSON.stringify({ ...rates(t), latSurvive: `${latOk}/${latTotal}`, topologyBoundExplicitlyLost: `${boundLost}/${boundTotal}`, examples })}`);
    expect(t.mismatch).toBe(0);
    expect(latOk).toBe(latTotal);       // persistent entities keep resolving
    expect(boundLost).toBe(boundTotal); // topology-bound names: explicit loss, no guessing
  }, 240_000);
});
