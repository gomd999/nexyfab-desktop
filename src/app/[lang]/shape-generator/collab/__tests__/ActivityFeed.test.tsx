// @vitest-environment jsdom

/**
 * ActivityFeed.test.tsx — Wave 2 Phase 3 W7 Track Z7.
 *
 * Coverage:
 *  - auto-hides when log is empty
 *  - forceShow renders even when empty
 *  - rendered rows correspond to log entries (newest first)
 *  - peer color dot rendered
 *  - relative time string rendered
 *  - clicking entry with entityId emits nfab:activity-focus
 *  - clicking entry WITHOUT entityId emits nothing
 *  - "Clear local view" button hides current entries
 *  - position prop drives anchor styling
 *  - lang prop uses dict
 *  - compact prop renders inline (no panel chrome)
 *  - maxRows limits row count
 *  - safe outside CollabProvider (CollabSafe boundary)
 */

import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';

import { ActivityFeed, NFAB_ACTIVITY_FOCUS_EVENT } from '../ActivityFeedPanel';
import { CollabProvider } from '../CollabProvider';
import { appendActivityToDoc } from '../ActivityFeedYjs';
import { useCollabDoc } from '../CollabProvider';

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
  postMessage(_data: unknown) { /* no-op for these tests */ }
  addEventListener(_event: 'message', cb: (ev: MessageEvent) => void) {
    this.listeners.add(cb);
  }
  removeEventListener(_event: 'message', cb: (ev: MessageEvent) => void) {
    this.listeners.delete(cb);
  }
  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
  static reset() {
    FakeBroadcastChannel.channels.clear();
  }
}

// ─── Capture the doc from a Provider for direct manipulation ───────────────

let capturedDoc: Y.Doc | null = null;
function DocSpy() {
  const d = useCollabDoc();
  React.useEffect(() => {
    capturedDoc = d;
  }, [d]);
  return null;
}

const seedEntry = (
  doc: Y.Doc,
  overrides: Partial<{
    id: string;
    kind: string;
    peerName: string | null;
    peerColor: string;
    timestamp: number;
    summary: string;
    entityId: string;
  }> = {},
): void => {
  appendActivityToDoc(doc, {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    kind: (overrides.kind ?? 'tree:addNode') as 'tree:addNode',
    peerId: 'p1',
    peerName: overrides.peerName === undefined ? 'Alice' : overrides.peerName,
    peerColor: overrides.peerColor ?? 'hsl(0,65%,58%)',
    timestamp: overrides.timestamp ?? Date.now(),
    summary: overrides.summary ?? 'sample summary',
    ...(overrides.entityId !== undefined ? { entityId: overrides.entityId } : {}),
  });
};

beforeEach(() => {
  (globalThis as unknown as { BroadcastChannel: typeof FakeBroadcastChannel }).BroadcastChannel = FakeBroadcastChannel;
  FakeBroadcastChannel.reset();
  capturedDoc = null;
});

afterEach(() => {
  cleanup();
  FakeBroadcastChannel.reset();
  delete (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;
  capturedDoc = null;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ActivityFeed · auto-hide', () => {
  it('renders nothing when log is empty', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="act-1">
          <DocSpy />
          <ActivityFeed lang="en" />
        </CollabProvider>,
      );
    });
    expect(screen.queryByTestId('collab-activity-panel')).toBeNull();
  });

  it('forceShow renders panel even when empty', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="act-2">
          <DocSpy />
          <ActivityFeed lang="en" forceShow />
        </CollabProvider>,
      );
    });
    expect(screen.getByTestId('collab-activity-panel')).toBeTruthy();
  });
});

describe('ActivityFeed · renders entries', () => {
  it('renders one row per entry, newest first', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="act-3">
          <DocSpy />
          <ActivityFeed lang="en" />
        </CollabProvider>,
      );
    });
    expect(capturedDoc).toBeTruthy();
    await act(async () => {
      seedEntry(capturedDoc!, { id: 'old', summary: 'old op', timestamp: 1000 });
      seedEntry(capturedDoc!, { id: 'new', summary: 'new op', timestamp: 2000 });
    });
    const rows = screen.getAllByTestId('collab-activity-row');
    expect(rows.length).toBe(2);
    // Newest first.
    expect(rows[0]!.textContent).toContain('new op');
    expect(rows[1]!.textContent).toContain('old op');
  });

  it('renders peer color dot on each row', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="act-4">
          <DocSpy />
          <ActivityFeed lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      seedEntry(capturedDoc!, { id: 'X', peerColor: 'hsl(240, 65%, 58%)' });
    });
    const dots = screen.getAllByTestId('collab-activity-color');
    expect(dots.length).toBe(1);
    expect(dots[0]!.getAttribute('style') ?? '').toContain('hsl(240, 65%, 58%)');
  });

  it('renders relative time string', async () => {
    const tNow = 10_000_000;
    await act(async () => {
      render(
        <CollabProvider docId="act-5">
          <DocSpy />
          <ActivityFeed lang="en" nowMs={tNow} />
        </CollabProvider>,
      );
    });
    await act(async () => {
      seedEntry(capturedDoc!, { id: 'T', timestamp: tNow - 30_000 });
    });
    const time = screen.getByTestId('collab-activity-time');
    expect(time.textContent).toContain('s ago');
  });

  it('uses Korean label for lang=ko', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="act-6">
          <DocSpy />
          <ActivityFeed lang="ko" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      seedEntry(capturedDoc!, { id: 'k' });
    });
    expect(screen.getByTestId('collab-activity-panel').textContent).toMatch(/활동/);
  });
});

describe('ActivityFeed · click → focus event', () => {
  it('clicking row with entityId emits nfab:activity-focus', async () => {
    const listener = vi.fn();
    window.addEventListener(NFAB_ACTIVITY_FOCUS_EVENT, listener);

    await act(async () => {
      render(
        <CollabProvider docId="act-7">
          <DocSpy />
          <ActivityFeed lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      seedEntry(capturedDoc!, { id: 'C', entityId: 'feat-9', kind: 'tree:addNode' });
    });
    const row = screen.getByTestId('collab-activity-row');
    fireEvent.click(row);

    expect(listener).toHaveBeenCalledTimes(1);
    const ev = listener.mock.calls[0]![0] as CustomEvent<{ entityId: string; kind: string }>;
    expect(ev.detail.entityId).toBe('feat-9');
    expect(ev.detail.kind).toBe('tree:addNode');

    window.removeEventListener(NFAB_ACTIVITY_FOCUS_EVENT, listener);
  });

  it('clicking row WITHOUT entityId does NOT emit', async () => {
    const listener = vi.fn();
    window.addEventListener(NFAB_ACTIVITY_FOCUS_EVENT, listener);

    await act(async () => {
      render(
        <CollabProvider docId="act-8">
          <DocSpy />
          <ActivityFeed lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      seedEntry(capturedDoc!, { id: 'N' }); // no entityId
    });
    fireEvent.click(screen.getByTestId('collab-activity-row'));
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(NFAB_ACTIVITY_FOCUS_EVENT, listener);
  });
});

describe('ActivityFeed · Clear local view', () => {
  it('Clear button hides current entries', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="act-9">
          <DocSpy />
          <ActivityFeed lang="en" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      seedEntry(capturedDoc!, { id: 'V', summary: 'visible' });
    });
    expect(screen.getAllByTestId('collab-activity-row').length).toBe(1);
    await act(async () => {
      // Advance the timeline so the cleared cursor is > entry timestamp.
      const real = Date.now;
      Date.now = () => real() + 10_000;
      fireEvent.click(screen.getByTestId('collab-activity-clear'));
      Date.now = real;
    });
    // Panel auto-hides when no entries visible.
    expect(screen.queryByTestId('collab-activity-row')).toBeNull();
  });
});

describe('ActivityFeed · layout', () => {
  it('respects position=bottom-left', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="act-10">
          <DocSpy />
          <ActivityFeed lang="en" position="bottom-left" />
        </CollabProvider>,
      );
    });
    await act(async () => {
      seedEntry(capturedDoc!, { id: 'P' });
    });
    const style = screen.getByTestId('collab-activity-panel').getAttribute('style') ?? '';
    expect(style).toMatch(/bottom: 8px/);
    expect(style).toMatch(/left: 8px/);
  });

  it('compact mode renders rows without panel chrome', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="act-11">
          <DocSpy />
          <ActivityFeed lang="en" compact />
        </CollabProvider>,
      );
    });
    await act(async () => {
      seedEntry(capturedDoc!, { id: 'C' });
    });
    expect(screen.getByTestId('collab-activity-compact')).toBeTruthy();
    expect(screen.queryByTestId('collab-activity-panel')).toBeNull();
  });

  it('maxRows clips the rendered row count', async () => {
    await act(async () => {
      render(
        <CollabProvider docId="act-12">
          <DocSpy />
          <ActivityFeed lang="en" maxRows={2} />
        </CollabProvider>,
      );
    });
    await act(async () => {
      seedEntry(capturedDoc!, { id: '1', timestamp: 100 });
      seedEntry(capturedDoc!, { id: '2', timestamp: 200 });
      seedEntry(capturedDoc!, { id: '3', timestamp: 300 });
      seedEntry(capturedDoc!, { id: '4', timestamp: 400 });
    });
    const rows = screen.getAllByTestId('collab-activity-row');
    expect(rows.length).toBe(2);
  });
});

describe('ActivityFeed · safety', () => {
  it('outside a CollabProvider is a safe no-op (CollabSafe boundary)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      render(<ActivityFeed lang="en" forceShow />);
    });
    // Without a provider, the hook returns null doc → forceShow renders
    // the panel with an empty body (zero entries from in-memory log).
    // Either an empty panel or no panel is acceptable; what we care
    // about is "no crash".
    spy.mockRestore();
    expect(true).toBe(true);
  });
});
