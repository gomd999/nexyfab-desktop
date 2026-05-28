'use client';

/**
 * SketchPeerCursors.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Sketch-viewport overlay that renders one labeled cursor + name pill per
 * **remote** peer whose awareness state carries a cursor at
 * `viewport === 'sketch'`.
 *
 * Coordinate system:
 *   The host passes the sketch's SVG viewBox transform (zoom + pan) via
 *   the `mmToScreen` callback. Peers publish cursors in sketch-mm units
 *   (the same coords sketch geometry is stored in) so a peer dragging a
 *   point sees the same world position across browsers regardless of
 *   zoom. The host converts mm→px right before render.
 *
 * Smooth interpolation:
 *   Awareness updates arrive at ≤20Hz (50ms throttle per
 *   `awarenessThrottle.ts`). At 20Hz the cursor would visibly stutter.
 *   We interpolate via CSS `transition: transform 80ms linear` — slightly
 *   longer than the throttle interval so the cursor finishes one tween
 *   just as the next sample lands. Pure-CSS animation; no rAF loop here.
 *
 * Self vs. remote:
 *   The hook consumes `useCollabPresence().remotePeers` only — local
 *   cursor is implicit (the mouse pointer itself). We never duplicate.
 *
 * Stable colors:
 *   `peer.color` is set on join via `peerColorFromId(peerId)` — that
 *   hash maps the same peer to the same hue across reconnects within
 *   one session.
 *
 * Z5 host integration: mount this in `SketchCanvas`'s SVG root (single
 * boundary-marked line — mirrors Z2's touchpoint discipline). The host
 * passes `viewportWidth`/`viewportHeight` and a `mmToScreen` projection
 * function (the same one the canvas uses for its own draw calls).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useCollabPresence } from '../collab/CollabProvider';
import { CollabSafe } from '../collab/CollabSafe';

// ─── Public props ───────────────────────────────────────────────────────────

export interface SketchPeerCursorsProps {
  /**
   * Viewport tag this overlay should filter on. Default `'sketch'`. The
   * peer must have published `cursor.viewport === viewportTag` to render.
   *
   * The CAD app has many SVG surfaces (sketch, drawing, BOM) that share
   * one awareness channel — this tag lets each one filter for its own
   * cursors.
   */
  viewportTag?: string;
  /**
   * Project a sketch-mm `(x, y)` into screen-pixel `(left, top)` relative
   * to the overlay's containing positioned ancestor. The host (SketchCanvas)
   * already maintains zoom + pan state; passing the same projection here
   * keeps the cursors locked to the sketch geometry under all transforms.
   */
  mmToScreen?: (xMm: number, yMm: number) => { left: number; top: number };
  /** Pixel width of the viewport — used to clamp cursors that are
   *  outside the visible area. */
  viewportWidth?: number;
  /** Pixel height of the viewport — used to clamp cursors. */
  viewportHeight?: number;
  /** Test-only override: hide a particular peer id (e.g. when running
   *  multi-peer storybook fixtures one panel at a time). */
  hidePeerIds?: string[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const STALE_AFTER_MS = 15_000;
const INTERPOLATION_MS = 80; // slightly above the 50ms broadcast throttle

// Identity projection: 1mm == 1px when no host transform passed. Useful
// for tests + the storybook harness.
const IDENTITY_PROJECTION = (xMm: number, yMm: number) => ({ left: xMm, top: yMm });

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Wrapper that protects against being rendered outside a CollabProvider —
 * see `CollabSafe.tsx` for rationale. The implementation lives in
 * `SketchPeerCursorsInner` below.
 */
export function SketchPeerCursors(props: SketchPeerCursorsProps = {}) {
  return (
    <CollabSafe>
      <SketchPeerCursorsInner {...props} />
    </CollabSafe>
  );
}

function SketchPeerCursorsInner(props: SketchPeerCursorsProps) {
  const {
    viewportTag = 'sketch',
    mmToScreen = IDENTITY_PROJECTION,
    viewportWidth,
    viewportHeight,
    hidePeerIds,
  } = props;
  const { remotePeers } = useCollabPresence();
  // `now` is snapshotted in an effect whenever `remotePeers` identity
  // changes — keeps the staleness check fresh without calling `Date.now()`
  // during render (impure under react-hooks/purity).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
  }, [remotePeers]);

  const visible = useMemo(() => {
    const hide = new Set(hidePeerIds ?? []);
    return Object.values(remotePeers).filter((peer) => {
      if (hide.has(peer.id)) return false;
      if (!peer.cursor) return false;
      if (peer.cursor.viewport !== viewportTag) return false;
      if (typeof peer.ts === 'number' && now - peer.ts > STALE_AFTER_MS) return false;
      return true;
    });
  }, [remotePeers, viewportTag, hidePeerIds, now]);

  if (visible.length === 0) return null;

  return (
    <div
      data-testid="sketch-peer-cursors"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {visible.map((peer) => {
        const c = peer.cursor!;
        const screen = mmToScreen(c.x, c.y);
        // Clamp off-screen cursors to the viewport edge (within ±20px) so
        // peers offscreen don't disappear silently.
        const left = clampMaybe(screen.left, 0, viewportWidth);
        const top = clampMaybe(screen.top, 0, viewportHeight);
        return (
          <PeerCursorMarker
            key={peer.id}
            id={peer.id}
            name={peer.name}
            color={peer.color}
            left={left}
            top={top}
          />
        );
      })}
    </div>
  );
}

function clampMaybe(v: number, min: number, max?: number): number {
  if (typeof max !== 'number') return v;
  if (!isFinite(v)) return min;
  return Math.max(min - 12, Math.min(v, max + 12));
}

// ─── Single cursor marker ───────────────────────────────────────────────────

function PeerCursorMarker(props: {
  id: string;
  name: string;
  color: string;
  left: number;
  top: number;
}) {
  const { id, name, color, left, top } = props;
  return (
    <div
      data-testid="sketch-peer-cursor"
      data-peer-id={id}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: `translate3d(${left}px, ${top}px, 0)`,
        transition: `transform ${INTERPOLATION_MS}ms linear`,
        willChange: 'transform',
        pointerEvents: 'none',
      }}
    >
      {/* Arrow — Figma-style pointer */}
      <svg
        width="16"
        height="18"
        viewBox="0 0 16 18"
        aria-hidden="true"
        style={{ display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
      >
        <path
          d="M1 1 L1 14 L5 11 L8 17 L10 16 L7 10 L13 10 Z"
          fill={color}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="0.6"
          strokeLinejoin="round"
        />
      </svg>
      {/* Name pill */}
      <span
        style={{
          position: 'absolute',
          left: 14,
          top: 14,
          background: color,
          color: '#0a0a0a',
          fontSize: 10,
          fontWeight: 700,
          padding: '1px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          fontFamily: 'system-ui, sans-serif',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      >
        {name}
      </span>
    </div>
  );
}

export default SketchPeerCursors;
