import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import {
  applyFeatureOp,
  featureTreeToYDoc,
  yDocToFeatureTree,
} from '../../shape-generator/collab/featureTreeYjs';
import type { FeatureHistory, HistoryNode } from '../../shape-generator/useFeatureStack';

const ORIGIN_REMOTE = 'remote-update';

function makeRoot(): HistoryNode {
  return {
    id: 'root',
    type: 'baseShape',
    label: 'Base',
    icon: '📦',
    params: { width: 100, height: 100, depth: 100 },
    enabled: true,
    expanded: true,
    parentId: null,
    children: [],
    editingActive: false,
    timestamp: 1,
  };
}

function makeFeat(id: string, params: Record<string, number> = { radius: 5 }): HistoryNode {
  return {
    id,
    type: 'feature',
    featureType: 'fillet',
    label: id,
    icon: '🔧',
    params,
    enabled: true,
    expanded: true,
    parentId: 'root',
    children: [],
    editingActive: false,
    timestamp: 1,
  };
}

function makeBase(): FeatureHistory {
  return {
    nodes: [makeRoot()],
    rootId: 'root',
    activeNodeId: 'root',
    editingNodeId: null,
  };
}

function pair() {
  const a = featureTreeToYDoc(makeBase());
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), ORIGIN_REMOTE);
  const sync = (from: Y.Doc, to: Y.Doc) =>
    Y.applyUpdate(to, Y.encodeStateAsUpdate(from), ORIGIN_REMOTE);
  return { a, b, sync };
}

function nodes(doc: Y.Doc): HistoryNode[] {
  return yDocToFeatureTree(doc).tree.nodes;
}

describe('collab-smoke-feature-tree harness convergence', () => {
  it('checklist #1: auto-sync mirrors addNode from A to B', () => {
    const { a, b, sync } = pair();
    for (let i = 0; i < 3; i++) {
      applyFeatureOp(a, { kind: 'addNode', node: makeFeat(`F-${i}`, { radius: i + 1 }) });
      sync(a, b);
    }
    expect(nodes(a)).toHaveLength(4);
    expect(nodes(b)).toHaveLength(4);
    expect(nodes(b).map(n => n.id)).toEqual(nodes(a).map(n => n.id));
  });

  it('checklist #2: concurrent different-id addNode merges to union', () => {
    const { a, b, sync } = pair();
    applyFeatureOp(a, { kind: 'addNode', node: makeFeat('F-A1') });
    applyFeatureOp(a, { kind: 'addNode', node: makeFeat('F-A2') });
    applyFeatureOp(b, { kind: 'addNode', node: makeFeat('F-B1') });
    applyFeatureOp(b, { kind: 'addNode', node: makeFeat('F-B2') });

    sync(a, b);
    sync(b, a);

    const ids = (doc: Y.Doc) => nodes(doc).map(n => n.id).sort();
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a).filter(id => id !== 'root')).toEqual(['F-A1', 'F-A2', 'F-B1', 'F-B2']);
  });

  it('checklist #3: concurrent updateParams converge per-key LWW', () => {
    const { a, b, sync } = pair();
    applyFeatureOp(a, { kind: 'addNode', node: makeFeat('F-shared', { radius: 5, segments: 8 }) });
    sync(a, b);

    // A sets radius. B sets segments (different key — both should survive).
    applyFeatureOp(a, { kind: 'updateParams', id: 'F-shared', params: { radius: 10 } });
    applyFeatureOp(b, { kind: 'updateParams', id: 'F-shared', params: { segments: 16 } });

    sync(a, b);
    sync(b, a);

    const find = (doc: Y.Doc) => nodes(doc).find(n => n.id === 'F-shared')!;
    expect(find(a).params).toEqual({ radius: 10, segments: 16 });
    expect(find(b).params).toEqual({ radius: 10, segments: 16 });
  });

  it('checklist #4: stress — 10 + 10 concurrent addNodes converge to 20+root', () => {
    const { a, b, sync } = pair();
    for (let i = 0; i < 10; i++) {
      applyFeatureOp(a, { kind: 'addNode', node: makeFeat(`F-A-${i}`) });
      applyFeatureOp(b, { kind: 'addNode', node: makeFeat(`F-B-${i}`) });
    }
    sync(a, b);
    sync(b, a);
    expect(nodes(a)).toHaveLength(21);
    expect(nodes(b)).toHaveLength(21);
    expect(nodes(a).map(n => n.id).sort()).toEqual(nodes(b).map(n => n.id).sort());
  });

  it('regression: setEnabled is per-node, does not affect siblings', () => {
    const { a, b, sync } = pair();
    applyFeatureOp(a, { kind: 'addNode', node: makeFeat('F1') });
    applyFeatureOp(a, { kind: 'addNode', node: makeFeat('F2') });
    sync(a, b);

    applyFeatureOp(a, { kind: 'setEnabled', id: 'F1', enabled: false });
    sync(a, b);

    const map = (doc: Y.Doc) =>
      Object.fromEntries(nodes(doc).filter(n => n.id !== 'root').map(n => [n.id, n.enabled]));
    expect(map(a)).toEqual({ F1: false, F2: true });
    expect(map(b)).toEqual({ F1: false, F2: true });
  });
});
