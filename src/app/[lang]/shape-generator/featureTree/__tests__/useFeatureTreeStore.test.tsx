// @vitest-environment jsdom
/**
 * useFeatureTreeStore.test.tsx — Wave 2 Phase 3 Track Z3 hook cases.
 *
 *  - Default !v2 path uses local
 *  - ?crdt=v2 toggles to Yjs (via forceMode in tests)
 *  - Two hook instances share state via BC fallback registry
 *  - Resolves to CollabProvider's doc when wrapped by <CollabDocBridge>
 *  - Cleanup on unmount releases the local store
 *  - subscribe() triggers re-render
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  useFeatureTreeStore,
  _resetFeatureTreeStoreFallback,
  _resetFeatureTreeStoreLocal,
  _acquireFeatureTreeFallbackDoc,
  CollabDocBridge,
} from '../useFeatureTreeStore';
import { FeatureTreeStore } from '../FeatureTreeStore';
import type { FeatureTreeStore as TFeatureTreeStore } from '../FeatureTreeStore';
import type { HistoryNode } from '../../useFeatureStack';

// Mock next/navigation so the hook's `useSearchParams` reads our switch.
let _searchParams = new URLSearchParams('');
vi.mock('next/navigation', () => ({
  useSearchParams: () => _searchParams,
  usePathname: () => '/en/shape-generator',
}));
function setCrdtFlag(on: boolean): void {
  _searchParams = new URLSearchParams(on ? 'crdt=v2' : '');
}

// Mock CollabProvider so importing CollabDocBridge doesn't pull in y-indexeddb
// etc. The mocked useCollabDoc just returns whatever doc the test set up.
let _providerDoc: Y.Doc | null = null;
vi.mock('../../collab/CollabProvider', () => ({
  useCollabDoc: () => {
    if (!_providerDoc) {
      throw new Error('[test mock] useCollabDoc called outside a <CollabProvider>');
    }
    return _providerDoc;
  },
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

interface ProbeProps {
  docId: string;
  forceMode?: 'local' | 'yjs';
  doc?: Y.Doc;
  onStore?: (store: TFeatureTreeStore) => void;
}

function Probe({ docId, forceMode, doc, onStore }: ProbeProps): React.ReactElement {
  const { store, isCollab } = useFeatureTreeStore(docId, { forceMode, doc });
  React.useEffect(() => { onStore?.(store); }, [store, onStore]);
  return (
    <div>
      <span data-testid="mode">{store.mode}</span>
      <span data-testid="iscollab">{isCollab ? 'yes' : 'no'}</span>
      <span data-testid="ids">{store.getNodes().map(n => n.id).join(',')}</span>
    </div>
  );
}

beforeEach(() => {
  _resetFeatureTreeStoreLocal();
  _resetFeatureTreeStoreFallback();
  setCrdtFlag(false);
  _providerDoc = null;
});

describe('useFeatureTreeStore — default (no flag)', () => {
  it('returns a local-mode store when flag is OFF', () => {
    const { getByTestId } = render(<Probe docId="d-a" />);
    expect(getByTestId('mode').textContent).toBe('local');
    expect(getByTestId('iscollab').textContent).toBe('no');
  });

  it('returns a local store when forceMode = local', () => {
    const { getByTestId } = render(<Probe docId="d-b" forceMode="local" />);
    expect(getByTestId('mode').textContent).toBe('local');
  });

  it('addNode triggers a re-render with the new node', () => {
    let captured: TFeatureTreeStore | null = null;
    const { getByTestId } = render(
      <Probe docId="d-c" forceMode="local" onStore={(s) => { captured = s; }} />,
    );
    act(() => {
      captured!.addNode(makeNode('F1', { parentId: captured!.getRootId() }));
    });
    expect(getByTestId('ids').textContent).toMatch(/F1/);
  });

  it('two hook instances with same docId share state (local registry)', () => {
    let storeA: TFeatureTreeStore | null = null;
    const r = render(
      <>
        <div data-testid="first"><Probe docId="d-share" forceMode="local" onStore={(s) => { storeA = s; }} /></div>
        <div data-testid="second"><Probe docId="d-share" forceMode="local" /></div>
      </>,
    );
    act(() => {
      storeA!.addNode(makeNode('shared', { parentId: storeA!.getRootId() }));
    });
    expect(r.getByTestId('first').textContent).toContain('shared');
    expect(r.getByTestId('second').textContent).toContain('shared');
  });

  it('different docIds have independent stores', () => {
    let storeA: TFeatureTreeStore | null = null;
    const r1 = render(<Probe docId="indep-1" forceMode="local" onStore={(s) => { storeA = s; }} />);
    const r2 = render(<Probe docId="indep-2" forceMode="local" />);
    act(() => {
      storeA!.addNode(makeNode('only-1', { parentId: storeA!.getRootId() }));
    });
    expect(r1.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/only-1/);
    expect(r2.container.querySelector('[data-testid="ids"]')!.textContent).not.toMatch(/only-1/);
  });
});

describe('useFeatureTreeStore — yjs mode', () => {
  it('returns a yjs-mode store when forceMode = yjs with explicit doc', () => {
    const doc = new Y.Doc();
    const { getByTestId } = render(<Probe docId="y-a" forceMode="yjs" doc={doc} />);
    expect(getByTestId('mode').textContent).toBe('yjs');
    expect(getByTestId('iscollab').textContent).toBe('yes');
  });

  it('yjs-mode mutations land on the underlying doc', () => {
    const doc = new Y.Doc();
    let store: TFeatureTreeStore | null = null;
    const { getByTestId } = render(
      <Probe docId="y-b" forceMode="yjs" doc={doc} onStore={(s) => { store = s; }} />,
    );
    act(() => {
      store!.addNode(makeNode('F-yjs', { parentId: store!.getRootId() }));
    });
    expect(getByTestId('ids').textContent).toMatch(/F-yjs/);
  });

  it('two hooks sharing the same doc converge', () => {
    const doc = new Y.Doc();
    let storeA: TFeatureTreeStore | null = null;
    const r1 = render(<Probe docId="y-conv" forceMode="yjs" doc={doc} onStore={(s) => { storeA = s; }} />);
    const r2 = render(<Probe docId="y-conv" forceMode="yjs" doc={doc} />);
    act(() => {
      storeA!.addNode(makeNode('shared-yjs', { parentId: storeA!.getRootId() }));
    });
    expect(r1.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/shared-yjs/);
    expect(r2.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/shared-yjs/);
  });

  it('falls back to per-docId BC doc when no Provider + no explicit doc', () => {
    let store: TFeatureTreeStore | null = null;
    const { getByTestId } = render(
      <Probe docId="y-fb" forceMode="yjs" onStore={(s) => { store = s; }} />,
    );
    expect(getByTestId('mode').textContent).toBe('yjs');
    act(() => {
      store!.addNode(makeNode('fb-1', { parentId: store!.getRootId() }));
    });
    expect(getByTestId('ids').textContent).toMatch(/fb-1/);
  });

  it('two instances on same fallback docId converge via the BC registry', () => {
    let storeA: TFeatureTreeStore | null = null;
    const r1 = render(<Probe docId="y-fb-shared" forceMode="yjs" onStore={(s) => { storeA = s; }} />);
    const r2 = render(<Probe docId="y-fb-shared" forceMode="yjs" />);
    act(() => {
      storeA!.addNode(makeNode('fb-conv', { parentId: storeA!.getRootId() }));
    });
    expect(r1.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/fb-conv/);
    expect(r2.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/fb-conv/);
  });
});

describe('useFeatureTreeStore — CollabDocBridge integration', () => {
  it('resolves to the bridged doc when wrapped by <CollabDocBridge>', () => {
    const providerDoc = new Y.Doc();
    _providerDoc = providerDoc;
    // Pre-write something on the doc so we can verify the hook sees this doc.
    const bootstrap = FeatureTreeStore.fromYDoc(providerDoc);
    bootstrap.addNode(makeNode('bridged-node', { parentId: bootstrap.getRootId() }));
    bootstrap.destroy();

    const { getByTestId } = render(
      <CollabDocBridge>
        <Probe docId="y-bridge" forceMode="yjs" />
      </CollabDocBridge>,
    );
    expect(getByTestId('mode').textContent).toBe('yjs');
    expect(getByTestId('ids').textContent).toMatch(/bridged-node/);
  });

  it('options.doc overrides the bridge', () => {
    const providerDoc = new Y.Doc();
    _providerDoc = providerDoc;
    const explicitDoc = new Y.Doc();
    const bootstrap = FeatureTreeStore.fromYDoc(explicitDoc);
    bootstrap.addNode(makeNode('explicit-node', { parentId: bootstrap.getRootId() }));
    bootstrap.destroy();

    const { getByTestId } = render(
      <CollabDocBridge>
        <Probe docId="y-bridge-override" forceMode="yjs" doc={explicitDoc} />
      </CollabDocBridge>,
    );
    expect(getByTestId('ids').textContent).toMatch(/explicit-node/);
  });
});

describe('useFeatureTreeStore — lifecycle', () => {
  it('unmount releases the local store (next mount starts empty)', () => {
    let storeA: TFeatureTreeStore | null = null;
    const r = render(
      <Probe docId="life-1" forceMode="local" onStore={(s) => { storeA = s; }} />,
    );
    act(() => {
      storeA!.addNode(makeNode('alpha', { parentId: storeA!.getRootId() }));
    });
    expect(r.getByTestId('ids').textContent).toMatch(/alpha/);
    r.unmount();

    // Fresh mount on the same docId should see an empty tree.
    const r2 = render(<Probe docId="life-1" forceMode="local" />);
    expect(r2.container.querySelector('[data-testid="ids"]')!.textContent).not.toMatch(/alpha/);
  });

  it('two mounts then one unmount keeps the local store alive (refcount)', () => {
    let storeA: TFeatureTreeStore | null = null;
    const r1 = render(<Probe docId="life-2" forceMode="local" onStore={(s) => { storeA = s; }} />);
    const r2 = render(<Probe docId="life-2" forceMode="local" />);
    act(() => {
      storeA!.addNode(makeNode('persist', { parentId: storeA!.getRootId() }));
    });
    r1.unmount();
    expect(r2.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/persist/);
  });

  it('subscribe triggers re-render on doc external update', () => {
    setCrdtFlag(true);
    const doc = _acquireFeatureTreeFallbackDoc('ext-update');
    // Bootstrap via probe so the tree array isn't empty.
    const probeStore = FeatureTreeStore.fromYDoc(doc);
    const r = render(<Probe docId="ext-update" forceMode="yjs" />);
    act(() => {
      probeStore.addNode(makeNode('external', { parentId: probeStore.getRootId() }));
    });
    expect(r.container.querySelector('[data-testid="ids"]')!.textContent).toMatch(/external/);
    probeStore.destroy();
  });
});
