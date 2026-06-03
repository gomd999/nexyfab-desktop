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

  it('fillet reports needs-K2 (stable edge ids) rather than a wrong result', async () => {
    if (!okLoad) return;
    const box = await bridge.buildFromExtrude({ kind: 'extrude', loop: SQ(0, 10), depth: 5, direction: 'one_sided', mode: 'add' });
    const f = await bridge.fillet(box.shape!, ['sel:all'], 1);
    expect(f.ok).toBe(false);
    expect(f.error).toMatch(/K2|edge/);
  });
});
