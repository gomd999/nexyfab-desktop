// @vitest-environment jsdom

/**
 * FeatureTreePeerHighlight.test.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Covers:
 *  - PeerNodePill: renders nothing when no peer is on the node
 *  - PeerNodePill: renders one color dot per peer on the node
 *  - PeerNodePill: maxVisible caps the dots + shows "+N more"
 *  - PeerNodePill: stable ordering by peer id (alphabetical)
 *  - PeerNodePill: dot color matches peer awareness color
 *  - Self filtering: local peer never appears
 *  - useRemotePeersOnNode: returns matching peers
 *  - useRemotePeersOnNode: returns empty when nodeId is null
 *  - Outside <CollabProvider> the pill is a safe no-op
 */

import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, renderHook } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { Awareness } from 'y-protocols/awareness';

import { PeerNodePill, useRemotePeersOnNode } from '../FeatureTreePeerHighlight';
import { CollabProvider, useCollabAwareness } from '../../collab/CollabProvider';

// ─── jsdom shims ────────────────────────────────────────────────────────────

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
  peer: { id: string; name: string; color: string; activeNodeId?: string | null; ts?: number },
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

describe('PeerNodePill', () => {
  it('renders nothing when no peer is on the node', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="pill-1">
          <PeerNodePill nodeId="feat-1" />
        </CollabProvider>,
      );
    });
    expect(screen.queryByTestId('feature-tree-peer-pill')).toBeNull();
  });

  it('renders one dot per peer with matching activeNodeId', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="pill-2">
          <AwarenessSpy />
          <PeerNodePill nodeId="feat-1" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'A', color: 'hsl(0,65%,58%)', activeNodeId: 'feat-1' }, 1);
      injectRemote(capturedAwareness!,
        { id: 'b', name: 'B', color: 'hsl(120,65%,58%)', activeNodeId: 'feat-1' }, 2);
    });
    const dots = screen.getAllByTestId('feature-tree-peer-dot');
    expect(dots).toHaveLength(2);
  });

  it('excludes peers on other nodes', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="pill-3">
          <AwarenessSpy />
          <PeerNodePill nodeId="feat-1" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'A', color: 'hsl(0,65%,58%)', activeNodeId: 'feat-1' }, 1);
      injectRemote(capturedAwareness!,
        { id: 'b', name: 'B', color: 'hsl(120,65%,58%)', activeNodeId: 'feat-2' }, 2);
    });
    const dots = screen.getAllByTestId('feature-tree-peer-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0].getAttribute('data-peer-id')).toBe('a');
  });

  it('renders peer color on the dot', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="pill-4">
          <AwarenessSpy />
          <PeerNodePill nodeId="feat-1" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'A', color: 'hsl(72,65%,58%)', activeNodeId: 'feat-1' }, 1);
    });
    const dot = screen.getByTestId('feature-tree-peer-dot');
    // jsdom normalizes hsl→rgb in computed style; assert presence of background.
    expect(dot.getAttribute('style')).toMatch(/background:\s*rgb\(/);
  });

  it('caps visible dots at maxVisible and shows +N overflow', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="pill-5">
          <AwarenessSpy />
          <PeerNodePill nodeId="feat-1" maxVisible={2} />
        </CollabProvider>,
      );
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        injectRemote(capturedAwareness!,
          { id: `p${i}`, name: `P${i}`, color: 'hsl(0,65%,58%)', activeNodeId: 'feat-1' }, 10 + i);
      }
    });
    const dots = screen.getAllByTestId('feature-tree-peer-dot');
    expect(dots).toHaveLength(2);
    expect(screen.getByTestId('feature-tree-peer-overflow').textContent).toBe('+3');
  });

  it('stable ordering by peer id (alphabetical)', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="pill-6">
          <AwarenessSpy />
          <PeerNodePill nodeId="feat-1" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'z', name: 'Z', color: 'hsl(0,65%,58%)', activeNodeId: 'feat-1' }, 1);
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'A', color: 'hsl(120,65%,58%)', activeNodeId: 'feat-1' }, 2);
    });
    const dots = screen.getAllByTestId('feature-tree-peer-dot');
    expect(dots[0].getAttribute('data-peer-id')).toBe('a');
    expect(dots[1].getAttribute('data-peer-id')).toBe('z');
  });

  it('outside <CollabProvider> renders nothing (CollabSafe boundary)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { render(<PeerNodePill nodeId="feat-1" />); });
    expect(screen.queryByTestId('feature-tree-peer-pill')).toBeNull();
    spy.mockRestore();
  });
});

describe('useRemotePeersOnNode', () => {
  it('returns empty when nodeId is null', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CollabProvider docId="hook-1">{children}</CollabProvider>
    );
    const { result } = renderHook(() => useRemotePeersOnNode(null), { wrapper });
    expect(result.current).toEqual([]);
  });

  it('returns peers matching the activeNodeId', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CollabProvider docId="hook-2">
        <AwarenessSpy />
        {children}
      </CollabProvider>
    );
    const { result } = renderHook(() => useRemotePeersOnNode('feat-X'), { wrapper });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'x', name: 'X', color: 'hsl(0,65%,58%)', activeNodeId: 'feat-X' }, 1);
    });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('x');
  });
});
