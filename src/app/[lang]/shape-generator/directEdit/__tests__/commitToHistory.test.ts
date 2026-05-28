/**
 * commitToHistory.test.ts — Wave 2 Phase 3 Track E5 (W7).
 *
 * Tests for the pure mapper `directEditOpToHistoryNode`.
 *
 * Coverage:
 *   - Each known op kind (pushPull + reserved E2/E3 shapes)
 *   - Validation: invalid offset / radius / distance
 *   - Unknown op kind rejection
 *   - Context-passed-through: id allocation, activeNodeId parenting,
 *     getFaceFeatureId surfaced in dependsOn, getFaceNormal in params
 *   - Synthetic featureType marker for pushPull
 *   - DIRECT_EDIT_COMMITTED_PARAM_KEY sentinel always present
 */

import { describe, it, expect } from 'vitest';
import {
  directEditOpToHistoryNode,
  DIRECT_EDIT_COMMITTED_PARAM_KEY,
  type CommitContext,
} from '../commitToHistory';
import type { DirectEditOp } from '../directEditTypes';

function makeCtx(overrides: Partial<CommitContext> = {}): CommitContext {
  let counter = 0;
  return {
    nextNodeId: () => `node-${++counter}`,
    activeNodeId: 'root-active',
    getFaceFeatureId: () => 'owner-feat-1',
    now: () => 1700000000000,
    ...overrides,
  };
}

function pushPullOp(offset = 5, faceId = 'face-a'): DirectEditOp {
  return { kind: 'pushPull', faceId, offsetMm: offset, createdAt: 0 };
}

describe('directEditOpToHistoryNode — pushPull mapping', () => {
  it('maps a basic pushPull op to a HistoryNode', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.id).toBe('node-1');
    expect(r.node.type).toBe('feature');
    expect(r.node.featureType).toBe('pushPull'); // synthetic
    expect(r.node.parentId).toBe('root-active');
  });

  it('records offsetMm in params', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(pushPullOp(7.5), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.params.offsetMm).toBe(7.5);
  });

  it('stamps the committed-direct-edit sentinel in params', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.params[DIRECT_EDIT_COMMITTED_PARAM_KEY]).toBeGreaterThan(0);
  });

  it('rejects an offset of zero (degenerate)', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(pushPullOp(0), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_offset');
  });

  it('rejects a NaN offset', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(pushPullOp(Number.NaN), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_offset');
  });

  it('rejects an Infinity offset', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(
      pushPullOp(Number.POSITIVE_INFINITY),
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it('records ownerFeatureId in dependsOn when getFaceFeatureId returns one', () => {
    const ctx = makeCtx({ getFaceFeatureId: () => 'feat-X' });
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.dependsOn).toContain('feat-X');
    expect(r.node.dependsOn).toContain('root-active');
  });

  it('omits ownerFeatureId from dependsOn when getFaceFeatureId returns null', () => {
    const ctx = makeCtx({ getFaceFeatureId: () => null });
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.dependsOn).toEqual(['root-active']);
  });

  it('records face normal in _normalX/Y/Z params when getFaceNormal is provided', () => {
    const ctx = makeCtx({ getFaceNormal: () => [0, 1, 0] });
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.params._normalX).toBe(0);
    expect(r.node.params._normalY).toBe(1);
    expect(r.node.params._normalZ).toBe(0);
  });

  it('omits normal params when getFaceNormal is absent', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.params._normalX).toBeUndefined();
  });

  it('uses ctx.nextNodeId for the id', () => {
    let count = 0;
    const ctx = makeCtx({ nextNodeId: () => `custom-${++count}` });
    const r1 = directEditOpToHistoryNode(pushPullOp(5), ctx);
    const r2 = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r1.ok && r1.node.id).toBe('custom-1');
    expect(r2.ok && r2.node.id).toBe('custom-2');
  });

  it('uses ctx.activeNodeId as parentId', () => {
    const ctx = makeCtx({ activeNodeId: 'some-node-99' });
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok && r.node.parentId).toBe('some-node-99');
  });

  it('label includes the offset value', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(pushPullOp(12.34), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.label).toContain('12.34');
  });

  it('node is enabled and expanded by default', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.enabled).toBe(true);
    expect(r.node.expanded).toBe(true);
    expect(r.node.editingActive).toBe(false);
  });

  it('uses ctx.now for timestamp', () => {
    const ctx = makeCtx({ now: () => 999 });
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok && r.node.timestamp).toBe(999);
  });

  it('children array is empty for a freshly committed node', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(pushPullOp(5), ctx);
    expect(r.ok && r.node.children).toEqual([]);
  });
});

describe('directEditOpToHistoryNode — unknown / reserved op kinds', () => {
  it('rejects the reserved_W4_E2 placeholder', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(
      { kind: 'unknownTestKind' } as unknown as DirectEditOp,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unknown_op_kind');
  });

  it('rejects a truly unknown op kind', () => {
    const ctx = makeCtx();
    const r = directEditOpToHistoryNode(
      { kind: 'totally_unknown' } as unknown as DirectEditOp,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unknown_op_kind');
  });
});

describe('directEditOpToHistoryNode — forward-compat E2 dynamicFillet', () => {
  it('maps dynamicFillet → featureType: fillet', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'dynamicFillet',
      edgeId: 'edge-1',
      radius: 2,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.featureType).toBe('fillet');
    expect(r.node.params.radius).toBe(2);
  });

  it('rejects dynamicFillet with non-positive radius', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'dynamicFillet',
      edgeId: 'edge-1',
      radius: 0,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_radius');
  });

  it('synthesizes edgeSelections when geometry hints are present', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'dynamicFillet',
      edgeId: 'edge-1',
      radius: 1,
      edgePosition: [0, 0, 0],
      edgeLength: 10,
      faceNormal: [0, 1, 0],
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.edgeSelections).toBeDefined();
    expect(r.node.edgeSelections?.[0]?.persistentId).toBe('edge-1');
  });
});

describe('directEditOpToHistoryNode — forward-compat E2 dynamicChamfer', () => {
  it('maps dynamicChamfer → featureType: chamfer', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'dynamicChamfer',
      edgeId: 'edge-2',
      distance: 1.5,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.featureType).toBe('chamfer');
    expect(r.node.params.distance).toBe(1.5);
  });

  it('rejects dynamicChamfer with non-positive distance', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'dynamicChamfer',
      edgeId: 'edge-2',
      distance: -0.1,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_distance');
  });
});

describe('directEditOpToHistoryNode — forward-compat E3 moveBody', () => {
  it('maps moveBody → featureType: moveCopy with offsetX/Y/Z', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'moveBody',
      tx: 10,
      ty: 20,
      tz: 30,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.featureType).toBe('moveCopy');
    expect(r.node.params.offsetX).toBe(10);
    expect(r.node.params.offsetY).toBe(20);
    expect(r.node.params.offsetZ).toBe(30);
    expect(r.node.params.operation).toBe(0); // 0 = move
  });

  it('rejects moveBody with NaN component', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'moveBody',
      tx: 0,
      ty: Number.NaN,
      tz: 0,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(false);
  });
});

describe('directEditOpToHistoryNode — forward-compat E3 rotateBody', () => {
  it('maps rotateBody → featureType: moveCopy with _rotateX/Y/Z', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'rotateBody',
      rx: 0.1,
      ry: 0.2,
      rz: 0.3,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.featureType).toBe('moveCopy');
    expect(r.node.params._rotateX).toBe(0.1);
    expect(r.node.params._rotateY).toBe(0.2);
    expect(r.node.params._rotateZ).toBe(0.3);
  });

  it('rejects rotateBody with all-zero rotation', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'rotateBody',
      rx: 0,
      ry: 0,
      rz: 0,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(false);
  });

  it('tolerates partial rotation (only one axis populated)', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'rotateBody',
      rz: 1.57,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(true);
  });
});

describe('directEditOpToHistoryNode — E4 subtractBody', () => {
  it('maps subtractBody → featureType: boolean with operation=1', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'subtractBody',
      targetBodyId: 'target-A',
      toolBodyId: 'tool-B',
      keepTool: false,
      createdAt: 0,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.featureType).toBe('boolean');
    // operation=1 in the boolean feature dict = 'subtract'.
    expect(r.node.params.operation).toBe(1);
  });

  it('records target/tool body hashes in params', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'subtractBody',
      targetBodyId: 'target-X',
      toolBodyId: 'tool-Y',
      keepTool: false,
      createdAt: 0,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.node.params._targetBodyHash).toBe('number');
    expect(typeof r.node.params._toolBodyHash).toBe('number');
    // Different ids → different hashes.
    expect(r.node.params._targetBodyHash).not.toBe(r.node.params._toolBodyHash);
  });

  it('records keepTool flag as 0 or 1', () => {
    const ctx = makeCtx();
    const r1 = directEditOpToHistoryNode(
      {
        kind: 'subtractBody',
        targetBodyId: 't',
        toolBodyId: 'u',
        keepTool: true,
      } as unknown as DirectEditOp,
      ctx,
    );
    expect(r1.ok && r1.node.params._keepTool).toBe(1);
    const r2 = directEditOpToHistoryNode(
      {
        kind: 'subtractBody',
        targetBodyId: 't',
        toolBodyId: 'u',
        keepTool: false,
      } as unknown as DirectEditOp,
      ctx,
    );
    expect(r2.ok && r2.node.params._keepTool).toBe(0);
  });

  it('rejects subtractBody with same target/tool ids', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'subtractBody',
      targetBodyId: 'same',
      toolBodyId: 'same',
      keepTool: false,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(false);
  });

  it('rejects subtractBody with empty ids', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'subtractBody',
      targetBodyId: '',
      toolBodyId: 'u',
      keepTool: false,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(false);
  });

  it('stamps the committed-direct-edit sentinel on subtract nodes', () => {
    const ctx = makeCtx();
    const op = {
      kind: 'subtractBody',
      targetBodyId: 't',
      toolBodyId: 'u',
      keepTool: false,
    } as unknown as DirectEditOp;
    const r = directEditOpToHistoryNode(op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.params._directEditCommitted).toBeGreaterThan(0);
  });
});
