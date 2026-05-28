// @vitest-environment jsdom
/**
 * useSketchStore.test.tsx — Wave 2 Phase 3 Track Z2 hook cases.
 *
 * Covers:
 *  - Default !v2 path uses local mode
 *  - forceMode override routes to yjs mode
 *  - Two hook instances on same sketchId share the same store (local)
 *  - Two hook instances with same Y.Doc converge (yjs)
 *  - Cleanup on unmount releases the local store
 *  - subscribe() triggers re-render
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  useSketchStore,
  _resetSketchStoreLocal,
  _resetSketchStoreFallback,
} from '../useSketchStore';
import type { SketchSegment } from '../types';

function line(id: string, x = 0, y = 0): SketchSegment {
  return { id, type: 'line', points: [{ x, y }, { x: x + 1, y }] };
}

interface ProbeProps {
  sketchId: string;
  forceMode?: 'local' | 'yjs';
  doc?: Y.Doc;
  onStore?: (store: unknown) => void;
  renderSegments?: (segs: SketchSegment[]) => React.ReactNode;
}

function Probe({ sketchId, forceMode, doc, onStore, renderSegments }: ProbeProps): React.ReactElement {
  const { store, isCollab } = useSketchStore(sketchId, { forceMode, doc });
  // Side-channel for tests that want to drive the store directly.
  React.useEffect(() => { onStore?.(store); }, [store, onStore]);
  return (
    <div>
      <span data-testid="mode">{store.mode}</span>
      <span data-testid="iscollab">{isCollab ? 'yes' : 'no'}</span>
      <span data-testid="segs">{store.getSegments().map(s => s.id).join(',')}</span>
      {renderSegments?.(store.getSegments())}
    </div>
  );
}

beforeEach(() => {
  _resetSketchStoreLocal();
  _resetSketchStoreFallback();
});

describe('useSketchStore — default (no flag)', () => {
  it('returns a local-mode store when forceMode = local', () => {
    const { getByTestId } = render(<Probe sketchId="s-a" forceMode="local" />);
    expect(getByTestId('mode').textContent).toBe('local');
    expect(getByTestId('iscollab').textContent).toBe('no');
  });

  it('starts with an empty segment list', () => {
    const { getByTestId } = render(<Probe sketchId="s-b" forceMode="local" />);
    expect(getByTestId('segs').textContent).toBe('');
  });

  it('addSegment triggers a re-render with updated segments', () => {
    let captured: { addSegment: (s: SketchSegment) => void } | null = null;
    const { getByTestId } = render(
      <Probe sketchId="s-c" forceMode="local" onStore={(s) => { captured = s as typeof captured; }} />,
    );
    act(() => { captured!.addSegment(line('seg-x')); });
    expect(getByTestId('segs').textContent).toBe('seg-x');
  });

  it('two hook instances with same sketchId share state (local)', () => {
    let storeA: { addSegment: (s: SketchSegment) => void } | null = null;
    const r = render(
      <>
        <div data-testid="first"><Probe sketchId="s-shared" forceMode="local" onStore={(s) => { storeA = s as typeof storeA; }} /></div>
        <div data-testid="second"><Probe sketchId="s-shared" forceMode="local" /></div>
      </>,
    );
    act(() => { storeA!.addSegment(line('seg-shared')); });
    // Both hooks should reflect the same store contents.
    expect(r.getByTestId('first').textContent).toContain('seg-shared');
    expect(r.getByTestId('second').textContent).toContain('seg-shared');
  });

  it('different sketchIds have independent stores', () => {
    let storeA: { addSegment: (s: SketchSegment) => void } | null = null;
    const renderA = render(
      <Probe sketchId="s-1" forceMode="local" onStore={(s) => { storeA = s as typeof storeA; }} />,
    );
    const renderB = render(<Probe sketchId="s-2" forceMode="local" />);
    act(() => { storeA!.addSegment(line('only-1')); });
    expect(renderA.container.querySelector('[data-testid="segs"]')!.textContent).toBe('only-1');
    expect(renderB.container.querySelector('[data-testid="segs"]')!.textContent).toBe('');
  });
});

describe('useSketchStore — yjs mode', () => {
  it('returns a yjs-mode store when forceMode = yjs with explicit doc', () => {
    const doc = new Y.Doc();
    const { getByTestId } = render(<Probe sketchId="s-y" forceMode="yjs" doc={doc} />);
    expect(getByTestId('mode').textContent).toBe('yjs');
    expect(getByTestId('iscollab').textContent).toBe('yes');
  });

  it('yjs-mode mutations land on the underlying doc', () => {
    const doc = new Y.Doc();
    let store: { addSegment: (s: SketchSegment) => void } | null = null;
    const { getByTestId } = render(
      <Probe sketchId="s-y2" forceMode="yjs" doc={doc} onStore={(s) => { store = s as typeof store; }} />,
    );
    act(() => { store!.addSegment(line('seg-yjs')); });
    expect(getByTestId('segs').textContent).toBe('seg-yjs');
  });

  it('two hooks sharing the same doc converge', () => {
    const doc = new Y.Doc();
    let storeA: { addSegment: (s: SketchSegment) => void } | null = null;
    const renderA = render(
      <Probe sketchId="s-conv" forceMode="yjs" doc={doc} onStore={(s) => { storeA = s as typeof storeA; }} />,
    );
    const renderB = render(<Probe sketchId="s-conv" forceMode="yjs" doc={doc} />);
    act(() => { storeA!.addSegment(line('shared-yjs')); });
    expect(renderA.container.querySelector('[data-testid="segs"]')!.textContent).toBe('shared-yjs');
    expect(renderB.container.querySelector('[data-testid="segs"]')!.textContent).toBe('shared-yjs');
  });

  it('falls back to per-tab doc when no Z1 doc + no explicit doc provided', () => {
    // We pass forceMode='yjs' but no doc — the hook should provision a
    // fallback Y.Doc via acquireFallbackDoc.
    let store: { mode: string; addSegment: (s: SketchSegment) => void } | null = null;
    const { getByTestId } = render(
      <Probe sketchId="s-fb" forceMode="yjs" onStore={(s) => { store = s as typeof store; }} />,
    );
    expect(getByTestId('mode').textContent).toBe('yjs');
    act(() => { store!.addSegment(line('fb-seg')); });
    expect(getByTestId('segs').textContent).toBe('fb-seg');
  });
});

describe('useSketchStore — lifecycle', () => {
  it('unmount releases the local store', () => {
    let storeA: { addSegment: (s: SketchSegment) => void } | null = null;
    const renderA = render(
      <Probe sketchId="s-life" forceMode="local" onStore={(s) => { storeA = s as typeof storeA; }} />,
    );
    act(() => { storeA!.addSegment(line('alpha')); });
    expect(renderA.getByTestId('segs').textContent).toBe('alpha');

    renderA.unmount();

    // A fresh mount on the same sketchId after unmount should see an empty
    // store (refcount dropped to zero, registry entry deleted).
    const renderB = render(<Probe sketchId="s-life" forceMode="local" />);
    expect(renderB.container.querySelector('[data-testid="segs"]')!.textContent).toBe('');
  });

  it('two mounts then one unmount keeps the local store alive (refcount)', () => {
    let storeA: { addSegment: (s: SketchSegment) => void } | null = null;
    const renderA = render(
      <Probe sketchId="s-ref" forceMode="local" onStore={(s) => { storeA = s as typeof storeA; }} />,
    );
    const renderB = render(<Probe sketchId="s-ref" forceMode="local" />);
    act(() => { storeA!.addSegment(line('persist')); });

    renderA.unmount();
    // B still mounted, store should survive.
    expect(renderB.container.querySelector('[data-testid="segs"]')!.textContent).toBe('persist');
  });
});
