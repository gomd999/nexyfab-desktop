'use client';

// Touch gesture handler for the viewport. Converts multi-pointer events
// into orbit / zoom / pan deltas that ShapePreview's OrbitControls can
// consume. Wires up on demand via useEffect; teardown removes listeners.
//
// Gestures:
//   - 1 finger drag        → orbit (emit `nexyfab:gesture-orbit`)
//   - 2 finger pinch       → zoom  (emit `nexyfab:gesture-zoom`)
//   - 2 finger pan         → pan   (emit `nexyfab:gesture-pan`)
//   - long-press (500ms)   → select (emit `nexyfab:gesture-longpress`)
//
// Events bubble through `window` so any viewport instance can listen
// without prop drilling. ShapePreview attaches the corresponding three.js
// camera operations.

import { useEffect } from 'react';

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOL = 8; // px — cancels long-press if pointer moved

export interface TouchGestureOptions {
  /** CSS selector for the viewport element. Defaults to .nx-viewport. */
  selector?: string;
  /** Disable when false (e.g. desktop). */
  enabled?: boolean;
}

export function useTouchGestures(opts: TouchGestureOptions = {}): void {
  const { selector = '.nx-viewport', enabled = true } = opts;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') return;
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return;

    const pointers = new Map<number, { x: number; y: number; startX: number; startY: number; startT: number }>();
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let prevDist: number | null = null;
    let prevMid: { x: number; y: number } | null = null;

    const dispatch = (name: string, detail: unknown) => {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    };

    const cancelLongPress = () => {
      if (longPressTimer != null) { clearTimeout(longPressTimer); longPressTimer = null; }
    };

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, {
        x: e.clientX, y: e.clientY,
        startX: e.clientX, startY: e.clientY,
        startT: Date.now(),
      });
      if (pointers.size === 1) {
        cancelLongPress();
        longPressTimer = setTimeout(() => {
          const p = pointers.get(e.pointerId);
          if (!p) return;
          const moved = Math.hypot(p.x - p.startX, p.y - p.startY);
          if (moved < LONG_PRESS_MOVE_TOL) {
            dispatch('nexyfab:gesture-longpress', { x: p.x, y: p.y });
          }
        }, LONG_PRESS_MS);
      } else {
        cancelLongPress();
      }
      el.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const prevX = p.x, prevY = p.y;
      p.x = e.clientX; p.y = e.clientY;

      // Cancel long-press if user moved past tolerance.
      if (Math.hypot(p.x - p.startX, p.y - p.startY) > LONG_PRESS_MOVE_TOL) {
        cancelLongPress();
      }

      if (pointers.size === 1) {
        dispatch('nexyfab:gesture-orbit', {
          dx: p.x - prevX,
          dy: p.y - prevY,
        });
      } else if (pointers.size >= 2) {
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (prevDist != null && prevMid != null) {
          const zoomFactor = dist / prevDist;
          dispatch('nexyfab:gesture-zoom', { factor: zoomFactor, x: mid.x, y: mid.y });
          dispatch('nexyfab:gesture-pan', {
            dx: mid.x - prevMid.x,
            dy: mid.y - prevMid.y,
          });
        }
        prevDist = dist;
        prevMid = mid;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) { prevDist = null; prevMid = null; }
      cancelLongPress();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('pointerleave', onPointerUp);

    return () => {
      cancelLongPress();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('pointerleave', onPointerUp);
    };
  }, [selector, enabled]);
}
