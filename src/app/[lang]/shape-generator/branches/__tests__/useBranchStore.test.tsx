// @vitest-environment jsdom
/**
 * useBranchStore.test.tsx — Wave 2 Phase 3 Z6 hook cases.
 *
 *  - Default !v2 path → local mode
 *  - forceMode = 'yjs' → yjs mode
 *  - Two hook instances same workspaceId share state (local)
 *  - Two hook instances same Y.Doc converge (yjs)
 *  - Mutations trigger re-render
 *  - Cleanup releases the local store
 *  - Fallback BroadcastChannel path provisions a per-workspaceId doc
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  useBranchStore,
  _resetBranchStoreLocal,
  _resetBranchStoreFallback,
} from '../useBranchStore';
import type { BranchStore as IBranchStore } from '../BranchStore';

interface ProbeProps {
  workspaceId: string;
  forceMode?: 'local' | 'yjs';
  doc?: Y.Doc;
  onStore?: (store: IBranchStore) => void;
}

function Probe({ workspaceId, forceMode, doc, onStore }: ProbeProps): React.ReactElement {
  const { store, isCollab } = useBranchStore(workspaceId, { forceMode, doc });
  React.useEffect(() => {
    onStore?.(store);
  }, [store, onStore]);
  return (
    <div>
      <span data-testid="mode">{store.mode}</span>
      <span data-testid="iscollab">{isCollab ? 'yes' : 'no'}</span>
      <span data-testid="names">
        {store.getBranches().map((b) => b.name).join(',')}
      </span>
    </div>
  );
}

beforeEach(() => {
  _resetBranchStoreLocal();
  _resetBranchStoreFallback();
});

// ─── 1. Default + forceMode ────────────────────────────────────────────────

describe('useBranchStore — default + forceMode', () => {
  it('forceMode=local returns a local-mode store', () => {
    const { getByTestId } = render(<Probe workspaceId="w-a" forceMode="local" />);
    expect(getByTestId('mode').textContent).toBe('local');
    expect(getByTestId('iscollab').textContent).toBe('no');
  });

  it('local store starts empty', () => {
    const { getByTestId } = render(<Probe workspaceId="w-b" forceMode="local" />);
    expect(getByTestId('names').textContent).toBe('');
  });

  it('createBranch triggers re-render', () => {
    let store: IBranchStore | null = null;
    const { getByTestId } = render(
      <Probe
        workspaceId="w-c"
        forceMode="local"
        onStore={(s) => { store = s; }}
      />,
    );
    act(() => {
      store!.createBranch('main', 'doc-1', null, 'alice');
    });
    expect(getByTestId('names').textContent).toBe('main');
  });

  it('two hook instances on same workspaceId share state', () => {
    let storeA: IBranchStore | null = null;
    const r = render(
      <>
        <div data-testid="first">
          <Probe
            workspaceId="w-shared"
            forceMode="local"
            onStore={(s) => { storeA = s; }}
          />
        </div>
        <div data-testid="second">
          <Probe workspaceId="w-shared" forceMode="local" />
        </div>
      </>,
    );
    act(() => {
      storeA!.createBranch('main', 'doc-1', null, 'alice');
    });
    expect(r.getByTestId('first').textContent).toContain('main');
    expect(r.getByTestId('second').textContent).toContain('main');
  });

  it('different workspaceIds have independent local stores', () => {
    let storeA: IBranchStore | null = null;
    const renderA = render(
      <Probe
        workspaceId="w-1"
        forceMode="local"
        onStore={(s) => { storeA = s; }}
      />,
    );
    const renderB = render(<Probe workspaceId="w-2" forceMode="local" />);
    act(() => {
      storeA!.createBranch('only-1', 'doc-1', null, 'alice');
    });
    expect(renderA.container.querySelector('[data-testid="names"]')!.textContent).toBe('only-1');
    expect(renderB.container.querySelector('[data-testid="names"]')!.textContent).toBe('');
  });
});

// ─── 2. Yjs mode ───────────────────────────────────────────────────────────

describe('useBranchStore — yjs mode', () => {
  it('forceMode=yjs with explicit doc returns yjs-mode store', () => {
    const doc = new Y.Doc();
    const { getByTestId } = render(
      <Probe workspaceId="w-y" forceMode="yjs" doc={doc} />,
    );
    expect(getByTestId('mode').textContent).toBe('yjs');
    expect(getByTestId('iscollab').textContent).toBe('yes');
  });

  it('yjs mutations land on the underlying doc', () => {
    const doc = new Y.Doc();
    let store: IBranchStore | null = null;
    const { getByTestId } = render(
      <Probe
        workspaceId="w-y2"
        forceMode="yjs"
        doc={doc}
        onStore={(s) => { store = s; }}
      />,
    );
    act(() => {
      store!.createBranch('main', 'doc-1', null, 'alice');
    });
    expect(getByTestId('names').textContent).toBe('main');
  });

  it('two hooks sharing the same doc converge', () => {
    const doc = new Y.Doc();
    let storeA: IBranchStore | null = null;
    const renderA = render(
      <Probe
        workspaceId="w-conv"
        forceMode="yjs"
        doc={doc}
        onStore={(s) => { storeA = s; }}
      />,
    );
    const renderB = render(
      <Probe workspaceId="w-conv" forceMode="yjs" doc={doc} />,
    );
    act(() => {
      storeA!.createBranch('main', 'doc-1', null, 'alice');
    });
    expect(renderA.container.querySelector('[data-testid="names"]')!.textContent).toBe('main');
    expect(renderB.container.querySelector('[data-testid="names"]')!.textContent).toBe('main');
  });

  it('falls back to per-workspaceId doc when no explicit doc provided', () => {
    let store: IBranchStore | null = null;
    const { getByTestId } = render(
      <Probe
        workspaceId="w-fb"
        forceMode="yjs"
        onStore={(s) => { store = s; }}
      />,
    );
    expect(getByTestId('mode').textContent).toBe('yjs');
    act(() => {
      store!.createBranch('fb-main', 'doc-1', null, 'alice');
    });
    expect(getByTestId('names').textContent).toBe('fb-main');
  });
});

// ─── 3. Lifecycle ──────────────────────────────────────────────────────────

describe('useBranchStore — lifecycle', () => {
  it('unmount releases the local store (fresh mount sees empty)', () => {
    let storeA: IBranchStore | null = null;
    const renderA = render(
      <Probe
        workspaceId="w-life"
        forceMode="local"
        onStore={(s) => { storeA = s; }}
      />,
    );
    act(() => {
      storeA!.createBranch('alpha', 'doc-1', null, 'alice');
    });
    expect(renderA.getByTestId('names').textContent).toBe('alpha');
    renderA.unmount();
    const renderB = render(<Probe workspaceId="w-life" forceMode="local" />);
    expect(renderB.getByTestId('names').textContent).toBe('');
  });

  it('refcount keeps the store alive across mounts', () => {
    let storeA: IBranchStore | null = null;
    const renderA = render(
      <Probe
        workspaceId="w-ref"
        forceMode="local"
        onStore={(s) => { storeA = s; }}
      />,
    );
    const renderB = render(<Probe workspaceId="w-ref" forceMode="local" />);
    act(() => {
      storeA!.createBranch('persist', 'doc-1', null, 'alice');
    });
    renderA.unmount();
    expect(renderB.container.querySelector('[data-testid="names"]')!.textContent).toBe('persist');
  });
});
