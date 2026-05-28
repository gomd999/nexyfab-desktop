'use client';

/**
 * awarenessThrottle.ts — Wave 2 Phase 3 W5 Track Z5.
 *
 * Cursor positions move at mouse-move rate (potentially hundreds of events
 * per second on a high-DPI surface with a 1000Hz mouse). Broadcasting every
 * single sample through the awareness channel would saturate the BC and
 * Durable Object budget — ADR-012 §8 caps awareness traffic at
 * **≤ 20 ops/sec per peer**.
 *
 * This module ships ONE primitive: `useThrottledCursorBroadcast` — a hook
 * that returns a stable `setCursor(x, y, viewport)` function. The function
 * coalesces rapid calls and emits at most once every 50ms (configurable
 * via `intervalMs`) using a `requestAnimationFrame` driver so the cadence
 * stays in step with the renderer when the tab is foregrounded.
 *
 * Coalescing rule: only the **latest** call is sent. Intermediate samples
 * are discarded — by the time the throttled tick fires, the user has
 * already moved on. This is the right tradeoff for cursor presence; for
 * selection edits we want every op (W6+ scope).
 *
 * The hook ALSO emits the final cursor position on unmount via a synchronous
 * one-shot — guarantees peers see the last position instead of a stale
 * 50ms-old sample.
 *
 * Z5 deliberately does NOT throttle `selection` or `activeNodeId`. Those
 * are low-frequency (click / panel-enter only) and want to land on peers
 * with sub-frame latency for "@John is editing this" responsiveness.
 *
 * Pure client-side; no server state. Same primitive works for sketch
 * cursors, form-field focus, and feature-tree hover.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { encodeLocalPresence } from './awareness';

// ─── Public types ───────────────────────────────────────────────────────────

export interface ThrottledCursorOptions {
  /** Minimum gap between broadcasts in ms. Default 50ms (≈ 20 ops/sec). */
  intervalMs?: number;
  /**
   * Use `requestAnimationFrame` to drive the flush. Default true. When
   * false, falls back to `setTimeout` (useful for SSR / unit tests where
   * rAF is unavailable).
   */
  useRaf?: boolean;
}

export interface ThrottledCursorAPI {
  /** Schedule a cursor update. Coalesces to ≤1 broadcast per `intervalMs`. */
  setCursor: (x: number, y: number, viewport: string) => void;
  /** Flush whatever's pending immediately. Useful on blur / unmount. */
  flush: () => void;
  /** Clear any pending cursor write without broadcasting. */
  cancel: () => void;
}

// ─── Default config ─────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 50;

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Returns a stable, throttled cursor-broadcast API bound to the given
 * Awareness. Safe to call when `awareness` is null — the returned setCursor
 * is a no-op until a real awareness shows up.
 *
 * The hook's identity (the returned `setCursor`) is **stable across
 * renders** so callers can pass it into mouse-move handlers without
 * triggering re-renders of memoized children.
 */
export function useThrottledCursorBroadcast(
  awareness: Awareness | null,
  options: ThrottledCursorOptions = {},
): ThrottledCursorAPI {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const useRaf = options.useRaf ?? true;

  const awarenessRef = useRef<Awareness | null>(awareness);
  const intervalRef = useRef<number>(intervalMs);
  const useRafRef = useRef<boolean>(useRaf);
  const pendingRef = useRef<{ x: number; y: number; viewport: string } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync refs so caller can swap `awareness` without re-creating the hook.
  useEffect(() => {
    awarenessRef.current = awareness;
  }, [awareness]);
  useEffect(() => {
    intervalRef.current = intervalMs;
  }, [intervalMs]);
  useEffect(() => {
    useRafRef.current = useRaf;
  }, [useRaf]);

  // ── Internal: cancel any pending flush ──────────────────────────────────
  const clearScheduled = useCallback(() => {
    if (rafIdRef.current !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        try { cancelAnimationFrame(rafIdRef.current); } catch { /* best-effort */ }
      }
      rafIdRef.current = null;
    }
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  }, []);

  // ── Internal: actually send pending cursor ──────────────────────────────
  const doFlush = useCallback(() => {
    clearScheduled();
    const pending = pendingRef.current;
    const aware = awarenessRef.current;
    if (!pending || !aware) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = null;
    try {
      encodeLocalPresence(aware, { cursor: { ...pending } });
    } catch {
      // Awareness could be destroyed mid-flight — swallow.
    }
  }, [clearScheduled]);

  // ── Internal: schedule a flush, respecting intervalMs ──────────────────
  //
  // Wait always = full intervalMs from when the first pending sample lands.
  // We deliberately do NOT short-circuit to wait=0 just because lastSentAt
  // is old — the throttle's job is to coalesce traffic across the user's
  // burst, not to flush the first sample immediately. (Real cursor traffic
  // arrives in bursts of dozens of samples — letting the first land at
  // wait=0 starves the coalescing window.)
  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null || timeoutIdRef.current !== null) return;
    const interval = intervalRef.current;

    if (useRafRef.current && typeof requestAnimationFrame !== 'undefined') {
      // rAF path: still fires within one frame (~16ms) but we re-check the
      // elapsed gap when it does and re-schedule to honour the interval.
      const start = Date.now();
      const tick = () => {
        const elapsed = Date.now() - start;
        if (elapsed >= interval) {
          rafIdRef.current = null;
          doFlush();
        } else {
          rafIdRef.current = requestAnimationFrame(tick);
        }
      };
      rafIdRef.current = requestAnimationFrame(tick);
    } else {
      timeoutIdRef.current = setTimeout(() => {
        timeoutIdRef.current = null;
        doFlush();
      }, interval);
    }
  }, [doFlush]);

  // ── Public setCursor (stable identity) ──────────────────────────────────
  const setCursor = useCallback(
    (x: number, y: number, viewport: string) => {
      pendingRef.current = { x, y, viewport };
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const flush = useCallback(() => {
    doFlush();
  }, [doFlush]);

  const cancel = useCallback(() => {
    pendingRef.current = null;
    clearScheduled();
  }, [clearScheduled]);

  // ── Unmount: flush any remaining pending sample so peers see the
  // last position instead of a stale 50ms-old one. ────────────────────────
  useEffect(() => {
    return () => {
      const pending = pendingRef.current;
      clearScheduled();
      if (pending && awarenessRef.current) {
        try {
          encodeLocalPresence(awarenessRef.current, { cursor: { ...pending } });
        } catch {
          /* awareness destroyed — fine */
        }
      }
      pendingRef.current = null;
    };
  }, [clearScheduled]);

  return { setCursor, flush, cancel };
}

// ─── Test-only escape hatches ────────────────────────────────────────────────
//
// Vitest cases can import these to verify the default interval contract
// without needing to reach into private constants.

/** Default throttle gap in ms (≈ 20 ops/sec). */
export const DEFAULT_THROTTLE_INTERVAL_MS = DEFAULT_INTERVAL_MS;
