// @vitest-environment node
/**
 * solidKernelStep.kseries — proves the K-series facade can READ STEP back into a
 * true OCCT B-rep solid (not a mesh): extrude → exportStep → importStep, and the
 * re-imported solid's volume matches. This is the capability behind a "B-rep
 * STEP import" (gap #3): native STEP read via STEPControl_Reader, vs the current
 * UI path (occt-import-js → tessellated mesh). Headless (Node bridge, real
 * opencascade.js), self-skips when the WASM isn't available.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcctNode, type OcctModule } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { createKSeriesKernel, type SolidKernel } from './solidKernel';

let oc: OcctModule | null = null;
beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) oc = r.oc;
  else console.warn(`[solidKernelStep] skipped — ${r.reason}`);
}, 60_000);

// 20 × 10 rectangle, extruded 5 → 1000 mm³ box.
const RECT = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
];

describe('SolidKernel facade — STEP B-rep round-trip', () => {
  it('extrude → exportStep → importStep recovers a solid of the same volume', async () => {
    if (!oc) return;
    const kernel: SolidKernel = createKSeriesKernel(createNodeOcctBridge(oc));

    const box = await kernel.extrude(RECT, 5);
    expect(box, 'extrude must produce a solid').not.toBeNull();
    const v0 = Math.abs(box!.volume ?? 0);
    expect(v0).toBeGreaterThan(900); // ~1000 mm³

    const step = await kernel.exportStep(box!.id);
    expect(step, 'exportStep must return STEP text').toBeTruthy();
    expect(step!).toContain('ISO-10303-21'); // STEP file header

    const imported = await kernel.importStep(step!);
    expect(imported, 'importStep must read the STEP back into a shape').not.toBeNull();
    expect(imported!.kind).toBe('solid'); // a B-rep solid, not a mesh
    expect(Math.abs(imported!.volume ?? 0)).toBeCloseTo(v0, -1); // same volume (±~10)

    kernel.release(box!.id);
    kernel.release(imported!.id);
  });

  it('rejects empty/garbage STEP source without throwing', async () => {
    if (!oc) return;
    const kernel: SolidKernel = createKSeriesKernel(createNodeOcctBridge(oc));
    const bad = await kernel.importStep('not a step file');
    expect(bad).toBeNull();
  });
});
