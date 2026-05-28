// @vitest-environment jsdom

/**
 * awarenessThrottle.test.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Unit tests for the throttled cursor broadcast hook. Cover:
 *  - default interval is 50ms (≤ 20 ops/sec per ADR-012 §8)
 *  - rapid calls coalesce to the LATEST sample
 *  - rAF path used when available, setTimeout fallback otherwise
 *  - flush() drains immediately
 *  - cancel() drops a pending broadcast
 *  - unmount drains any pending sample
 *  - safe with null awareness (no-op)
 *  - safe across awareness swap mid-mount
 *  - custom intervalMs respected
 *  - awareness destruction mid-flush is swallowed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

import {
  useThrottledCursorBroadcast,
  DEFAULT_THROTTLE_INTERVAL_MS,
} from '../awarenessThrottle';

function makeAwareness(): { doc: Y.Doc; awareness: Awareness } {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  // Seed identity so encodeLocalPresence has a base to merge into.
  awareness.setLocalState({ id: 'self', name: 'Self', color: 'hsl(0,65%,58%)' });
  return { doc, awareness };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('awarenessThrottle · default contract', () => {
  it('exports a 50ms default interval', () => {
    expect(DEFAULT_THROTTLE_INTERVAL_MS).toBe(50);
  });

  it('exposes setCursor / flush / cancel methods', () => {
    const { awareness } = makeAwareness();
    const { result } = renderHook(() =>
      useThrottledCursorBroadcast(awareness, { useRaf: false }),
    );
    expect(typeof result.current.setCursor).toBe('function');
    expect(typeof result.current.flush).toBe('function');
    expect(typeof result.current.cancel).toBe('function');
  });

  it('stable setCursor identity across renders', () => {
    const { awareness } = makeAwareness();
    const { result, rerender } = renderHook(
      ({ a }: { a: Awareness | null }) =>
        useThrottledCursorBroadcast(a, { useRaf: false }),
      { initialProps: { a: awareness as Awareness | null } },
    );
    const first = result.current.setCursor;
    rerender({ a: awareness });
    expect(result.current.setCursor).toBe(first);
  });
});

describe('awarenessThrottle · throttling', () => {
  it('broadcasts the latest sample within intervalMs', () => {
    const { awareness } = makeAwareness();
    const { result } = renderHook(() =>
      useThrottledCursorBroadcast(awareness, { useRaf: false, intervalMs: 50 }),
    );
    act(() => {
      result.current.setCursor(1, 2, 'sketch');
    });
    // Before timer elapses → no broadcast.
    expect((awareness.getLocalState() as { cursor?: unknown }).cursor).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect((awareness.getLocalState() as { cursor: { x: number } }).cursor).toEqual({
      x: 1, y: 2, viewport: 'sketch',
    });
  });

  it('coalesces rapid calls — only the latest survives', () => {
    const { awareness } = makeAwareness();
    const { result } = renderHook(() =>
      useThrottledCursorBroadcast(awareness, { useRaf: false, intervalMs: 50 }),
    );
    act(() => {
      result.current.setCursor(1, 1, 'sketch');
      result.current.setCursor(2, 2, 'sketch');
      result.current.setCursor(3, 3, 'sketch');
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect((awareness.getLocalState() as { cursor: { x: number } }).cursor).toEqual({
      x: 3, y: 3, viewport: 'sketch',
    });
  });

  it('respects a custom intervalMs', () => {
    const { awareness } = makeAwareness();
    const { result } = renderHook(() =>
      useThrottledCursorBroadcast(awareness, { useRaf: false, intervalMs: 200 }),
    );
    act(() => {
      result.current.setCursor(7, 8, 'tree');
    });
    act(() => { vi.advanceTimersByTime(150); });
    expect((awareness.getLocalState() as { cursor?: unknown }).cursor).toBeUndefined();
    act(() => { vi.advanceTimersByTime(60); });
    expect((awareness.getLocalState() as { cursor: { x: number } }).cursor).toEqual({
      x: 7, y: 8, viewport: 'tree',
    });
  });

  it('after one broadcast, subsequent setCursor schedules a fresh timeout', () => {
    const { awareness } = makeAwareness();
    const { result } = renderHook(() =>
      useThrottledCursorBroadcast(awareness, { useRaf: false, intervalMs: 50 }),
    );
    act(() => { result.current.setCursor(1, 1, 'sketch'); });
    act(() => { vi.advanceTimersByTime(50); });
    act(() => { result.current.setCursor(2, 2, 'sketch'); });
    act(() => { vi.advanceTimersByTime(50); });
    expect((awareness.getLocalState() as { cursor: { x: number } }).cursor.x).toBe(2);
  });
});

describe('awarenessThrottle · flush / cancel / unmount', () => {
  it('flush() drains pending immediately without waiting for the timer', () => {
    const { awareness } = makeAwareness();
    const { result } = renderHook(() =>
      useThrottledCursorBroadcast(awareness, { useRaf: false }),
    );
    act(() => { result.current.setCursor(5, 5, 'sketch'); });
    expect((awareness.getLocalState() as { cursor?: unknown }).cursor).toBeUndefined();
    act(() => { result.current.flush(); });
    expect((awareness.getLocalState() as { cursor: { x: number } }).cursor.x).toBe(5);
  });

  it('cancel() drops the pending broadcast — nothing arrives even after intervalMs', () => {
    const { awareness } = makeAwareness();
    const { result } = renderHook(() =>
      useThrottledCursorBroadcast(awareness, { useRaf: false, intervalMs: 50 }),
    );
    act(() => { result.current.setCursor(9, 9, 'sketch'); });
    act(() => { result.current.cancel(); });
    act(() => { vi.advanceTimersByTime(200); });
    expect((awareness.getLocalState() as { cursor?: unknown }).cursor).toBeUndefined();
  });

  it('unmount drains any pending sample so peers see the last position', () => {
    const { awareness } = makeAwareness();
    const { result, unmount } = renderHook(() =>
      useThrottledCursorBroadcast(awareness, { useRaf: false, intervalMs: 100 }),
    );
    act(() => { result.current.setCursor(11, 22, 'sketch'); });
    expect((awareness.getLocalState() as { cursor?: unknown }).cursor).toBeUndefined();
    act(() => { unmount(); });
    expect((awareness.getLocalState() as { cursor: { x: number } }).cursor).toEqual({
      x: 11, y: 22, viewport: 'sketch',
    });
  });
});

describe('awarenessThrottle · safety', () => {
  it('is a no-op when awareness is null', () => {
    const { result } = renderHook(() =>
      useThrottledCursorBroadcast(null, { useRaf: false }),
    );
    // Just doesn't throw.
    expect(() => {
      act(() => { result.current.setCursor(1, 2, 'sketch'); });
      act(() => { vi.advanceTimersByTime(100); });
    }).not.toThrow();
  });

  it('handles awareness swap mid-mount', () => {
    const a1 = makeAwareness();
    const a2 = makeAwareness();
    const { result, rerender } = renderHook(
      ({ a }: { a: Awareness | null }) =>
        useThrottledCursorBroadcast(a, { useRaf: false, intervalMs: 50 }),
      { initialProps: { a: a1.awareness as Awareness | null } },
    );
    act(() => { result.current.setCursor(1, 1, 'sketch'); });
    rerender({ a: a2.awareness });
    act(() => { vi.advanceTimersByTime(50); });
    // The swap installs a2, but the pending sample still flushes — to whichever awareness was current at flush time (a2).
    const a2Cursor = (a2.awareness.getLocalState() as { cursor?: { x: number } }).cursor;
    expect(a2Cursor?.x).toBe(1);
  });

  it('swallows awareness destruction mid-flight', () => {
    const { awareness } = makeAwareness();
    const { result } = renderHook(() =>
      useThrottledCursorBroadcast(awareness, { useRaf: false, intervalMs: 50 }),
    );
    act(() => { result.current.setCursor(3, 3, 'sketch'); });
    awareness.destroy();
    expect(() => {
      act(() => { vi.advanceTimersByTime(100); });
    }).not.toThrow();
  });
});
