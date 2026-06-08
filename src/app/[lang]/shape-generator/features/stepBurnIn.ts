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
