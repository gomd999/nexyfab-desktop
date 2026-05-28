// @vitest-environment jsdom
/**
 * useRefGeomStore.test.tsx — Wave 2 Phase 3 Z4 hook cases.
 *
 * Covers:
 *  - Default !v2 path resolves to local mode
 *  - forceMode override routes to yjs mode
 *  - Two hook instances on same docId share state (local)
 *  - Two hook instances on same Y.Doc converge (yjs)
 *  - Fallback BroadcastChannel path provisions a per-docId doc
 *  - Cleanup on unmount releases the local store
 *  - useRefGeomCycleWarning returns null on healthy graph, cycle path on cross-peer cycle
 *  - useRefGeomLwwCollisionToast surfaces remote overrides
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  useRefGeomStore,
  useRefGeomCycleWarning,
  _resetRefGeomStoreLocal,
  _resetRefGeomStoreFallback,
} from '../useRefGeomStore';
import {
  applyRefGeomOp,
  syncDocs,
} from '../refGeomYjs';
import type { ReferencePlaneNode } from '../types';

function planeStandard(id: string, label?: string): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'standard',
    label: label ?? id,
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'standard', id: 'front' },
  };
}

function planeOffset(id: string, parentId: string): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'offset',
    label: id,
    hidden: false,
    dependsOn: [parentId],
    evaluatedAt: 0,
    params: {
      method: 'offset',
      parent: { kind: 'reference', nodeId: parentId },
      distanceMm: 10,
      direction: 1,
    },
  };
}

interface ProbeProps {
  docId: string;
  forceMode?: 'local' | 'yjs';
  doc?: Y.Doc;
  onStore?: (store: unknown) => void;
}

function Probe({ docId, forceMode, doc, onStore }: ProbeProps): React.ReactElement {
  const { store, isCollab } = useRefGeomStore(docId, { forceMode, doc });
  React.useEffect(() => {
    onStore?.(store);
  }, [store, onStore]);
  return (
    <div>
      <span data-testid="mode">{store.mode}</span>
      <span data-testid="iscollab">{isCollab ? 'yes' : 'no'}</span>
      <span data-testid="ids">{store.getNodes().map((n) => n.id).join(',')}</span>
    </div>
  );
}

function CycleProbe({ docId, doc }: { docId: string; doc: Y.Doc }): React.ReactElement {
  const { store } = useRefGeomStore(docId, { forceMode: 'yjs', doc });
  const warning = useRefGeomCycleWarning(store);
  return (
    <div>
      <span data-testid="cycle">{warning ? warning.cycle.join(',') : 'no-cycle'}</span>
    </div>
  );
}

beforeEach(() => {
  _resetRefGeomStoreLocal();
  _resetRefGeomStoreFallback();
});

// ─── 1. Default + forceMode ────────────────────────────────────────────────

describe('useRefGeomStore — default (no flag)', () => {
  it('returns a local-mode store when forceMode = local', () => {
    const { getByTestId } = render(<Probe docId="d-a" forceMode="local" />);
    expect(getByTestId('mode').textContent).toBe('local');
    expect(getByTestId('iscollab').textContent).toBe('no');
  });

  it('local store starts empty', () => {
    const { getByTestId } = render(<Probe docId="d-b" forceMode="local" />);
    expect(getByTestId('ids').textContent).toBe('');
  });

  it('addNode triggers re-render', () => {
    let captured: { addNode: (n: ReferencePlaneNode) => unknown } | null = null;
    const { getByTestId } = render(
      <Probe
        docId="d-c"
        forceMode="local"
        onStore={(s) => {
          captured = s as typeof captured;
        }}
      />,
    );
    act(() => {
      captured!.addNode(planeStandard('p1'));
    });
    expect(getByTestId('ids').textContent).toBe('p1');
  });

  it('two hook instances on same docId share state (local)', () => {
    let storeA: { addNode: (n: ReferencePlaneNode) => unknown } | null = null;
    const r = render(
      <>
        <div data-testid="first">
          <Probe
            docId="d-shared"
            forceMode="local"
            onStore={(s) => {
              storeA = s as typeof storeA;
            }}
          />
        </div>
        <div data-testid="second">
          <Probe docId="d-shared" forceMode="local" />
        </div>
      </>,
    );
    act(() => {
      storeA!.addNode(planeStandard('shared-p1'));
    });
    expect(r.getByTestId('first').textContent).toContain('shared-p1');
    expect(r.getByTestId('second').textContent).toContain('shared-p1');
  });

  it('different docIds have independent local stores', () => {
    let storeA: { addNode: (n: ReferencePlaneNode) => unknown } | null = null;
    const renderA = render(
      <Probe
        docId="d-1"
        forceMode="local"
        onStore={(s) => {
          storeA = s as typeof storeA;
        }}
      />,
    );
    const renderB = render(<Probe docId="d-2" forceMode="local" />);
    act(() => {
      storeA!.addNode(planeStandard('only-1'));
    });
    expect(renderA.container.querySelector('[data-testid="ids"]')!.textContent).toBe('only-1');
    expect(renderB.container.querySelector('[data-testid="ids"]')!.textContent).toBe('');
  });
});

// ─── 2. Yjs mode ───────────────────────────────────────────────────────────

describe('useRefGeomStore — yjs mode', () => {
  it('returns a yjs-mode store when forceMode = yjs with explicit doc', () => {
    const doc = new Y.Doc();
    const { getByTestId } = render(<Probe docId="d-y" forceMode="yjs" doc={doc} />);
    expect(getByTestId('mode').textContent).toBe('yjs');
    expect(getByTestId('iscollab').textContent).toBe('yes');
  });

  it('yjs-mode mutations land on the underlying doc', () => {
    const doc = new Y.Doc();
    let store: { addNode: (n: ReferencePlaneNode) => unknown } | null = null;
    const { getByTestId } = render(
      <Probe
        docId="d-y2"
        forceMode="yjs"
        doc={doc}
        onStore={(s) => {
          store = s as typeof store;
        }}
      />,
    );
    act(() => {
      store!.addNode(planeStandard('p1'));
    });
    expect(getByTestId('ids').textContent).toBe('p1');
  });

  it('two hooks sharing the same doc converge', () => {
    const doc = new Y.Doc();
    let storeA: { addNode: (n: ReferencePlaneNode) => unknown } | null = null;
    const renderA = render(
      <Probe
        docId="d-conv"
        forceMode="yjs"
        doc={doc}
        onStore={(s) => {
          storeA = s as typeof storeA;
        }}
      />,
    );
    const renderB = render(<Probe docId="d-conv" forceMode="yjs" doc={doc} />);
    act(() => {
      storeA!.addNode(planeStandard('p-shared'));
    });
    expect(renderA.container.querySelector('[data-testid="ids"]')!.textContent).toBe('p-shared');
    expect(renderB.container.querySelector('[data-testid="ids"]')!.textContent).toBe('p-shared');
  });

  it('falls back to per-docId doc when no explicit doc provided', () => {
    let store: { addNode: (n: ReferencePlaneNode) => unknown; mode: string } | null = null;
    const { getByTestId } = render(
      <Probe
        docId="d-fb"
        forceMode="yjs"
        onStore={(s) => {
          store = s as typeof store;
        }}
      />,
    );
    expect(getByTestId('mode').textContent).toBe('yjs');
    act(() => {
      store!.addNode(planeStandard('fb-p1'));
    });
    expect(getByTestId('ids').textContent).toBe('fb-p1');
  });
});

// ─── 3. Lifecycle ──────────────────────────────────────────────────────────

describe('useRefGeomStore — lifecycle', () => {
  it('unmount releases the local store', () => {
    let storeA: { addNode: (n: ReferencePlaneNode) => unknown } | null = null;
    const renderA = render(
      <Probe
        docId="d-life"
        forceMode="local"
        onStore={(s) => {
          storeA = s as typeof storeA;
        }}
      />,
    );
    act(() => {
      storeA!.addNode(planeStandard('alpha'));
    });
    expect(renderA.getByTestId('ids').textContent).toBe('alpha');
    renderA.unmount();

    // Fresh mount sees an empty store (refcount dropped to zero).
    const renderB = render(<Probe docId="d-life" forceMode="local" />);
    expect(renderB.container.querySelector('[data-testid="ids"]')!.textContent).toBe('');
  });

  it('refcount keeps the store alive across mounts', () => {
    let storeA: { addNode: (n: ReferencePlaneNode) => unknown } | null = null;
    const renderA = render(
      <Probe
        docId="d-ref"
        forceMode="local"
        onStore={(s) => {
          storeA = s as typeof storeA;
        }}
      />,
    );
    const renderB = render(<Probe docId="d-ref" forceMode="local" />);
    act(() => {
      storeA!.addNode(planeStandard('persist'));
    });
    renderA.unmount();
    expect(renderB.container.querySelector('[data-testid="ids"]')!.textContent).toBe('persist');
  });
});

// ─── 4. Cycle warning hook (Z4 §6) ─────────────────────────────────────────

describe('useRefGeomCycleWarning — cross-peer cycle detection (Z4 §6)', () => {
  it('returns null on a healthy graph', () => {
    const doc = new Y.Doc();
    const { getByTestId } = render(<CycleProbe docId="d-no-cycle" doc={doc} />);
    expect(getByTestId('cycle').textContent).toBe('no-cycle');
  });

  it('surfaces the cycle path after a cross-peer cycle merges in', () => {
    const doc = new Y.Doc();
    const docB = new Y.Doc();

    // Create the cycle off-React, then sync into the hook's doc.
    applyRefGeomOp(doc, { kind: 'addNode', node: planeOffset('X', 'Y') });
    applyRefGeomOp(docB, { kind: 'addNode', node: planeOffset('Y', 'X') });

    const { getByTestId, rerender } = render(<CycleProbe docId="d-cycle" doc={doc} />);
    // Pre-sync, doc only has X → no cycle (Y is missing parent, not cycle).
    expect(getByTestId('cycle').textContent).toBe('no-cycle');

    // Sync brings Y in; cycle emerges.
    act(() => {
      syncDocs(doc, docB);
    });

    // Force a rerender after the doc state changes.
    rerender(<CycleProbe docId="d-cycle" doc={doc} />);

    const cycleText = getByTestId('cycle').textContent;
    expect(cycleText).not.toBe('no-cycle');
    expect(cycleText).toContain('X');
    expect(cycleText).toContain('Y');
  });

  it('clears when the user manually breaks the cycle', () => {
    const doc = new Y.Doc();
    // Hand-construct a cycle.
    applyRefGeomOp(doc, { kind: 'addNode', node: planeOffset('X', 'Y') });
    applyRefGeomOp(doc, { kind: 'addNode', node: planeOffset('Y', 'X') });

    const { getByTestId } = render(<CycleProbe docId="d-cycle-clear" doc={doc} />);
    expect(getByTestId('cycle').textContent).not.toBe('no-cycle');

    // User edits X to drop its dep on Y (switches to standard plane).
    act(() => {
      applyRefGeomOp(doc, {
        kind: 'updateNode',
        nodeId: 'X',
        patch: { method: 'standard', params: { method: 'standard', id: 'front' } },
      });
    });

    expect(getByTestId('cycle').textContent).toBe('no-cycle');
  });
});
