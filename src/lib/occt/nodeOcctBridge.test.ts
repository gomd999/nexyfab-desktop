// @vitest-environment node
/**
 * nodeOcctBridge — K1b-real: feature tree → plan → executeOcctPlan → REAL OCCT
 * B-rep. Skips gracefully if the wasm isn't available.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcctNode } from './nodeOcctLoader';
import { createNodeOcctBridge } from './nodeOcctBridge';
import { featureTreeToOcctPlan } from './featurePlan';
import { executeOcctPlan } from './planExecutor';
import type { OcctBridge } from './bridge';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

let okLoad = false;
let bridge: OcctBridge;

beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) { bridge = createNodeOcctBridge(r.oc); okLoad = true; }
  else console.warn(`[occt] bridge tests skipped — ${r.reason}`);
}, 60_000);

function extrudeNode(id: string, loop: Array<{ x: number; y: number }>, depth: number): FeatureNode {
  const payload: ExtrudeFeature = { kind: 'extrude', loop, depth, direction: 'one_sided', mode: 'add' };
  return { id, name: id, dependencies: [], payload };
}
const SQ = (a: number, b: number): Array<{ x: number; y: number }> => [
  { x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b },
];

describe('nodeOcctBridge (real OCCT)', () => {
  it('buildFromExtrude makes a real solid with the right volume', async () => {
    if (!okLoad) return;
    const r = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    expect(r.ok).toBe(true);
    expect(r.shape?.kind).toBe('solid');
    expect(r.shape?.volume).toBeCloseTo(500, 1); // 10×10×5
    // bbox carries OCCT's small gap tolerance → compare approximately.
    expect(r.shape?.bbox).toBeDefined();
    expect(r.shape!.bbox!.max.x).toBeCloseTo(10, 1);
    expect(r.shape!.bbox!.max.y).toBeCloseTo(10, 1);
    expect(r.shape!.bbox!.max.z).toBeCloseTo(5, 1);
    expect(r.shape!.bbox!.min.x).toBeCloseTo(0, 1);
  });

  it('real boolean subtract removes the tool volume', async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    const tool = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(3, 7), depth: 7, direction: 'one_sided', mode: 'add' });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!);
    expect(cut.ok).toBe(true);
    expect(cut.shape?.volume).toBeCloseTo(420, 1); // 500 − 4×4×5
  });

  it('END-TO-END: feature tree → plan → executeOcctPlan → real holed solid', async () => {
    if (!okLoad) return;
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('base', SQ(0, 10), 5),
        extrudeNode('tool', SQ(3, 7), 7),
        { id: 'cut', name: 'cut', dependencies: ['base', 'tool'], payload: { kind: 'boolean', op: 'difference', bodies: ['base', 'tool'] } },
      ],
    };
    const plan = featureTreeToOcctPlan(tree);
    const r = await executeOcctPlan(plan, bridge);
    expect(r.ok).toBe(true);
    expect(r.finalShape?.volume).toBeCloseTo(420, 1);
  });

  it('K3: fillet rounds the named vertical edges (stable name → real OCCT edge)', async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    // The 4 vertical corner edges by their stable topoNaming names.
    const f = await bridge.fillet(box.shape!, ['e.vert.0', 'e.vert.1', 'e.vert.2', 'e.vert.3'], 1);
    expect(f.ok).toBe(true);
    // 500 − 4 corners each losing (1 − π/4)·r²·h = (1−0.7854)·1·5 ≈ 1.073 → ≈ 495.71
    expect(f.shape?.volume).toBeCloseTo(495.71, 1);
  });

  it('K3: fillet sel:all rounds every edge', async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    const f = await bridge.fillet(box.shape!, ['sel:all'], 1);
    expect(f.ok).toBe(true);
    expect(f.shape!.volume).toBeLessThan(500);   // material removed
    expect(f.shape!.volume).toBeGreaterThan(470);
  });

  it('K3: chamfer the named vertical edges', async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    const c = await bridge.chamfer(box.shape!, ['e.vert.0', 'e.vert.1', 'e.vert.2', 'e.vert.3'], 1);
    expect(c.ok).toBe(true);
    // 45° chamfer dist 1 removes a triangular prism per corner: 0.5·1·1·5 = 2.5 → 500 − 4·2.5 = 490
    expect(c.shape?.volume).toBeCloseTo(490, 0);
  });

  it('K2.2: name-based fillet works on a composed (boolean) shape', async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    const tool = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(3, 7), depth: 7, direction: 'one_sided', mode: 'add' });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!); // 420, with a 4×4 through-pocket
    // The base's outer vertical edges survived the cut → inherited as a/e.vert.*.
    const f = await bridge.fillet(cut.shape!, ['a/e.vert.0'], 1);
    expect(f.ok).toBe(true);
    expect(f.shape!.volume).toBeLessThan(420);   // one corner rounded
    expect(f.shape!.volume).toBeGreaterThan(415);
  });

  it('K2.2: an unknown name on a composed shape still errors clearly', async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    const tool = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(3, 7), depth: 7, direction: 'one_sided', mode: 'add' });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!);
    const f = await bridge.fillet(cut.shape!, ['e.vert.0'], 1); // un-prefixed → not a composed name
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/unresolved|unknown/);
  });

  it('K4: exportSTEP emits an ISO-10303-21 part', async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    const step = await bridge.exportSTEP(box.shape!);
    expect(step.startsWith('ISO-10303-21')).toBe(true);
    expect(step).toMatch(/MANIFOLD_SOLID_BREP|ADVANCED_BREP_SHAPE_REPRESENTATION|CLOSED_SHELL/);
    expect(step).toContain('END-ISO-10303-21');
  });

  it('K4: STEP round-trips a real solid with volume preserved', async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    const step = await bridge.exportSTEP(box.shape!);
    const back = await bridge.importSTEP(step);
    expect(back.ok).toBe(true);
    expect(back.shape?.kind).toBe('solid');
    expect(back.shape?.volume).toBeCloseTo(500, 1);
  });

  it('K4: a holed solid survives the STEP round trip', async () => {
    if (!okLoad) return;
    const base = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    const tool = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(3, 7), depth: 7, direction: 'one_sided', mode: 'add' });
    const cut = await bridge.boolean.subtract(base.shape!, tool.shape!);
    const step = await bridge.exportSTEP(cut.shape!);
    const back = await bridge.importSTEP(step);
    expect(back.ok).toBe(true);
    expect(back.shape?.volume).toBeCloseTo(420, 1);
  });

  it('K4: importSTEP rejects garbage cleanly', async () => {
    if (!okLoad) return;
    const back = await bridge.importSTEP('not a step file at all');
    expect(back.ok).toBe(false);
    expect(back.error).toMatch(/importSTEP/);
  });
});
