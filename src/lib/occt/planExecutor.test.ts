/**
 * planExecutor — run an OcctPlan through a mock OcctBridge (K1b, ADR-014).
 */
import { describe, it, expect } from 'vitest';
import { executeOcctPlan } from './planExecutor';
import { featureTreeToOcctPlan } from './featurePlan';
import type { OcctBridge, BooleanOperandIds } from './bridge';
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
  /** ids passed to each boolean call (W1-B/W3-A threading). */
  booleanIds: Array<BooleanOperandIds | undefined>;
}

/** Mock bridge: every op mints a fresh solid handle and records the call. */
function makeMockBridge(opts: { failOn?: string } = {}): { bridge: OcctBridge; track: MockTracker } {
  let n = 0;
  const track: MockTracker = { calls: [], released: [], booleanIds: [] };
  const mint = (): OcctShape => ({ id: `occt${++n}`, kind: 'solid' });
  const ok = (): OcctOperationResult => ({ ok: true, shape: mint(), warnings: [] });
  const failIf = (op: string): OcctOperationResult | null =>
    opts.failOn === op ? { ok: false, error: `mock fail: ${op}`, warnings: [] } : null;

  const bridge: OcctBridge = {
    async buildFromExtrude() { track.calls.push('extrude'); return failIf('extrude') ?? ok(); },
    async buildFromRevolve() { track.calls.push('revolve'); return failIf('revolve') ?? ok(); },
    boolean: {
      async union(_a, _b, ids) { track.calls.push('union'); track.booleanIds.push(ids); return failIf('union') ?? ok(); },
      async subtract(_a, _b, ids) { track.calls.push('subtract'); track.booleanIds.push(ids); return failIf('subtract') ?? ok(); },
      async intersect(_a, _b, ids) { track.calls.push('intersect'); track.booleanIds.push(ids); return failIf('intersect') ?? ok(); },
    },
    async fillet() { track.calls.push('fillet'); return failIf('fillet') ?? ok(); },
    async chamfer() { track.calls.push('chamfer'); return failIf('chamfer') ?? ok(); },
    async solidShell() { track.calls.push('solidShell'); return failIf('solidShell') ?? ok(); },
    async exportSTEP() { return ''; },
    async importSTEP() { return ok(); },
    async tessellate() { track.calls.push('tessellate'); return { ok: true, mesh: { positions: [], normals: [], edges: [], triangleCount: 0, edgeCount: 0, bounds: { center: [0, 0, 0], size: [0, 0, 0], radius: 0 } }, warnings: [] }; },
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

  it('open shell plan builds the body then invokes the exact solid-shell operation', async () => {
    const base = extrudeNode('base');
    const tree: FeatureTree = { nodes: [base, {
      id: 'shell1', name: 'shell1', dependencies: ['base'],
      payload: { kind: 'shell', childId: 'base', childExtrude: base.payload as ExtrudeFeature, thickness: 1, openBottomFace: true },
    }] };
    const { bridge, track } = makeMockBridge();
    const r = await executeOcctPlan(featureTreeToOcctPlan(tree), bridge);
    expect(r.ok).toBe(true);
    expect(track.calls).toEqual(['extrude', 'solidShell']);
    expect(r.finalShape).toBeDefined();
  });

  it('threads stable node ids into the boolean (W1-B/W3-A): base/tool/op', async () => {
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
    expect(track.booleanIds).toEqual([{ baseId: 'base', toolId: 'tool', opId: 'cut' }]);
  });

  it('a multi-tool fold gives each kernel boolean its own deterministic opId', async () => {
    const { bridge, track } = makeMockBridge();
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('base'),
        extrudeNode('t1'),
        extrudeNode('t2'),
        { id: 'cut', name: 'cut', dependencies: ['base', 't1', 't2'], payload: { kind: 'boolean', op: 'difference', bodies: ['base', 't1', 't2'] } },
      ],
    };
    const r = await executeOcctPlan(featureTreeToOcctPlan(tree), bridge);
    expect(r.ok).toBe(true);
    expect(track.booleanIds).toEqual([
      { baseId: 'base', toolId: 't1', opId: 'cut:t1' },
      { baseId: 'cut:t1', toolId: 't2', opId: 'cut:t2' },
    ]);
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
