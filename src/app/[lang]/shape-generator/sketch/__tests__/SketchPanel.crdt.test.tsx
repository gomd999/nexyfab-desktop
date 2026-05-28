// @vitest-environment jsdom
/**
 * SketchPanel.crdt.test.tsx — Wave 2 Phase 3 Track Z2.
 *
 * Verifies the panel-side CRDT touchpoint:
 *  - Local mode: no LWW toast, no behaviour change vs. pre-Z2.
 *  - Yjs mode: toast appears when a remote-origin update changes a
 *    locally-visible segment id's points.
 *
 * The panel's internal `useSketchStore` resolves to the per-sketchId
 * fallback Y.Doc when no Z1 doc is provided. Tests acquire that same
 * doc via `_acquireSketchStoreFallbackDoc` to drive the convergence
 * scenarios deterministically.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';

// Mock next/navigation so the SketchPanel's internal `useSketchStore` (which
// reads `?crdt=v2` via useSearchParams) routes to the Yjs branch in tests
// that want it. The mock is mutable so the convergence-only tests can leave
// the URL alone (default = no flag = local mode).
let _searchParams = new URLSearchParams('');
vi.mock('next/navigation', () => ({
  useSearchParams: () => _searchParams,
  usePathname: () => '/en/shape-generator',
}));
function setCrdtFlag(on: boolean): void {
  _searchParams = new URLSearchParams(on ? 'crdt=v2' : '');
}

import SketchPanel from '../SketchPanel';
import {
  _resetSketchStoreLocal,
  _resetSketchStoreFallback,
  _acquireSketchStoreFallbackDoc,
  useSketchStore,
} from '../useSketchStore';
import { SketchStore } from '../SketchStore';
import type { SketchProfile, SketchSegment, SketchConfig, SketchTool } from '../types';

const noop = () => {};

const defaultConfig = (): SketchConfig => ({
  mode: 'extrude',
  depth: 50,
  revolveAngle: 360,
  revolveAxis: 'y',
  segments: 32,
});

function line(id: string, x1 = 0, y1 = 0, x2 = 10, y2 = 0): SketchSegment {
  return { id, type: 'line', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] };
}

interface HarnessProps {
  sketchId?: string;
  initialSegments?: SketchSegment[];
  enableCrdt?: boolean;
  forceMode?: 'local' | 'yjs';
  resolvePeerName?: (id: string) => string | null;
}

function Harness({
  sketchId = 's-test',
  initialSegments = [],
  enableCrdt = false,
  forceMode,
  resolvePeerName,
}: HarnessProps): React.ReactElement {
  const { store } = useSketchStore(sketchId, { forceMode });

  React.useEffect(() => {
    for (const s of initialSegments) {
      if (!store.getSegments().some(x => x.id === s.id)) {
        store.addSegment(s);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const segments = store.getSegments();
  const profile: SketchProfile = { segments, closed: false };

  return (
    <SketchPanel
      profile={profile}
      config={defaultConfig()}
      onConfigChange={noop}
      activeTool={'line' as SketchTool}
      onToolChange={noop}
      onClear={noop}
      onUndo={noop}
      onGenerate={noop}
      canGenerate={false}
      t={{}}
      crdtSketchId={enableCrdt ? sketchId : undefined}
      resolvePeerName={resolvePeerName}
    />
  );
}

beforeEach(() => {
  _resetSketchStoreLocal();
  _resetSketchStoreFallback();
  setCrdtFlag(false);
});

describe('SketchPanel — Z2 CRDT touchpoint (local / no flag)', () => {
  it('renders without toast in local mode', () => {
    const r = render(<Harness sketchId="loc-a" />);
    expect(r.queryByTestId('sketch-lww-toast')).toBeNull();
  });

  it('renders without toast even when crdtSketchId is set but mode is local', () => {
    const r = render(<Harness sketchId="loc-b" enableCrdt forceMode="local" />);
    expect(r.queryByTestId('sketch-lww-toast')).toBeNull();
  });

  it('adding a segment via store updates the rendered profile (local)', () => {
    const r = render(<Harness sketchId="loc-add" initialSegments={[line('seg-1')]} />);
    expect(r.container.textContent).toMatch(/1 seg/);
  });

  it('does NOT show the toast on a local-origin update (yjs mode, local origin)', () => {
    setCrdtFlag(true);
    const fallback = _acquireSketchStoreFallbackDoc('no-toast-yjs');
    const probe = SketchStore.fromYDoc(fallback, 'no-toast-yjs');
    probe.addSegment(line('seg-a'));

    const r = render(<Harness sketchId="no-toast-yjs" enableCrdt forceMode="yjs" />);

    act(() => {
      probe.updateSegment('seg-a', { points: [{ x: 99, y: 99 }, { x: 100, y: 100 }] });
    });
    expect(r.queryByTestId('sketch-lww-toast')).toBeNull();
  });
});

describe('SketchPanel — Z2 CRDT touchpoint (yjs / convergence)', () => {
  it('two panels on same fallback doc converge on a segment add', () => {
    setCrdtFlag(true);
    const fallback = _acquireSketchStoreFallbackDoc('conv-1');
    const probe = SketchStore.fromYDoc(fallback, 'conv-1');

    const r1 = render(<Harness sketchId="conv-1" enableCrdt forceMode="yjs" />);
    const r2 = render(<Harness sketchId="conv-1" enableCrdt forceMode="yjs" />);

    act(() => { probe.addSegment(line('shared-seg')); });

    expect(r1.container.textContent).toMatch(/1 seg/);
    expect(r2.container.textContent).toMatch(/1 seg/);
  });

  it('LWW toast appears when a remote peer overrides a local segment', () => {
    setCrdtFlag(true);
    // Acquire the fallback doc that the panel will use, seed seg-x on it,
    // then simulate a remote peer via a separate doc that ships an
    // update back with non-local origin.
    const docA = _acquireSketchStoreFallbackDoc('lww-1');
    const probeA = SketchStore.fromYDoc(docA, 'lww-1');
    probeA.addSegment(line('seg-x', 0, 0, 1, 0));

    const r = render(<Harness sketchId="lww-1" enableCrdt forceMode="yjs" />);
    expect(r.queryByTestId('sketch-lww-toast')).toBeNull();

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = SketchStore.fromYDoc(docB, 'lww-1');
    storeB.updateSegment('seg-x', { points: [{ x: 0, y: 0 }, { x: 99, y: 99 }] });
    act(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote-update');
    });

    const toast = r.queryByTestId('sketch-lww-toast');
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toMatch(/overridden/);
  });

  it('LWW toast does NOT appear when a remote peer adds an UNRELATED new segment', () => {
    setCrdtFlag(true);
    const docA = _acquireSketchStoreFallbackDoc('lww-2');
    const probeA = SketchStore.fromYDoc(docA, 'lww-2');
    probeA.addSegment(line('seg-mine'));

    const r = render(<Harness sketchId="lww-2" enableCrdt forceMode="yjs" />);

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = SketchStore.fromYDoc(docB, 'lww-2');
    storeB.addSegment(line('seg-theirs'));
    act(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote-update');
    });

    expect(r.queryByTestId('sketch-lww-toast')).toBeNull();
  });

  it('toast uses resolvePeerName when origin is a peer-id string', () => {
    setCrdtFlag(true);
    const docA = _acquireSketchStoreFallbackDoc('lww-3');
    const probeA = SketchStore.fromYDoc(docA, 'lww-3');
    probeA.addSegment(line('seg-z', 0, 0, 1, 1));

    const resolvePeerName = (id: string) => id === 'peer-bob' ? 'Bob' : null;
    const r = render(
      <Harness sketchId="lww-3" enableCrdt forceMode="yjs" resolvePeerName={resolvePeerName} />,
    );

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = SketchStore.fromYDoc(docB, 'lww-3');
    storeB.updateSegment('seg-z', { points: [{ x: 0, y: 0 }, { x: 7, y: 7 }] });
    act(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'peer-bob');
    });

    const toast = r.queryByTestId('sketch-lww-toast');
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toMatch(/Bob/);
  });

  it('toast auto-dismisses after 4 seconds', async () => {
    setCrdtFlag(true);
    const docA = _acquireSketchStoreFallbackDoc('lww-4');
    const probeA = SketchStore.fromYDoc(docA, 'lww-4');
    probeA.addSegment(line('seg-d'));

    const r = render(<Harness sketchId="lww-4" enableCrdt forceMode="yjs" />);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const storeB = SketchStore.fromYDoc(docB, 'lww-4');
    storeB.updateSegment('seg-d', { points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] });
    act(() => {
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote-update');
    });
    expect(r.queryByTestId('sketch-lww-toast')).not.toBeNull();

    await act(async () => {
      await new Promise(res => setTimeout(res, 4100));
    });
    expect(r.queryByTestId('sketch-lww-toast')).toBeNull();
  }, 10_000);
});
