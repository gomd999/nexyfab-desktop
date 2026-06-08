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
}

const SQ = (a: number, b: number): Array<{ x: number; y: number }> => [
  { x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b },
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
  const SQat = (x0: number, y0: number, size: number): Array<{ x: number; y: number }> => [
    { x: x0, y: y0 }, { x: x0 + size, y: y0 }, { x: x0 + size, y: y0 + size }, { x: x0, y: y0 + size },
  ];
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
  let passed = 0;

  for (const c of cases) {
    try {
      const shape = await c.build(kernel);
      if (!shape) { failures.push({ label: c.label, reason: 'build returned null' }); continue; }
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
  return { total, passed, failures, passRate: total > 0 ? passed / total : 1 };
}
