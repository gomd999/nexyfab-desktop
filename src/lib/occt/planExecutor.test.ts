/**
 * planExecutor — run an OcctPlan through a mock OcctBridge (K1b, ADR-014).
 */
import { describe, it, expect } from 'vitest';
import { executeOcctPlan } from './planExecutor';
import { featureTreeToOcctPlan } from './featurePlan';
import type { OcctBridge } from './bridge';
import type { OcctShape, OcctOperationResult } from './types';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

function extrudeNode(id: string): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    depth: 5, direction: 'one_sided', mode: 'add',
  };
  return { id, name: id, dependencies: [], payload };
}

interface MockTracker {
  calls: string[];
  released: string[];
}

/** Mock bridge: every op mints a fresh solid handle and records the call. */
function makeMockBridge(opts: { failOn?: string } = {}): { bridge: OcctBridge; track: MockTracker } {
  let n = 0;
  const track: MockTracker = { calls: [], released: [] };
  const mint = (): OcctShape => ({ id: `occt${++n}`, kind: 'solid' });
  const ok = (): OcctOperationResult => ({ ok: true, shape: mint(), warnings: [] });
  const failIf = (op: string): OcctOperationResult | null =>
    opts.failOn === op ? { ok: false, error: `mock fail: ${op}`, warnings: [] } : null;

  const bridge: OcctBridge = {
    async buildFromExtrude() { track.calls.push('extrude'); return failIf('extrude') ?? ok(); },
    async buildFromRevolve() { track.calls.push('revolve'); return failIf('revolve') ?? ok(); },
    boolean: {
      async union() { track.calls.push('union'); return failIf('union') ?? ok(); },
      async subtract() { track.calls.push('subtract'); return failIf('subtract') ?? ok(); },
      async intersect() { track.calls.push('intersect'); return failIf('intersect') ?? ok(); },
    },
    async fillet() { track.calls.push('fillet'); return failIf('fillet') ?? ok(); },
    async chamfer() { track.calls.push('chamfer'); return failIf('chamfer') ?? ok(); },
    async exportSTEP() { return ''; },
    async importSTEP() { return ok(); },
    release(s) { track.released.push(s.id); },
  };
  return { bridge, track };
}

describe('executeOcctPlan', () => {
  it('extrude-only plan → finalShape is the built solid', async () => {
    const { bridge, track } = makeMockBridge();
    const plan = featureTreeToOcctPlan({ nodes: [extrudeNode('e1')] });
    const r = await executeOcctPlan(plan, bridge);
    expect(r.ok).toBe(true);
    expect(r.finalShape).toBeDefined();
    expect(track.calls).toEqual(['extrude']);
    expect(r.results.e1).toBe(r.finalShape);
  });

  it('box − cylinder: builds both, subtracts, final = the boolean; intermediates released', async () => {
    const { bridge, track } = makeMockBridge();
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('base'),
        extrudeNode('tool'),
        { id: 'cut', name: 'cut', dependencies: ['base', 'tool'], payload: { kind: 'boolean', op: 'difference', bodies: ['base', 'tool'] } },
      ],
    };
    const r = await executeOcctPlan(featureTreeToOcctPlan(tree), bridge);
    expect(r.ok).toBe(true);
    expect(track.calls).toEqual(['extrude', 'extrude', 'subtract']);
    // base + tool handles released; the final boolean handle is NOT released.
    expect(track.released.length).toBe(2);
    expect(track.released).not.toContain(r.finalShape!.id);
  });

  it('fillet plan: builds the inline body then fillets it', async () => {
    const child: ExtrudeFeature = {
      kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      depth: 5, direction: 'one_sided', mode: 'add',
    };
    const tree: FeatureTree = {
      nodes: [{ id: 'f1', name: 'f1', dependencies: [], payload: { kind: 'fillet', childExtrude: child, radius: 2, edgeSelection: 'all' } }],
    };
    const { bridge, track } = makeMockBridge();
    const r = await executeOcctPlan(featureTreeToOcctPlan(tree), bridge);
    expect(r.ok).toBe(true);
    expect(track.calls).toEqual(['extrude', 'fillet']);
    expect(r.finalShape).toBeDefined();
  });

  it('aborts on the first failed op and releases what was built', async () => {
    const { bridge, track } = makeMockBridge({ failOn: 'subtract' });
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('base'), extrudeNode('tool'),
        { id: 'cut', name: 'cut', dependencies: ['base', 'tool'], payload: { kind: 'boolean', op: 'difference', bodies: ['base', 'tool'] } },
      ],
    };
    const r = await executeOcctPlan(featureTreeToOcctPlan(tree), bridge);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/subtract/);
    // The two extrude handles built before the failure are released.
    expect(track.released.length).toBe(2);
  });

  it('skips unsupported nodes without failing (SCAD fallback territory)', async () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('e1'),
        { id: 'lp', name: 'lp', dependencies: ['e1'], payload: { kind: 'linear_pattern', childScad: 'cube(1);', count: 3, direction: { x: 1, y: 0, z: 0 }, spacing: 5 } },
      ],
    };
    const { bridge, track } = makeMockBridge();
    const r = await executeOcctPlan(featureTreeToOcctPlan(tree), bridge);
    expect(r.ok).toBe(true);
    expect(track.calls).toEqual(['extrude']); // only the supported node ran
    expect(r.finalShape).toBeDefined();
  });
});
