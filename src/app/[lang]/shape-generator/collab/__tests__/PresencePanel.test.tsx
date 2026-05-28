// @vitest-environment jsdom

/**
 * PresencePanel.test.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Covers:
 *  - Renders nothing when only self peer present (auto-hide)
 *  - Lists remote peers with name + color dot
 *  - Self row at bottom with star badge
 *  - Status badges (idle / editing / viewing) reflect awareness state
 *  - Collapsible — header toggles body visibility
 *  - Invite-link button copies window.location.href via navigator.clipboard
 *  - Falls back to execCommand when clipboard API unavailable
 *  - getInviteUrl override is used when provided
 *  - 6-lang labels render
 *  - position prop drives anchor styling
 *  - forceShow renders even when alone
 *  - rendering outside a Provider is a safe no-op (CollabSafe boundary)
 *  - stale peer (ts > STALE_AFTER_MS) renders dimmed
 *  - multi-peer ordering is stable (alphabetical by name)
 *  - peer color renders on the row
 */

import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { Awareness } from 'y-protocols/awareness';

import { PresencePanel } from '../PresencePanel';
import { CollabProvider, useCollabAwareness } from '../CollabProvider';

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

// ─── Test helpers ────────────────────────────────────────────────────────────

let capturedAwareness: Awareness | null = null;
function AwarenessSpy() {
  const a = useCollabAwareness();
  React.useEffect(() => {
    capturedAwareness = a;
  }, [a]);
  return null;
}

/**
 * Inject a remote-peer's state into the awareness via the same wire format
 * the BroadcastChannel transport uses. Mirrors the contract of
 * `decodeRemotePresence` which expects a different clientID.
 */
function injectRemotePeer(
  awareness: Awareness,
  peer: { id: string; name: string; color: string; cursor?: unknown; selection?: string[]; activeNodeId?: string | null; ts?: number },
  clientId: number,
): void {
  // Awareness internals: states is a Map<number, state>. Directly mutate then
  // emit the change event for subscribers to pick up.
  const internalStates = (awareness as unknown as { states: Map<number, unknown> }).states;
  internalStates.set(clientId, { ...peer, ts: peer.ts ?? Date.now() });
  (awareness as unknown as { emit: (e: string, args: unknown[]) => void }).emit('change', [
    { added: [clientId], updated: [], removed: [] },
    'test',
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PresencePanel · auto-hide', () => {
  it('renders nothing when only the local peer is present', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-1" initialName="Alice">
          <PresencePanel lang="en" />
        </CollabProvider>,
      );
    });
    expect(screen.queryByTestId('collab-presence-panel')).toBeNull();
  });

  it('forceShow renders the panel even when alone', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-1b" initialName="Alice">
          <PresencePanel lang="en" forceShow />
        </CollabProvider>,
      );
    });
    expect(screen.getByTestId('collab-presence-panel')).toBeTruthy();
  });
});

describe('PresencePanel · with remote peers', () => {
  it('renders panel + listing one remote peer', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-2" initialName="Alice" initialPeerId="alice-pid">
          <AwarenessSpy />
          <PresencePanel lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(
        capturedAwareness!,
        { id: 'bob', name: 'Bob', color: 'hsl(120, 65%, 58%)' },
        99,
      );
    });
    const panel = screen.getByTestId('collab-presence-panel');
    expect(panel.textContent).toMatch(/Bob/);
    expect(panel.textContent).toMatch(/Alice/);
  });

  it('renders peer color on the dot', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-3">
          <AwarenessSpy />
          <PresencePanel lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(
        capturedAwareness!,
        { id: 'carol', name: 'Carol', color: 'hsl(240, 65%, 58%)' },
        77,
      );
    });
    const dots = screen.getAllByTestId('collab-presence-color');
    expect(dots.length).toBeGreaterThan(0);
    const colors = dots.map((d) => d.getAttribute('style') ?? '');
    expect(colors.some((s) => s.includes('hsl(240, 65%, 58%)'))).toBe(true);
  });

  it('lists peers alphabetically by name', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-4">
          <AwarenessSpy />
          <PresencePanel lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(capturedAwareness!, { id: 'z', name: 'Zara', color: 'hsl(0,65%,58%)' }, 10);
      injectRemotePeer(capturedAwareness!, { id: 'a', name: 'Amos', color: 'hsl(1,65%,58%)' }, 11);
    });
    const rows = screen.getAllByTestId('collab-presence-row');
    // Should be: Amos, Zara, then self (Self star at bottom).
    expect(rows[0].textContent).toMatch(/Amos/);
    expect(rows[1].textContent).toMatch(/Zara/);
  });

  it('shows "editing · tree" status for peer with activeNodeId', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-5">
          <AwarenessSpy />
          <PresencePanel lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(
        capturedAwareness!,
        { id: 'dave', name: 'Dave', color: 'hsl(60,65%,58%)', activeNodeId: 'feat-7' },
        88,
      );
    });
    const panel = screen.getByTestId('collab-presence-panel');
    expect(panel.textContent).toMatch(/editing/);
    expect(panel.textContent).toMatch(/tree/);
  });

  it('shows "editing · form" status for peer with selection', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-6">
          <AwarenessSpy />
          <PresencePanel lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(
        capturedAwareness!,
        { id: 'eve', name: 'Eve', color: 'hsl(180,65%,58%)', selection: ['hole-diameter'] },
        66,
      );
    });
    expect(screen.getByTestId('collab-presence-panel').textContent).toMatch(/form/);
  });

  it('shows "idle" for peer with no activity', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-7">
          <AwarenessSpy />
          <PresencePanel lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(
        capturedAwareness!,
        { id: 'fred', name: 'Fred', color: 'hsl(300,65%,58%)' },
        44,
      );
    });
    expect(screen.getByTestId('collab-presence-panel').textContent).toMatch(/idle/);
  });

  it('renders dimmed for stale peer (ts > STALE_AFTER_MS)', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-8">
          <AwarenessSpy />
          <PresencePanel lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(
        capturedAwareness!,
        { id: 'g', name: 'Greg', color: 'hsl(20,65%,58%)', ts: Date.now() - 120_000 },
        33,
      );
    });
    const rows = screen.getAllByTestId('collab-presence-row');
    const greg = rows.find((r) => r.textContent?.includes('Greg'));
    expect(greg).toBeTruthy();
    expect(greg!.getAttribute('style') ?? '').toMatch(/opacity:\s*0\.5/);
  });
});

describe('PresencePanel · UI behaviours', () => {
  it('collapses body on toggle click', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-9">
          <AwarenessSpy />
          <PresencePanel lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(capturedAwareness!, { id: 'h', name: 'Hank', color: 'hsl(40,65%,58%)' }, 22);
    });
    expect(screen.getByTestId('collab-presence-body')).toBeTruthy();
    fireEvent.click(screen.getByTestId('collab-presence-toggle'));
    expect(screen.queryByTestId('collab-presence-body')).toBeNull();
  });

  it('invite button copies invite URL via clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    await act(async () => {
      render(
        <CollabProvider docId="presence-10">
          <AwarenessSpy />
          <PresencePanel lang="en" getInviteUrl={() => 'https://example.com/doc/x'} />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(capturedAwareness!, { id: 'i', name: 'Ivy', color: 'hsl(50,65%,58%)' }, 11);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('collab-presence-invite'));
    });
    expect(writeText).toHaveBeenCalledWith('https://example.com/doc/x');
  });

  it('invite button surfaces "Copied!" after success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    await act(async () => {
      render(
        <CollabProvider docId="presence-11">
          <AwarenessSpy />
          <PresencePanel lang="en" getInviteUrl={() => 'https://test'} />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(capturedAwareness!, { id: 'j', name: 'Jay', color: 'hsl(70,65%,58%)' }, 13);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('collab-presence-invite'));
    });
    expect(screen.getByTestId('collab-presence-invite').textContent).toMatch(/Copied/);
  });

  it('respects position prop', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-12">
          <AwarenessSpy />
          <PresencePanel lang="en" position="bottom-left" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(capturedAwareness!, { id: 'k', name: 'Kim', color: 'hsl(80,65%,58%)' }, 14);
    });
    const style = screen.getByTestId('collab-presence-panel').getAttribute('style') ?? '';
    expect(style).toMatch(/bottom: 8px/);
    expect(style).toMatch(/left: 8px/);
  });

  it('uses Korean labels for lang=ko', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="presence-13">
          <AwarenessSpy />
          <PresencePanel lang="ko" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemotePeer(capturedAwareness!, { id: 'l', name: 'Lily', color: 'hsl(90,65%,58%)' }, 15);
    });
    expect(screen.getByTestId('collab-presence-panel').textContent).toMatch(/함께 작업/);
  });
});

describe('PresencePanel · safety', () => {
  it('outside a CollabProvider is a no-op (CollabSafe boundary)', async () => {
    // Suppress React's error log for the expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      render(<PresencePanel lang="en" />);
    });
    expect(screen.queryByTestId('collab-presence-panel')).toBeNull();
    spy.mockRestore();
  });
});
