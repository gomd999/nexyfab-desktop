// @vitest-environment jsdom

/**
 * EditingFocusIndicator.test.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Covers:
 *  - Wraps children unmodified when no peer is editing
 *  - Renders colored border + tooltip when a peer's selection has focusId
 *  - Tooltip shows the peer's name
 *  - tooltipFormat override is used
 *  - borderWidth override is applied
 *  - showTooltip=false hides the tooltip
 *  - Multiple peers on same field: most-recently-active wins
 *  - Outside <CollabProvider> children render normally
 */

import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { Awareness } from 'y-protocols/awareness';

import { EditingFocusIndicator } from '../EditingFocusIndicator';
import { CollabProvider, useCollabAwareness } from '../CollabProvider';

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
  peer: { id: string; name: string; color: string; selection?: string[]; ts?: number },
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

describe('EditingFocusIndicator', () => {
  it('renders children unmodified when no peer is editing', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="focus-1">
          <EditingFocusIndicator focusId="diameter">
            <input data-testid="payload" />
          </EditingFocusIndicator>
        </CollabProvider>,
      );
    });
    expect(screen.getByTestId('payload')).toBeTruthy();
    expect(screen.queryByTestId('editing-focus-indicator')).toBeNull();
  });

  it('applies colored border when a peer is editing the focusId', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="focus-2">
          <AwarenessSpy />
          <EditingFocusIndicator focusId="diameter">
            <input />
          </EditingFocusIndicator>
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'a', name: 'Alice', color: 'hsl(15,65%,58%)', selection: ['diameter'] }, 1);
    });
    const indicator = screen.getByTestId('editing-focus-indicator');
    expect(indicator.getAttribute('style')).toMatch(/outline:.*hsl\(15,\s*65%,\s*58%\)/);
  });

  it('renders tooltip with peer name', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="focus-3">
          <AwarenessSpy />
          <EditingFocusIndicator focusId="diameter">
            <input />
          </EditingFocusIndicator>
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'b', name: 'Beth', color: 'hsl(45,65%,58%)', selection: ['diameter'] }, 1);
    });
    expect(screen.getByTestId('editing-focus-tooltip').textContent).toMatch(/Beth/);
  });

  it('uses custom tooltipFormat', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="focus-4">
          <AwarenessSpy />
          <EditingFocusIndicator
            focusId="diameter"
            tooltipFormat={(n) => `${n} is editing`}
          >
            <input />
          </EditingFocusIndicator>
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'c', name: 'Cara', color: 'hsl(0,65%,58%)', selection: ['diameter'] }, 1);
    });
    expect(screen.getByTestId('editing-focus-tooltip').textContent).toBe('Cara is editing');
  });

  it('hides tooltip when showTooltip=false', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="focus-5">
          <AwarenessSpy />
          <EditingFocusIndicator focusId="diameter" showTooltip={false}>
            <input />
          </EditingFocusIndicator>
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'd', name: 'Dan', color: 'hsl(0,65%,58%)', selection: ['diameter'] }, 1);
    });
    expect(screen.queryByTestId('editing-focus-tooltip')).toBeNull();
    expect(screen.getByTestId('editing-focus-indicator')).toBeTruthy();
  });

  it('respects borderWidth override', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="focus-6">
          <AwarenessSpy />
          <EditingFocusIndicator focusId="diameter" borderWidth={5}>
            <input />
          </EditingFocusIndicator>
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'e', name: 'Eli', color: 'hsl(0,65%,58%)', selection: ['diameter'] }, 1);
    });
    expect(screen.getByTestId('editing-focus-indicator').getAttribute('style'))
      .toMatch(/outline:\s*5px/);
  });

  it('picks the most-recently-active peer when multiple match', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="focus-7">
          <AwarenessSpy />
          <EditingFocusIndicator focusId="diameter">
            <input />
          </EditingFocusIndicator>
        </CollabProvider>,
      );
    });
    await act(async () => {
      injectRemote(capturedAwareness!,
        { id: 'old', name: 'Old', color: 'hsl(0,65%,58%)', selection: ['diameter'], ts: 1000 }, 1);
      injectRemote(capturedAwareness!,
        { id: 'new', name: 'New', color: 'hsl(120,65%,58%)', selection: ['diameter'], ts: 2000 }, 2);
    });
    const indicator = screen.getByTestId('editing-focus-indicator');
    expect(indicator.getAttribute('data-peer-id')).toBe('new');
  });

  it('outside <CollabProvider> renders children un-decorated', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      render(
        <EditingFocusIndicator focusId="diameter">
          <input data-testid="bare-input" />
        </EditingFocusIndicator>,
      );
    });
    expect(screen.getByTestId('bare-input')).toBeTruthy();
    expect(screen.queryByTestId('editing-focus-indicator')).toBeNull();
    spy.mockRestore();
  });
});
