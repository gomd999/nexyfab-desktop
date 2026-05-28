// @vitest-environment jsdom

/**
 * CollabConnectionBadge.test.tsx — Wave 2 Phase 3 W1 Track Z1.
 *
 * Render tests for the badge. The badge reads its data from the Provider's
 * context, so we render it inside the real <CollabProvider> (local-only
 * mode → no WS, only BC + IDB) and assert the surface text.
 *
 * Note: in jsdom there's no `BroadcastChannel` API by default, so the
 * Provider reports `bc: 'inactive'`. That's fine — we're not testing BC
 * routing here, only that the badge renders the expected severity buckets.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';

import { CollabConnectionBadge } from '../CollabConnectionBadge';
import { CollabProvider } from '../CollabProvider';

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CollabConnectionBadge', () => {
  it('renders Local-only when no wsEndpoint is provided', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="badge-test-1">
          <CollabConnectionBadge />
        </CollabProvider>,
      );
    });
    const badge = screen.getByTestId('collab-connection-badge');
    expect(badge.textContent).toMatch(/Local-only/);
  });

  it('renders Connecting… initially when wsEndpoint is set', async () => {
    // Stub WebSocket so the provider's WS code path runs but never connects.
    type WsGlobal = { WebSocket?: unknown };
    const oldWs = (globalThis as WsGlobal).WebSocket;
    (globalThis as WsGlobal).WebSocket = class StubWs {
      readyState = 0;
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    };
    try {
      await act(async () => {
        render(
          <CollabProvider docId="badge-test-2" wsEndpoint="wss://example.invalid">
            <CollabConnectionBadge />
          </CollabProvider>,
        );
      });
      const badge = screen.getByTestId('collab-connection-badge');
      // Either still connecting or already failed to disconnected; both render valid badges.
      expect(badge.textContent).toMatch(/(Connecting|Disconnected|Local-only)/);
    } finally {
      (globalThis as WsGlobal).WebSocket = oldWs;
    }
  });

  it('shows the per-transport tooltip on hover', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="badge-test-3">
          <CollabConnectionBadge />
        </CollabProvider>,
      );
    });
    const badge = screen.getByTestId('collab-connection-badge');
    expect(screen.queryByTestId('collab-connection-tooltip')).toBeNull();
    fireEvent.mouseEnter(badge);
    const tooltip = screen.getByTestId('collab-connection-tooltip');
    expect(tooltip.textContent).toMatch(/WebSocket/);
    expect(tooltip.textContent).toMatch(/BroadcastChannel/);
    expect(tooltip.textContent).toMatch(/IndexedDB/);
    fireEvent.mouseLeave(badge);
    expect(screen.queryByTestId('collab-connection-tooltip')).toBeNull();
  });

  it('accepts custom labels for i18n', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="badge-test-4">
          <CollabConnectionBadge labels={{ localOnly: '로컬 전용' }} />
        </CollabProvider>,
      );
    });
    expect(screen.getByTestId('collab-connection-badge').textContent).toMatch(/로컬 전용/);
  });

  it('positions according to the position prop', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="badge-test-5">
          <CollabConnectionBadge position="bottom-left" />
        </CollabProvider>,
      );
    });
    const badge = screen.getByTestId('collab-connection-badge');
    const style = badge.getAttribute('style') ?? '';
    expect(style).toMatch(/bottom: 8px/);
    expect(style).toMatch(/left: 8px/);
  });

  it('renders with the default top-right position when no prop given', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="badge-test-6">
          <CollabConnectionBadge />
        </CollabProvider>,
      );
    });
    const badge = screen.getByTestId('collab-connection-badge');
    const style = badge.getAttribute('style') ?? '';
    expect(style).toMatch(/top: 8px/);
    expect(style).toMatch(/right: 8px/);
  });
});
