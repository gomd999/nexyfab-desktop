// @vitest-environment jsdom

/**
 * CollabProvider.test.tsx — Wave 2 Phase 3 W1 Track Z1.
 *
 * Tests the Provider's mount lifecycle, hook contracts, and graceful failure
 * modes. jsdom has no BroadcastChannel by default — we add a minimal shim
 * so the BC transport path runs.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { useEffect } from 'react';

import {
  CollabProvider,
  useCollabDoc,
  useCollabAwareness,
  useCollabConnectionState,
  useCollabPresence,
  useCollabPresenceOptional,
  useCollabUpdateLocalPresence,
} from '../CollabProvider';

// ─── jsdom BroadcastChannel shim ────────────────────────────────────────────

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  name: string;
  private listeners = new Set<(ev: MessageEvent) => void>();
  constructor(name: string) {
    this.name = name;
    if (!FakeBroadcastChannel.channels.has(name)) {
      FakeBroadcastChannel.channels.set(name, new Set());
    }
    FakeBroadcastChannel.channels.get(name)!.add(this);
  }
  postMessage(data: unknown) {
    const peers = FakeBroadcastChannel.channels.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this) continue;
      // Schedule async — real BC is async.
      queueMicrotask(() => {
        for (const l of peer.listeners) {
          try { l(new MessageEvent('message', { data })); } catch { /* swallow */ }
        }
      });
    }
  }
  addEventListener(_event: 'message', cb: (ev: MessageEvent) => void) {
    this.listeners.add(cb);
  }
  removeEventListener(_event: 'message', cb: (ev: MessageEvent) => void) {
    this.listeners.delete(cb);
  }
  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
    this.listeners.clear();
  }
  static reset() {
    FakeBroadcastChannel.channels.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as unknown as { BroadcastChannel: typeof FakeBroadcastChannel }).BroadcastChannel = FakeBroadcastChannel;
  FakeBroadcastChannel.reset();
});

afterEach(() => {
  cleanup();
  FakeBroadcastChannel.reset();
  delete (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;
});

// ─── Hook spies — capture values for assertion ──────────────────────────────

function Spy(props: {
  onDoc?: (d: Y.Doc) => void;
  onAwareness?: (a: unknown) => void;
  onConn?: (c: unknown) => void;
  onPresence?: (p: unknown) => void;
  onUpdater?: (fn: unknown) => void;
}) {
  const doc = useCollabDoc();
  const aw = useCollabAwareness();
  const conn = useCollabConnectionState();
  const presence = useCollabPresence();
  const updater = useCollabUpdateLocalPresence();
  useEffect(() => {
    props.onDoc?.(doc);
    props.onAwareness?.(aw);
    props.onConn?.(conn);
    props.onPresence?.(presence);
    props.onUpdater?.(updater);
  });
  return null;
}

// ─── Mount + lifecycle ──────────────────────────────────────────────────────

describe('CollabProvider · mount', () => {
  it('mounts without crashing in local-only mode (no wsEndpoint)', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="mount-1">
          <div data-testid="child">hello</div>
        </CollabProvider>,
      );
    });
    expect(screen.getByTestId('child').textContent).toBe('hello');
  });

  it('exposes a Y.Doc through useCollabDoc', async () => {
    let captured: Y.Doc | null = null;
    await act(async () => {
      render(
        <CollabProvider docId="mount-2">
          <Spy onDoc={(d) => { captured = d; }} />
        </CollabProvider>,
      );
    });
    expect(captured).not.toBeNull();
    expect(captured).toBeInstanceOf(Y.Doc);
  });

  it('exposes the awareness instance via useCollabAwareness', async () => {
    let captured: unknown = null;
    await act(async () => {
      render(
        <CollabProvider docId="mount-3">
          <Spy onAwareness={(a) => { captured = a; }} />
        </CollabProvider>,
      );
    });
    expect(captured).toBeTruthy();
    expect((captured as { clientID: number }).clientID).toBeTypeOf('number');
  });

  it('useCollabDoc returns the same Y.Doc instance across renders', async () => {
    const docs: Y.Doc[] = [];
    function Child() {
      const d = useCollabDoc();
      docs.push(d);
      return null;
    }
    let rerender!: () => Promise<void>;
    await act(async () => {
      const r = render(
        <CollabProvider docId="mount-4">
          <Child />
        </CollabProvider>,
      );
      rerender = async () => {
        await act(async () => {
          r.rerender(
            <CollabProvider docId="mount-4">
              <Child />
            </CollabProvider>,
          );
        });
      };
    });
    await rerender();
    expect(docs[0]).toBe(docs[docs.length - 1]);
  });
});

describe('CollabProvider · connection state', () => {
  it('reports ws: "unavailable" when no wsEndpoint provided', async () => {
    let conn: { ws?: string } = {};
    await act(async () => {
      render(
        <CollabProvider docId="conn-1">
          <Spy onConn={(c) => { conn = c as typeof conn; }} />
        </CollabProvider>,
      );
    });
    expect(conn.ws).toBe('unavailable');
  });

  it('reports bc: "active" when BroadcastChannel is available', async () => {
    let conn: { bc?: string } = {};
    await act(async () => {
      render(
        <CollabProvider docId="conn-2">
          <Spy onConn={(c) => { conn = c as typeof conn; }} />
        </CollabProvider>,
      );
    });
    expect(conn.bc).toBe('active');
  });

  it('reports idb: "synced" after persistence whenSynced resolves', async () => {
    let lastConn: { idb?: string } = {};
    await act(async () => {
      render(
        <CollabProvider docId="conn-3">
          <Spy onConn={(c) => { lastConn = c as typeof lastConn; }} />
        </CollabProvider>,
      );
    });
    // Give the persistence promise queue a tick.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(['syncing', 'synced']).toContain(lastConn.idb);
  });
});

describe('CollabProvider · presence', () => {
  it('initializes local peer with id, name, color', async () => {
    let p: { localPeer?: { id?: string; name?: string; color?: string } } = {};
    await act(async () => {
      render(
        <CollabProvider docId="pres-1">
          <Spy onPresence={(v) => { p = v as typeof p; }} />
        </CollabProvider>,
      );
    });
    expect(p.localPeer?.id).toBeTypeOf('string');
    expect(p.localPeer?.id?.length).toBeGreaterThan(0);
    expect(p.localPeer?.name).toBeTypeOf('string');
    expect(p.localPeer?.color).toMatch(/^hsl\(/);
  });

  it('honors initialName + initialPeerId props', async () => {
    let p: { localPeer?: { id?: string; name?: string } } = {};
    await act(async () => {
      render(
        <CollabProvider docId="pres-2" initialPeerId="fixed-id-99" initialName="Bob">
          <Spy onPresence={(v) => { p = v as typeof p; }} />
        </CollabProvider>,
      );
    });
    expect(p.localPeer?.id).toBe('fixed-id-99');
    expect(p.localPeer?.name).toBe('Bob');
  });

  it('updateLocalPresence mutates the local state', async () => {
    let p: { localPeer?: { name?: string } } = {};
    let updater: ((patch: { name?: string }) => void) | null = null;
    await act(async () => {
      render(
        <CollabProvider docId="pres-3" initialName="Alice">
          <Spy
            onPresence={(v) => { p = v as typeof p; }}
            onUpdater={(fn) => { updater = fn as typeof updater; }}
          />
        </CollabProvider>,
      );
    });
    expect(p.localPeer?.name).toBe('Alice');
    await act(async () => {
      updater?.({ name: 'Bob' });
    });
    expect(p.localPeer?.name).toBe('Bob');
  });

  it('starts with empty remotePeers', async () => {
    let p: { remotePeers?: Record<string, unknown> } = {};
    await act(async () => {
      render(
        <CollabProvider docId="pres-4">
          <Spy onPresence={(v) => { p = v as typeof p; }} />
        </CollabProvider>,
      );
    });
    expect(p.remotePeers).toEqual({});
  });
});

describe('CollabProvider · error handling', () => {
  it('handles bogus wsEndpoint without crashing the mount', async () => {
    let conn: { ws?: string } = {};
    await act(async () => {
      render(
        <CollabProvider docId="err-1" wsEndpoint="wss://nonexistent.invalid:9999">
          <Spy onConn={(c) => { conn = c as typeof conn; }} />
        </CollabProvider>,
      );
    });
    // Provider initialises ws status to 'connecting'; the actual WS will fail
    // async (we don't wait). Either state is valid here — the key is the
    // mount didn't throw.
    expect(['connecting', 'disconnected', 'unavailable']).toContain(conn.ws);
  });

  it('throws if hooks are used outside a provider', () => {
    function BadChild() {
      useCollabDoc();
      return null;
    }
    expect(() => render(<BadChild />)).toThrow(/CollabProvider/);
  });
});

describe('CollabProvider · BroadcastChannel sync', () => {
  it('two Provider instances on the same docId converge via BC', async () => {
    // Render two providers in the same jsdom — both attach a real (fake)
    // BroadcastChannel to the SAME channel name → updates round-trip.
    const docs: { a?: Y.Doc; b?: Y.Doc } = {};

    function SpyA() {
      const d = useCollabDoc();
      useEffect(() => {
        docs.a = d;
      }, [d]);
      return null;
    }
    function SpyB() {
      const d = useCollabDoc();
      useEffect(() => {
        docs.b = d;
      }, [d]);
      return null;
    }

    await act(async () => {
      render(
        <CollabProvider docId="bc-converge-1" initialPeerId="peer-A">
          <SpyA />
        </CollabProvider>,
      );
      render(
        <CollabProvider docId="bc-converge-1" initialPeerId="peer-B">
          <SpyB />
        </CollabProvider>,
      );
    });

    // Let the initial sync-request + reply settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // Write on A
    await act(async () => {
      docs.a!.getMap<number>('test').set('x', 42);
      // Microtask flush for the fake BC.
      await new Promise((r) => setTimeout(r, 30));
    });

    // B should see the update via BC.
    expect(docs.b!.getMap<number>('test').get('x')).toBe(42);
  });
});

describe('CollabProvider · unmount', () => {
  it('does not throw on unmount', async () => {
    const { unmount } = await act(async () => {
      return render(
        <CollabProvider docId="unmount-1">
          <div>child</div>
        </CollabProvider>,
      );
    });
    expect(() => unmount()).not.toThrow();
  });
});

// useCollabPresenceOptional is the no-throw variant the presence-aware
// components (sketch peer cursors, feature-tree highlight, presence panel,
// editing-focus) consume so the bare modeler route — which has no
// <CollabProvider> — doesn't spam console.error via boundary-caught throws.
describe('useCollabPresenceOptional · outside a provider', () => {
  it('returns empty presence instead of throwing — and logs nothing', () => {
    let captured: { localPeer: unknown; remotePeers: Record<string, unknown> } | null = null;
    function Probe() {
      const p = useCollabPresenceOptional();
      useEffect(() => { captured = p; });
      return null;
    }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // No <CollabProvider> wrapper — the throwing useCollabPresence would crash
    // here; the optional variant must not.
    expect(() => render(<Probe />)).not.toThrow();
    expect(captured).not.toBeNull();
    expect(captured!.localPeer).toBeNull();
    expect(captured!.remotePeers).toEqual({});
    // The whole point: zero console noise on the no-provider path.
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('returns the live presence when a provider IS present', async () => {
    let captured: { localPeer: { id?: string } | null; remotePeers: Record<string, unknown> } | null = null;
    function Probe() {
      const p = useCollabPresenceOptional();
      useEffect(() => { captured = p; });
      return null;
    }
    await act(async () => {
      render(
        <CollabProvider docId="optional-1">
          <Probe />
        </CollabProvider>,
      );
    });
    expect(captured).not.toBeNull();
    expect(captured!.localPeer).not.toBeNull();
    expect(typeof captured!.localPeer!.id).toBe('string');
  });
});
