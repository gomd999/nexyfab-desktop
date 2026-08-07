/**
 * stepBurnIn — STEP round-trip robustness harness (kernel-trust metric).
 *
 * "Will a boolean union of two complex parts survive a STEP export/import with
 * its volume intact?" is exactly what SolidWorks-vs-FreeCAD arguments come down
 * to (see SW_FUSION_PARITY_PLAN pillar 1). This harness drives a diverse,
 * DETERMINISTIC matrix of solids through `exportStep → importStep` on a
 * `SolidKernel` and asserts the volume is preserved — turning "the kernel feels
 * solid" into a measured pass-rate.
 *
 * Headless: runs over the real `opencascade.js` via `createKSeriesKernel(
 * createNodeOcctBridge(...))`. The corpus here is GENERATED (parametric boxes /
 * cylinders / cuts / fillets / chamfers); a real-world 1000-STEP-file burn-in
 * (the parity-plan milestone) layers external fixtures on the same harness.
 */

import type { SolidKernel, KernelShape } from './solidKernel';

export interface StepBurnInCase {
  label: string;
  build: (k: SolidKernel) => Promise<KernelShape | null>;
}

export interface StepBurnInFailure {
  label: string;
  reason: string;
  /** Relative volume error when the failure is a tolerance miss. */
  volErr?: number;
}

export interface StepBurnInReport {
  total: number;
  passed: number;
  failures: StepBurnInFailure[];
  /** passed / total (1 when total is 0). */
  passRate: number;
  recoveries: Array<{ label: string; strategy: 'reduced-radius'; requested: number; applied: number }>;
}

type Pt = { x: number; y: number };
const SQ = (a: number, b: number): Pt[] => [
  { x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b },
];
/** Axis-aligned square of `size` with lower-left corner at (x0,y0). */
const SQat = (x0: number, y0: number, size: number): Pt[] => [
  { x: x0, y: y0 }, { x: x0 + size, y: y0 }, { x: x0 + size, y: y0 + size }, { x: x0, y: y0 + size },
];
/** Non-convex L-shape (6-vertex re-entrant polygon, CCW). */
const LSHAPE = (s: number, arm: number): Pt[] => [
  { x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: arm }, { x: arm, y: arm }, { x: arm, y: s }, { x: 0, y: s },
];
/** Regular n-gon of radius r centred at (cx,cy). Deterministic (no Math.random). */
const NGON = (n: number, r: number, cx = 0, cy = 0): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
/** Revolve profile rectangle [x0..x0+w] × [0..h] (an annular ring when x0>0). */
const REVRECT = (x0: number, w: number, h: number): Pt[] => [
  { x: x0, y: 0 }, { x: x0 + w, y: 0 }, { x: x0 + w, y: h }, { x: x0, y: h },
];

/**
 * A deterministic, diverse corpus: prismatic boxes, cylinders (revolve), boxes
 * with a through-cut, filleted + chamfered boxes — across a few param variants.
 * Every case yields a closed solid that STEP must round-trip.
 */
export function defaultBurnInCases(): StepBurnInCase[] {
  const cases: StepBurnInCase[] = [];

  // Boxes: side a..b extruded by depth.
  for (const [b, depth] of [[10, 5], [20, 8], [7, 12], [15, 3], [30, 25]] as const) {
    cases.push({ label: `box ${b}x${b}x${depth}`, build: (k) => k.extrude(SQ(0, b), depth) });
  }
  // Cylinders: rect (r, h) revolved 360°.
  for (const [r, h] of [[10, 20], [4, 30], [12, 6], [8, 8]] as const) {
    cases.push({
      label: `cyl r${r} h${h}`,
      build: (k) => k.revolve([{ x: 0, y: 0 }, { x: r, y: 0 }, { x: r, y: h }, { x: 0, y: h }], 360),
    });
  }
  // Through-cut boxes: outer − inner tool.
  for (const [outer, inLo, inHi] of [[10, 3, 7], [20, 6, 14], [16, 5, 9]] as const) {
    cases.push({
      label: `cut box ${outer} hole ${inLo}-${inHi}`,
      build: async (k) => {
        const base = await k.extrude(SQ(0, outer), 5);
        const tool = await k.extrude(SQ(inLo, inHi), 7);
        if (!base || !tool) return null;
        return k.boolean('subtract', base.id, tool.id);
      },
    });
  }
  // Filleted boxes (round every edge).
  for (const [b, radius] of [[10, 1], [20, 2], [14, 0.8]] as const) {
    cases.push({
      label: `fillet box ${b} r${radius}`,
      build: async (k) => {
        const box = await k.extrude(SQ(0, b), 5);
        if (!box) return null;
        return k.fillet(box.id, ['sel:all'], radius);
      },
    });
  }
  // Chamfered boxes (named vertical edges).
  for (const [b, dist] of [[10, 1], [18, 1.5]] as const) {
    cases.push({
      label: `chamfer box ${b} d${dist}`,
      build: async (k) => {
        const box = await k.extrude(SQ(0, b), 5);
        if (!box) return null;
        return k.chamfer(box.id, ['e.vert.0', 'e.vert.1', 'e.vert.2', 'e.vert.3'], dist);
      },
    });
  }

  return cases;
}

/**
 * ADVERSARIAL corpus — deliberately hard inputs that hunt kernel robustness
 * limits: thin walls, sub-mm features, far-from-origin coordinates, deep
 * feature stacks, extreme aspect ratios. A burn-in's value is FINDING failures;
 * run report-only (don't assert 100%) and treat any failure as a documented
 * kernel limit or a bug to fix.
 */
export function adversarialBurnInCases(): StepBurnInCase[] {
  return [
    // Thin-walled square tube (0.2 mm wall).
    {
      label: 'thin wall 0.2mm tube',
      build: async (k) => {
        const outer = await k.extrude(SQ(0, 10), 5);
        const inner = await k.extrude(SQat(0.2, 0.2, 9.6), 7);
        if (!outer || !inner) return null;
        return k.boolean('subtract', outer.id, inner.id);
      },
    },
    // Sub-mm tiny box.
    { label: 'tiny 0.05mm box', build: (k) => k.extrude(SQ(0, 0.05), 0.02) },
    // Tiny fillet on a normal box.
    {
      label: 'tiny 0.01mm fillet',
      build: async (k) => { const b = await k.extrude(SQ(0, 10), 5); return b ? k.fillet(b.id, ['sel:all'], 0.01) : null; },
    },
    // Far-from-origin box (float precision).
    { label: 'box at 1e6 offset', build: (k) => k.extrude(SQat(1_000_000, 1_000_000, 10), 5) },
    // Extreme thin slab.
    { label: 'thin slab 200x200x0.5', build: (k) => k.extrude(SQ(0, 200), 0.5) },
    // Extreme tall column.
    { label: 'tall column 1x1x1000', build: (k) => k.extrude(SQ(0, 1), 1000) },
    // Deep feature stack: extrude → cut → fillet.
    {
      label: 'stack extrude→cut→fillet',
      build: async (k) => {
        const base = await k.extrude(SQ(0, 10), 5);
        const tool = await k.extrude(SQ(3, 7), 7);
        if (!base || !tool) return null;
        const cut = await k.boolean('subtract', base.id, tool.id);
        return cut ? k.fillet(cut.id, ['sel:all'], 0.5) : null;
      },
    },
    // High-aspect cut (narrow slot).
    {
      label: 'narrow slot cut',
      build: async (k) => {
        const base = await k.extrude(SQ(0, 20), 5);
        const tool = await k.extrude(SQat(2, 9.7, 0.6), 7); // 0.6mm-wide slot tool (x16 long)
        if (!base || !tool) return null;
        return k.boolean('subtract', base.id, tool.id);
      },
    },
    // Large fillet relative to the edge (radius = 40% of side).
    {
      label: 'large fillet r4 on 10mm box',
      build: async (k) => { const b = await k.extrude(SQ(0, 10), 5); return b ? k.fillet(b.id, ['e.vert.0', 'e.vert.1', 'e.vert.2', 'e.vert.3'], 4) : null; },
    },

    // ── Non-convex / non-box profiles (re-entrant + many-sided faces) ──────────
    // L-shaped prism: a re-entrant corner the kernel must keep manifold.
    { label: 'L-shape prism', build: (k) => k.extrude(LSHAPE(10, 4), 6) },
    // Triangle prism (3 side faces meeting at sharp dihedral angles).
    { label: 'triangle prism', build: (k) => k.extrude([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], 5) },
    // Hexagonal prism.
    { label: 'hex prism r8', build: (k) => k.extrude(NGON(6, 8), 5) },
    // High-facet polygon (16-gon ≈ cylinder by faceting).
    { label: '16-gon prism r10', build: (k) => k.extrude(NGON(16, 10), 4) },

    // ── Partial revolves (seam faces, sub-360 sweeps) ─────────────────────────
    { label: 'revolve wedge 270°', build: (k) => k.revolve(REVRECT(0, 10, 20), 270) },
    { label: 'revolve wedge 90°', build: (k) => k.revolve(REVRECT(0, 10, 20), 90) },
    { label: 'revolve sliver 30°', build: (k) => k.revolve(REVRECT(0, 10, 20), 30) },
    // Thin annular ring (profile offset from the axis, revolved full turn).
    { label: 'thin annulus ring', build: (k) => k.revolve(REVRECT(8, 0.4, 6), 360) },
    // Extreme-aspect disc (r200, h0.5).
    { label: 'thin disc r200 h0.5', build: (k) => k.revolve(REVRECT(0, 200, 0.5), 360) },

    // ── Boolean variety: union, intersect, multi-cut stacks ───────────────────
    // Union of two offset boxes (an L-block made by addition).
    {
      label: 'union offset boxes',
      build: async (k) => {
        const a = await k.extrude(SQ(0, 10), 5);
        const b = await k.extrude(SQat(6, 6, 10), 5);
        if (!a || !b) return null;
        return k.boolean('union', a.id, b.id);
      },
    },
    // Intersection of two overlapping boxes (a small shared sliver).
    {
      label: 'intersect overlap sliver',
      build: async (k) => {
        const a = await k.extrude(SQ(0, 10), 5);
        const b = await k.extrude(SQat(8, 8, 10), 7);
        if (!a || !b) return null;
        return k.boolean('intersect', a.id, b.id);
      },
    },
    // Deep multi-cut: base − three separate tools (chained boolean handles).
    {
      label: 'triple-cut stack',
      build: async (k) => {
        let cur = await k.extrude(SQ(0, 20), 6);
        if (!cur) return null;
        for (const [lo, hi] of [[2, 5], [8, 11], [14, 17]] as const) {
          const tool = await k.extrude(SQat(lo, lo, hi - lo), 8);
          if (!tool) return null;
          const next = await k.boolean('subtract', cur.id, tool.id);
          if (!next) return null;
          cur = next;
        }
        return cur;
      },
    },
    // Cut box then fillet ALL edges (topologically rich rounding target).
    {
      label: 'fillet-all on holed box',
      build: async (k) => {
        const base = await k.extrude(SQ(0, 20), 6);
        const tool = await k.extrude(SQat(7, 7, 6), 8);
        if (!base || !tool) return null;
        const cut = await k.boolean('subtract', base.id, tool.id);
        return cut ? k.fillet(cut.id, ['sel:all'], 0.4) : null;
      },
    },
    // Precision stress: large coordinate offset combined with a small fillet.
    {
      label: 'offset 1e6 + r0.1 fillet',
      build: async (k) => {
        const b = await k.extrude(SQat(1_000_000, 1_000_000, 10), 5);
        return b ? k.fillet(b.id, ['sel:all'], 0.1) : null;
      },
    },
  ];
}

/**
 * PATHOLOGICAL corpus — deliberately degenerate / near-invalid inputs that may
 * legitimately fail (coincident faces, full-through splits, zero-measure
 * sweeps). Unlike the adversarial tier these carry NO pass-rate expectation:
 * the harness must merely complete gracefully (every case a pass or a STRUCTURED
 * failure, never an unhandled throw), and the failures DOCUMENT the kernel's
 * real boundary. Promoting a case here to `adversarial` is the bar for "the
 * kernel now handles this".
 */
export function pathologicalBurnInCases(): StepBurnInCase[] {
  return [
    // Coincident-face subtract: the tool's top face sits exactly on the base's
    // top face — the classic CSG tangency that makes naive kernels emit slivers.
    {
      label: 'coincident-face subtract',
      build: async (k) => {
        const base = await k.extrude(SQ(0, 10), 5);
        const tool = await k.extrude(SQat(3, 3, 4), 5); // same depth → top faces flush
        if (!base || !tool) return null;
        return k.boolean('subtract', base.id, tool.id);
      },
    },
    // Through-split: a tool wider than the base in one axis can cleave it into
    // two lumps — STEP of a 2-solid compound is a known boundary.
    {
      label: 'through-split subtract',
      build: async (k) => {
        const base = await k.extrude(SQ(0, 10), 5);
        const tool = await k.extrude(SQat(4, -2, 2), 9); // 2mm-wide blade spanning Y, taller
        if (!base || !tool) return null;
        return k.boolean('subtract', base.id, tool.id);
      },
    },
    // Full-turn revolve given 360 vs a hair under — seam-closure edge case.
    { label: 'revolve 359.99°', build: (k) => k.revolve(REVRECT(0, 10, 20), 359.99) },
    { label: 'revolve sliver 1°', build: (k) => k.revolve(REVRECT(0, 10, 20), 1) },
    // Fillet radius == half the wall (the rounding consumes the whole face).
    {
      label: 'fillet r2.5 on 5mm-thin box',
      build: async (k) => { const b = await k.extrude(SQ(0, 5), 5); return b ? k.fillet(b.id, ['sel:all'], 2.5) : null; },
    },
    // Astronomic offset (1e9) — beyond single-precision integer mantissa.
    { label: 'box at 1e9 offset', build: (k) => k.extrude(SQat(1_000_000_000, 0, 10), 5) },
    // Self-touching intersect: two boxes meeting at a single edge (zero-volume).
    {
      label: 'edge-touch intersect (zero vol)',
      build: async (k) => {
        const a = await k.extrude(SQ(0, 10), 5);
        const b = await k.extrude(SQat(10, 10, 10), 5); // touches a only at the corner edge
        if (!a || !b) return null;
        return k.boolean('intersect', a.id, b.id);
      },
    },
    // Mixed rounding by NAMED edges: fillet two verticals, then chamfer the other
    // two. Probes edge-id persistence across a topology-changing feature — the
    // named selectors 'e.vert.2/3' must still resolve on the filleted body.
    // (Measured 2026-06-08: returns null — chained named-edge selection after a
    // fillet is a documented limit, not yet stable.)
    {
      label: 'fillet→chamfer named-edge stack',
      build: async (k) => {
        const box = await k.extrude(SQ(0, 12), 6);
        if (!box) return null;
        const f = await k.fillet(box.id, ['e.vert.0', 'e.vert.1'], 1);
        return f ? k.chamfer(f.id, ['e.vert.2', 'e.vert.3'], 1) : null;
      },
    },
    // Draft taper then round-trip (exercises the optional draft op + tapered faces).
    {
      label: 'draft 8° taper',
      build: async (k) => {
        const b = await k.extrude(SQ(0, 10), 8);
        return b ? k.draft(b.id, { angleDeg: 8, neutralZ: 0 }) : null;
      },
    },
  ];
}

/**
 * Round-trip every case through STEP and check volume preservation. `volTol` is
 * the relative volume tolerance (default 0.1%). Never throws — a failed case is
 * recorded, not fatal, so one bad shape doesn't hide the rest.
 */
export async function runStepBurnIn(
  kernel: SolidKernel,
  cases: StepBurnInCase[] = defaultBurnInCases(),
  volTol = 1e-3,
): Promise<StepBurnInReport> {
  const failures: StepBurnInFailure[] = [];
  const recoveries: StepBurnInReport['recoveries'] = [];
  let passed = 0;

  for (const c of cases) {
    try {
      const shape = await c.build(kernel);
      if (!shape) { failures.push({ label: c.label, reason: 'build returned null' }); continue; }
      if (shape.recovery) recoveries.push({ label: c.label, ...shape.recovery });
      const v0 = shape.volume;
      if (!Number.isFinite(v0 as number) || Math.abs(v0 as number) < 1e-9) {
        failures.push({ label: c.label, reason: `built shape has no usable volume (${v0})` });
        kernel.release(shape.id);
        continue;
      }
      const step = await kernel.exportStep(shape.id);
      kernel.release(shape.id);
      if (!step || !step.startsWith('ISO-10303-21')) {
        failures.push({ label: c.label, reason: 'exportStep produced no ISO-10303-21 part' });
        continue;
      }
      const back = await kernel.importStep(step);
      if (!back) { failures.push({ label: c.label, reason: 'importStep returned null' }); continue; }
      const v1 = back.volume;
      kernel.release(back.id);
      const volErr = Math.abs((v1 as number) - (v0 as number)) / Math.max(Math.abs(v0 as number), 1e-9);
      if (!Number.isFinite(volErr) || volErr > volTol) {
        failures.push({ label: c.label, reason: 'volume not preserved across STEP', volErr });
        continue;
      }
      passed++;
    } catch (e) {
      failures.push({ label: c.label, reason: `threw: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const total = cases.length;
  return { total, passed, failures, passRate: total > 0 ? passed / total : 1, recoveries };
}
