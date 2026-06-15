// @vitest-environment node
/**
 * solidKernelCeiling.kseries — proves the `SolidKernel` FACADE (the adapter that
 * UI consumers call, not the raw worker RPC) executes the kernel-CEILING ops
 * that replicad cannot: buildPlanarFace → thicken (BRepOffsetAPI_MakeThickSolid).
 *
 * This is the facade-level companion to:
 *   - `src/lib/occt/ceilingSpike.thicken.test.ts` (raw `oc` module)
 *   - `e2e/occt/wasm-real.spec.ts` W1/W2 (browser worker, real wasm)
 *
 * Here we drive the SAME facade the W3 routing + future "Thicken" UI feature
 * use, but over the headless Node bridge (real opencascade.js) so it's fast and
 * deterministic. Self-skips when the WASM isn't loadable (mirrors the spike).
 *
 * Run: `npx vitest run solidKernelCeiling.kseries`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcctNode, type OcctModule } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { createKSeriesKernel, type SolidKernel } from './solidKernel';

let oc: OcctModule | null = null;
beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) oc = r.oc;
  else console.warn(`[solidKernelCeiling] skipped — ${r.reason}`);
}, 60_000);

// A 10×10 square sheet at z=0.
const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('SolidKernel facade — kernel-ceiling ops via the K-series bridge', () => {
  it('buildPlanarFace → thicken yields a solid of the expected volume', async () => {
    if (!oc) return; // WASM unavailable in this env — skip like the spike
    const kernel: SolidKernel = createKSeriesKernel(createNodeOcctBridge(oc));

    const face = await kernel.buildPlanarFace(SQUARE, 0);
    expect(face, 'buildPlanarFace must return a shape').not.toBeNull();
    expect(face!.kind).toBe('face');

    const solid = await kernel.thicken(face!.id, 2);
    expect(solid, 'thicken must return a solid (the replicad-impossible ceiling op)').not.toBeNull();
    expect(solid!.kind).toBe('solid');
    // 10×10 sheet thickened by 2 → ~200 mm³. Generous bound: edge/cap handling
    // varies slightly by build (matches the spike's tolerance).
    expect(Math.abs(solid!.volume ?? 0)).toBeGreaterThan(200 * 0.6);
    expect(Math.abs(solid!.volume ?? 0)).toBeLessThan(200 * 1.4);

    kernel.release(face!.id);
    kernel.release(solid!.id);
  });

  it('rejects a non-positive thickness without throwing', async () => {
    if (!oc) return;
    const kernel: SolidKernel = createKSeriesKernel(createNodeOcctBridge(oc));
    const face = await kernel.buildPlanarFace(SQUARE, 0);
    expect(face).not.toBeNull();
    const bad = await kernel.thicken(face!.id, 0);
    expect(bad, 'thickness 0 → null (no solid), not a throw').toBeNull();
    kernel.release(face!.id);
  });
});

// A 20×20 square centred on the origin (−10..10), so two oriented copies share
// the origin region and can actually cross.
const CENTERED = [
  { x: -10, y: -10 },
  { x: 10, y: -10 },
  { x: 10, y: 10 },
  { x: -10, y: 10 },
];

describe('SolidKernel facade — surfaceTrim (kernel-ceiling section)', () => {
  it('sections two CROSSING oriented faces into intersection edges', async () => {
    if (!oc) return;
    const kernel: SolidKernel = createKSeriesKernel(createNodeOcctBridge(oc));
    // XY-plane face (normal +Z) and XZ-plane face (normal +Y) both span the
    // origin → they cross along the X axis. buildPlanarFace (XY-only) couldn't
    // produce a non-parallel pair, which is why surfaceTrim was unusable.
    const fa = await kernel.buildPlanarFaceOriented(CENTERED, [0, 0, 0], [0, 0, 1]);
    const fb = await kernel.buildPlanarFaceOriented(CENTERED, [0, 0, 0], [0, 1, 0]);
    expect(fa, 'oriented face A').not.toBeNull();
    expect(fb, 'oriented face B').not.toBeNull();

    const section = await kernel.surfaceTrim(fa!.id, fb!.id);
    expect(section, 'crossing faces must yield a section (intersection edges)').not.toBeNull();

    kernel.release(fa!.id);
    kernel.release(fb!.id);
    kernel.release(section!.id);
  });

  it('returns null when the two faces do NOT intersect (parallel, offset)', async () => {
    if (!oc) return;
    const kernel: SolidKernel = createKSeriesKernel(createNodeOcctBridge(oc));
    // Two parallel XY faces at different z never meet → no section.
    const fa = await kernel.buildPlanarFaceOriented(CENTERED, [0, 0, 0], [0, 0, 1]);
    const fb = await kernel.buildPlanarFaceOriented(CENTERED, [0, 0, 50], [0, 0, 1]);
    const section = await kernel.surfaceTrim(fa!.id, fb!.id);
    expect(section).toBeNull();
    kernel.release(fa!.id);
    kernel.release(fb!.id);
  });
});
