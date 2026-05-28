// @vitest-environment jsdom

/**
 * SketchPeerCursors.test.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Covers:
 *  - Renders nothing with no remote peers
 *  - Renders one marker per remote peer with cursor.viewport === 'sketch'
 *  - Filters peers whose cursor.viewport differs (e.g. 'tree')
 *  - Self peer never rendered (Provider strips it)
 *  - Peer color from awareness is applied to the marker
 *  - Name pill shows the peer name
 *  - mmToScreen projection is applied
 *  - hidePeerIds suppresses specific peers
 *  - Stale peer (ts > STALE_AFTER_MS) is dropped
 *  - Smooth interpolation: transform transition CSS applied
 *  - Custom viewportTag filters correctly
 *  - Outside <CollabProvider> is a safe no-op
 */

import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { Awareness } from 'y-protocols/awareness';

import SketchPeerCursors from '../SketchPeerCursors';
import { CollabProvider, useCollabAwareness } from '../../collab/CollabProvider';

// ─── jsdom shim ─────────────────────────────────────────────────────────────

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  name: string;
  private listeners = new Set<(ev: MessageEvent) => void>();
  constructor(name: string) {
    this.name = name;
    if (!FakeBroadcastChannel.channels.has(name)) FakeBroadcastChannel.channels.set(name, new Set());
    FakeBroadcastChannel.channels.get(name)!.add(this);
  }
  postMessage(data: unknown) {
    const peers = FakeBroadcastChannel.channels.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this) continue;
      queueMicrotask(() => { for (const l of peer.listeners) try { l(new MessageEvent('message', { data })); } catch { /* */ } });
    }
  }
  addEventListener(_e: 'message', cb: (ev: MessageEvent) => void) { this.listeners.add(cb); }
  removeEventListener(_e: 'message', cb: (ev: MessageEvent) => void) { this.listeners.delete(cb); }
  close() { FakeBroadcastChannel.channels.get(this.name)?.delete(this); this.listeners.clear(); }
  static reset() { FakeBroadcastChannel.channels.clear(); }
}

let capturedAwareness: Awareness | null = null;
function AwarenessSpy() {
  const a = useCollabAwareness();
  React.useEffect(() => { capturedAwareness = a; }, [a]);
  return null;
}

function injectRemote(
  awareness: Awareness,
  peer: {
    id: string; name: string; color: string;
    cursor?: { x: number; y: number; viewport: string } | null;
    activeNodeId?: string | null; selection?: string[]; ts?: number;
  },
  clientId: number,
): void {
  const states = (awareness as unknown as { states: Map<number, unknown> }).states;
  states.set(clientId, { ...peer, ts: peer.ts ?? Date.now() });
  (awareness as unknown as { emit: (e: string, args: unknown[]) => void }).emit('change', [
    { added: [clientId], updated: [], removed: [] }, 'test',
  ]);
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as unknown as { BroadcastChannel: typeof FakeBroadcastChannel }).BroadcastChannel = FakeBroadcastChannel;
  FakeBroadcastChannel.reset();
  capturedAwareness = null;
});

afterEach(() => {
  cleanup();
  FakeBroadcastChannel.reset();
  delete (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;
  capturedAwareness = null;
});

describe('SketchPeerCursors · rendering', () => {
  it('renders nothing with no remote peers', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-1">
          <SketchPeerCursors />
        </CollabProvider>,
      );
    });
    expect(screen.queryByTestId('sketch-peer-cursors')).toBeNull();
  });

  it('renders one marker per remote peer with sketch cursor', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-2">
          <AwarenessSpy />
          <SketchPeerCursors />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'Anna', color: 'hsl(0,65%,58%)', cursor: { x: 10, y: 20, viewport: 'sketch' } },
        1);
      injectRemote(capturedAwareness!,
        { id: 'b', name: 'Ben', color: 'hsl(120,65%,58%)', cursor: { x: 50, y: 30, viewport: 'sketch' } },
        2);
    });
    const markers = screen.getAllByTestId('sketch-peer-cursor');
    expect(markers).toHaveLength(2);
  });

  it('filters out peers in other viewports', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-3">
          <AwarenessSpy />
          <SketchPeerCursors />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'A', color: 'hsl(0,65%,58%)', cursor: { x: 1, y: 1, viewport: 'sketch' } }, 1);
      injectRemote(capturedAwareness!,
        { id: 'b', name: 'B', color: 'hsl(120,65%,58%)', cursor: { x: 2, y: 2, viewport: 'tree' } }, 2);
    });
    const markers = screen.getAllByTestId('sketch-peer-cursor');
    expect(markers).toHaveLength(1);
    expect(markers[0].getAttribute('data-peer-id')).toBe('a');
  });

  it('does NOT render self cursor (Provider strips local from remotePeers)', async () => {
    // Verify by injecting a peer with id matching local — but the Provider
    // uses clientID-based dedupe, so this test asserts the negative shape
    // by checking that with only the local peer present nothing renders.
    await act(async () => {
      render(
        <CollabProvider docId="cur-4" initialPeerId="self-pid">
          <SketchPeerCursors />
        </CollabProvider>,
      );
    });
    expect(screen.queryByTestId('sketch-peer-cursor')).toBeNull();
  });

  it('applies peer color to the marker name pill', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-5">
          <AwarenessSpy />
          <SketchPeerCursors />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'Alice', color: 'hsl(33,65%,58%)', cursor: { x: 0, y: 0, viewport: 'sketch' } },
        1);
    });
    const marker = screen.getByTestId('sketch-peer-cursor');
    // The fill on the SVG path and the pill background should both use the color.
    expect(marker.innerHTML).toMatch(/hsl\(33,\s*65%,\s*58%\)/);
  });

  it('renders the peer name in the label pill', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-6">
          <AwarenessSpy />
          <SketchPeerCursors />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'Ophelia', color: 'hsl(0,65%,58%)', cursor: { x: 5, y: 5, viewport: 'sketch' } },
        1);
    });
    expect(screen.getByTestId('sketch-peer-cursor').textContent).toContain('Ophelia');
  });
});

describe('SketchPeerCursors · projection / clamping', () => {
  it('applies mmToScreen projection', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-7">
          <AwarenessSpy />
          <SketchPeerCursors mmToScreen={(x, y) => ({ left: x * 2, top: y * 3 })} />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'A', color: 'hsl(0,65%,58%)', cursor: { x: 10, y: 20, viewport: 'sketch' } },
        1);
    });
    const marker = screen.getByTestId('sketch-peer-cursor');
    const style = marker.getAttribute('style') ?? '';
    // x=10 → left=20, y=20 → top=60
    expect(style).toMatch(/translate3d\(20px,\s*60px/);
  });

  it('marker has CSS transition for smooth interpolation', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-8">
          <AwarenessSpy />
          <SketchPeerCursors />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'A', color: 'hsl(0,65%,58%)', cursor: { x: 0, y: 0, viewport: 'sketch' } },
        1);
    });
    const style = screen.getByTestId('sketch-peer-cursor').getAttribute('style') ?? '';
    expect(style).toMatch(/transition:\s*transform\s+\d+ms\s+linear/);
  });

  it('hidePeerIds removes specific peers', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-9">
          <AwarenessSpy />
          <SketchPeerCursors hidePeerIds={['skip-me']} />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'skip-me', name: 'Hidden', color: 'hsl(0,65%,58%)', cursor: { x: 0, y: 0, viewport: 'sketch' } }, 1);
      injectRemote(capturedAwareness!,
        { id: 'keep-me', name: 'Visible', color: 'hsl(120,65%,58%)', cursor: { x: 0, y: 0, viewport: 'sketch' } }, 2);
    });
    const markers = screen.getAllByTestId('sketch-peer-cursor');
    expect(markers).toHaveLength(1);
    expect(markers[0].getAttribute('data-peer-id')).toBe('keep-me');
  });

  it('drops stale peers (ts older than STALE_AFTER_MS)', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-10">
          <AwarenessSpy />
          <SketchPeerCursors />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'old', name: 'Old', color: 'hsl(0,65%,58%)', cursor: { x: 0, y: 0, viewport: 'sketch' }, ts: Date.now() - 60_000 }, 1);
    });
    expect(screen.queryByTestId('sketch-peer-cursor')).toBeNull();
  });

  it('custom viewportTag filters correctly', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-11">
          <AwarenessSpy />
          <SketchPeerCursors viewportTag="drawing" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'A', color: 'hsl(0,65%,58%)', cursor: { x: 0, y: 0, viewport: 'sketch' } }, 1);
      injectRemote(capturedAwareness!,
        { id: 'b', name: 'B', color: 'hsl(120,65%,58%)', cursor: { x: 0, y: 0, viewport: 'drawing' } }, 2);
    });
    const markers = screen.getAllByTestId('sketch-peer-cursor');
    expect(markers).toHaveLength(1);
    expect(markers[0].getAttribute('data-peer-id')).toBe('b');
  });
});

describe('SketchPeerCursors · color stability', () => {
  it('peer color stays the same across two awareness updates with same id', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="cur-12">
          <AwarenessSpy />
          <SketchPeerCursors />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'stable', name: 'Stable', color: 'hsl(45,65%,58%)', cursor: { x: 1, y: 1, viewport: 'sketch' } }, 1);
    });
    const firstHtml = screen.getByTestId('sketch-peer-cursor').innerHTML;
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'stable', name: 'Stable', color: 'hsl(45,65%,58%)', cursor: { x: 5, y: 5, viewport: 'sketch' } }, 1);
    });
    const secondHtml = screen.getByTestId('sketch-peer-cursor').innerHTML;
    // Same color appears in both renders.
    expect(firstHtml).toMatch(/hsl\(45,\s*65%,\s*58%\)/);
    expect(secondHtml).toMatch(/hsl\(45,\s*65%,\s*58%\)/);
  });
});

describe('SketchPeerCursors · safety', () => {
  it('outside <CollabProvider> renders nothing (CollabSafe boundary)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { render(<SketchPeerCursors />); });
    expect(screen.queryByTestId('sketch-peer-cursors')).toBeNull();
    spy.mockRestore();
  });
});
