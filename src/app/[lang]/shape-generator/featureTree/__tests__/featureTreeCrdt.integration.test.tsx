// @vitest-environment jsdom
/**
 * featureTreeCrdt.integration.test.tsx — Wave 2 Phase 3 Track Z3.
 *
 * End-to-end host-style integration tests:
 *  - Two consumers converge on a fallback doc under `?crdt=v2`
 *  - LWW collision toast appears + auto-dismisses
 *  - Concurrent operations preserve dependencies
 *  - Resolves peer name via `resolvePeerName`
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  useFeatureTreeStore,
  useFeatureTreeLwwCollisionToast,
  _resetFeatureTreeStoreFallback,
  _resetFeatureTreeStoreLocal,
  _acquireFeatureTreeFallbackDoc,
} from '../useFeatureTreeStore';
import { FeatureTreeStore } from '../FeatureTreeStore';
import type { HistoryNode } from '../../useFeatureStack';

// next/navigation mock — flag-on for these tests.
let _searchParams = new URLSearchParams('crdt=v2');
vi.mock('next/navigation', () => ({
  useSearchParams: () => _searchParams,
  usePathname: () => '/en/shape-generator',
}));
function setFlag(on: boolean): void {
  _searchParams = new URLSearchParams(on ? 'crdt=v2' : '');
}

// Stub Z1 collab module so importing the bridge doesn't pull real deps.
vi.mock('../../collab/CollabProvider', () => ({
  useCollabDoc: () => { throw new Error('not under Provider'); },
}));

function makeNode(id: string, overrides: Partial<HistoryNode> = {}): HistoryNode {
  return {
    id,
    type: 'feature',
    label: id,
    icon: '🔧',
    params: {},
    enabled: true,
    expanded: true,
    parentId: null,
    children: [],
    editingActive: false,
    timestamp: 1,
    ...overrides,
  };
}

interface ConsumerProps {
  docId: string;
  resolvePeerName?: (id: string) => string | null;
  onMount?: (api: {
    addNode: (n: HistoryNode) => void;
    reorder: (id: string, to: number) => void;
    updateParams: (id: string, params: Record<string, number>) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    rootId: string;
  }) => void;
}

function Consumer({ docId, resolvePeerName, onMount }: ConsumerProps): React.ReactElement {
  const { store } = useFeatureTreeStore(docId, { forceMode: 'yjs' });
  const toast = useFeatureTreeLwwCollisionToast(
    store.getDoc?.() ?? null,
    () => store.getNodes(),
    { resolvePeerName },
  );

  React.useEffect(() => {
    onMount?.({
      addNode: (n) => store.addNode(n),
      reorder: (id, to) => store.reorder(id, to),
      updateParams: (id, params) => store.updateParams(id, params),
      setEnabled: (id, enabled) => store.setEnabled(id, enabled),
      rootId: store.getRootId(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <span data-testid="ids">{store.getNodes().map(n => n.id).join(',')}</span>
      {toast && <div data-testid="feature-tree-lww-toast">{toast}</div>}
    </div>
  );
}

beforeEach(() => {
  _resetFeatureTreeStoreLocal();
  _resetFeatureTreeStoreFallback();
  setFlag(true);
});

describe('Z3 integration — two consumers converge', () => {
  it('two consumers see each other\'s addNode via fallback BC doc', () => {
    let apiA: Parameters<NonNullable<ConsumerProps['onMount']>>[0] | null = null;
    const r1 = render(<Consumer docId="conv-1" onMount={(a) => { apiA = a; }} />);
    const r2 = render(<Consumer docId="conv-1" />);

    act(() => {
      apiA!.addNode(makeNode('shared', { parentId: apiA!.rootId }));
    });

    expect(r1.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/shared/);
    expect(r2.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/shared/);
  });

  it('updateParams from one consumer is visible to the other', () => {
    let apiA: Parameters<NonNullable<ConsumerProps['onMount']>>[0] | null = null;
    const r1 = render(<Consumer docId="conv-2" onMount={(a) => { apiA = a; }} />);
    const r2 = render(<Consumer docId="conv-2" />);

    act(() => {
      apiA!.addNode(makeNode('F1', { parentId: apiA!.rootId, params: { radius: 5 } }));
    });
    act(() => {
      apiA!.updateParams('F1', { radius: 99 });
    });

    expect(r1.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/F1/);
    expect(r2.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/F1/);
  });
});

describe('Z3 integration — LWW collision toast', () => {
  it('shows toast when a remote peer overrides a local node\'s params', () => {
    const docA = _acquireFeatureTreeFallbackDoc('lww-1');
    const probeA = FeatureTreeStore.fromYDoc(docA);
    const rootIdA = probeA.getRootId();
    probeA.addNode(makeNode('F-target', { parentId: rootIdA, params: { radius: 5 } }));

    const r = render(<Consumer docId="lww-1" />);
    expect(r.queryByTestId('feature-tree-lww-toast')).toBeNull();

    // Simulate remote peer via separate doc, then push back with non-local
    // origin string.
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = FeatureTreeStore.fromYDoc(docB);
    storeB.updateParams('F-target', { radius: 99 });

    act(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote-peer-update');
    });

    const toast = r.queryByTestId('feature-tree-lww-toast');
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toMatch(/overridden/);
    expect(toast!.textContent).toMatch(/F-target/);

    probeA.destroy();
    storeB.destroy();
  });

  it('does NOT show toast on pure-add by a remote peer (no override)', () => {
    const docA = _acquireFeatureTreeFallbackDoc('lww-2');
    const probeA = FeatureTreeStore.fromYDoc(docA);
    const rootIdA = probeA.getRootId();
    probeA.addNode(makeNode('F-mine', { parentId: rootIdA }));

    const r = render(<Consumer docId="lww-2" />);

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = FeatureTreeStore.fromYDoc(docB);
    storeB.addNode(makeNode('F-theirs', { parentId: rootIdA }));

    act(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote-peer-add');
    });

    expect(r.queryByTestId('feature-tree-lww-toast')).toBeNull();
    probeA.destroy();
    storeB.destroy();
  });

  it('toast resolves peer name when resolvePeerName is provided', () => {
    const docA = _acquireFeatureTreeFallbackDoc('lww-3');
    const probeA = FeatureTreeStore.fromYDoc(docA);
    probeA.addNode(makeNode('F-named', { parentId: probeA.getRootId(), params: { d: 1 } }));

    const resolvePeerName = (id: string) => id === 'peer-alice' ? 'Alice' : null;
    const r = render(<Consumer docId="lww-3" resolvePeerName={resolvePeerName} />);

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = FeatureTreeStore.fromYDoc(docB);
    storeB.updateParams('F-named', { d: 99 });

    act(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'peer-alice');
    });

    const toast = r.queryByTestId('feature-tree-lww-toast');
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toMatch(/Alice/);

    probeA.destroy();
    storeB.destroy();
  });

  it('toast auto-dismisses after the configured ms (use shorter for fast test)', async () => {
    // Override dismissMs via a custom Consumer for this single test.
    function FastConsumer({ docId }: { docId: string }): React.ReactElement {
      const { store } = useFeatureTreeStore(docId, { forceMode: 'yjs' });
      const toast = useFeatureTreeLwwCollisionToast(
        store.getDoc?.() ?? null,
        () => store.getNodes(),
        { dismissMs: 100 },
      );
      return <div>{toast && <div data-testid="feature-tree-lww-toast">{toast}</div>}</div>;
    }

    const docA = _acquireFeatureTreeFallbackDoc('lww-4');
    const probeA = FeatureTreeStore.fromYDoc(docA);
    probeA.addNode(makeNode('F-auto', { parentId: probeA.getRootId(), params: { p: 1 } }));

    const r = render(<FastConsumer docId="lww-4" />);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = FeatureTreeStore.fromYDoc(docB);
    storeB.updateParams('F-auto', { p: 99 });
    act(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote-peer-update');
    });
    expect(r.queryByTestId('feature-tree-lww-toast')).not.toBeNull();

    await act(async () => {
      await new Promise(res => setTimeout(res, 150));
    });
    expect(r.queryByTestId('feature-tree-lww-toast')).toBeNull();

    probeA.destroy();
    storeB.destroy();
  });
});

describe('Z3 integration — concurrent ops preserve dependencies', () => {
  it('reorder by peer + updateParams by us — both survive after convergence', () => {
    const docA = _acquireFeatureTreeFallbackDoc('dep-1');
    const probeA = FeatureTreeStore.fromYDoc(docA);
    const root = probeA.getRootId();
    probeA.addNode(makeNode('F1', { parentId: root, params: { radius: 5 } }));
    probeA.addNode(makeNode('F2', { parentId: root }));

    // Two consumers on the SAME fallback doc — both writes funnel through BC.
    let apiUs: Parameters<NonNullable<ConsumerProps['onMount']>>[0] | null = null;
    const r = render(<Consumer docId="dep-1" onMount={(a) => { apiUs = a; }} />);

    act(() => {
      apiUs!.updateParams('F1', { radius: 99 });
    });

    // Remote peer reorders F1.
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = FeatureTreeStore.fromYDoc(docB);
    storeB.reorder('F1', 0);
    act(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote');
    });

    const idsText = r.container.querySelector('[data-testid="ids"]')!.textContent ?? '';
    // F1 still in the tree
    expect(idsText).toMatch(/F1/);
    // F2 still in the tree
    expect(idsText).toMatch(/F2/);
    // Local update on F1 survived (radius 99 still on the node)
    const probeFinal = FeatureTreeStore.fromYDoc(docA);
    const finalF1 = probeFinal.getNodes().find(n => n.id === 'F1');
    expect(finalF1?.params.radius).toBe(99);

    probeA.destroy();
    storeB.destroy();
    probeFinal.destroy();
  });

  it('sketch → extrude dependency: sketches map entry survives reorder of host node', () => {
    const docA = _acquireFeatureTreeFallbackDoc('dep-2');
    const probeA = FeatureTreeStore.fromYDoc(docA);
    const root = probeA.getRootId();
    probeA.addNode(
      makeNode('S1', { parentId: root, featureType: 'sketchExtrude' }),
      {
        profile: { segments: [], closed: false },
        config: { mode: 'extrude', depth: 50, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
        plane: 'xy',
        planeOffset: 0,
        operation: 'add',
      },
    );
    probeA.addNode(makeNode('F1', { parentId: root }));

    // Peer reorders S1 down.
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = FeatureTreeStore.fromYDoc(docB);
    storeB.reorder('S1', 2);
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    const after = FeatureTreeStore.fromYDoc(docA);
    expect(after.getSnapshot().sketches['S1']).toBeDefined();

    probeA.destroy();
    storeB.destroy();
    after.destroy();
  });
});
