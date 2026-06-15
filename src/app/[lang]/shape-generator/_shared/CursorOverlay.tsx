/**
 * CursorOverlay — remote-peer cursor markers rendered over a viewport.
 *
 * Standalone primitive used by the shape-generator collaboration layer
 * (Phase 1 follow-up to ADR-013). Consumes the awareness snapshot exposed by
 * `useCrdtDoc` — for each remote user whose awareness state carries a
 * `cursor: {x, y}`, renders an SVG marker positioned at the projected client
 * coordinates of the viewport element passed in via `viewportRef`.
 *
 * Layout: the overlay is `position: absolute` and stretches over the viewport
 * bounding rect. Cursor coordinates from awareness are assumed to be in
 * *viewport-local* CSS pixels (i.e. measured against
 * `viewportRef.current.getBoundingClientRect()`), so we render them at the
 * same x/y in our SVG without any further transform. This keeps the contract
 * narrow — projecting model-space coordinates into viewport space is the
 * caller's job (the caller has the camera state; we don't).
 *
 * Colour: each userId is mapped to a deterministic colour. Callers can
 * override via the `userColors` map (e.g. to align with a project's user
 * roster colours); otherwise we hash the userId into a curated palette so
 * the same user always gets the same colour across reloads.
 *
 * testid contract: `cursor-overlay-{userId}` per peer.
 *
 * Note: this overlay is intentionally pointer-events: none — peer cursors
 * must never intercept clicks on the underlying viewport.
 */

'use client';

import React, { useEffect, useState } from 'react';
import type { UseCrdtDocAwareness } from '@/lib/collab/useCrdtDoc';

// ─── Colour palette ────────────────────────────────────────────────────────
// Curated 8-stop palette — visually distinct on both light & dark backgrounds,
// matches the rest of the collab UI (PresencePanel, ActivityFeed) by intent
// without depending on Tailwind theme tokens (the overlay is theme-agnostic).
export const CURSOR_PALETTE: readonly string[] = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
] as const;

/**
 * Deterministic 32-bit FNV-1a hash of a userId, projected into the
 * CURSOR_PALETTE. Same input → same colour, always. Exported for tests and
 * for callers that want to colour-match other UI (PresencePanel pill, etc.).
 */
export function colorForUserId(userId: string): string {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    // Force unsigned 32-bit math
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return CURSOR_PALETTE[h % CURSOR_PALETTE.length]!;
}

// ─── Cursor extraction ─────────────────────────────────────────────────────

interface CursorPoint {
  x: number;
  y: number;
}

function extractCursor(state: Record<string, unknown> | undefined): CursorPoint | null {
  if (!state) return null;
  const c = (state as { cursor?: unknown }).cursor;
  if (!c || typeof c !== 'object') return null;
  const cx = (c as { x?: unknown }).x;
  const cy = (c as { y?: unknown }).y;
  if (typeof cx !== 'number' || typeof cy !== 'number') return null;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return { x: cx, y: cy };
}

function extractName(state: Record<string, unknown> | undefined): string | undefined {
  const n = state?.name;
  return typeof n === 'string' && n.length > 0 ? n : undefined;
}

// ─── Component ─────────────────────────────────────────────────────────────

export interface CursorOverlayProps {
  /** Awareness snapshot from useCrdtDoc. We read `remoteStates` only — the
   *  local cursor is never rendered (you already know where your mouse is). */
  awareness: Pick<UseCrdtDocAwareness, 'remoteStates'>;
  /** Ref to the viewport element. Drives overlay positioning + sizing. */
  viewportRef: React.RefObject<HTMLElement | null>;
  /** Optional per-user colour override map. Takes precedence over the hash. */
  userColors?: Record<string, string>;
  /** Optional className escape hatch (rarely needed — overlay is fully
   *  absolute-positioned over the viewport). */
  className?: string;
}

interface OverlayBox {
  width: number;
  height: number;
}

/**
 * Track the viewport's intrinsic size so the SVG element matches. We use a
 * ResizeObserver when available (modern browsers + jsdom 21+) and fall back
 * to a single sync read on mount + a window resize listener otherwise.
 */
function useViewportBox(viewportRef: React.RefObject<HTMLElement | null>): OverlayBox {
  const [box, setBox] = useState<OverlayBox>({ width: 0, height: 0 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const measure = (): void => {
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        prev.width === r.width && prev.height === r.height
          ? prev
          : { width: r.width, height: r.height },
      );
    };
    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }
    const onResize = (): void => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [viewportRef]);

  return box;
}

/**
 * CursorOverlay — render one SVG marker per remote peer with a valid cursor.
 *
 * Peers without a cursor in their awareness state are silently skipped —
 * keeps the contract simple for callers that publish other presence fields
 * (selection, activeNodeId, …) without a cursor.
 */
export function CursorOverlay({
  awareness,
  viewportRef,
  userColors,
  className,
}: CursorOverlayProps): React.ReactElement {
  const { width, height } = useViewportBox(viewportRef);

  // Sort by userId for deterministic SVG element ordering — keeps test
  // assertions on render order stable and helps React keyed reconciliation.
  const peers = Object.entries(awareness.remoteStates)
    .map(([userId, state]) => {
      const cursor = extractCursor(state);
      if (!cursor) return null;
      return {
        userId,
        cursor,
        color: userColors?.[userId] ?? colorForUserId(userId),
        name: extractName(state),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  return (
    <svg
      data-testid="cursor-overlay"
      className={className}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: width || '100%',
        height: height || '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      width={width || undefined}
      height={height || undefined}
      aria-hidden="true"
    >
      {peers.map((p) => (
        <g
          key={p.userId}
          data-testid={`cursor-overlay-${p.userId}`}
          data-user-id={p.userId}
          data-color={p.color}
          transform={`translate(${p.cursor.x},${p.cursor.y})`}
        >
          {/* Arrow body — classic upward-pointing pointer silhouette */}
          <path
            d="M0,0 L0,16 L4,12 L7,18 L9,17 L6,11 L11,11 Z"
            fill={p.color}
            stroke="white"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          {p.name && (
            <g transform="translate(14, 4)">
              <rect
                x={0}
                y={0}
                width={Math.max(24, p.name.length * 7 + 8)}
                height={16}
                rx={3}
                ry={3}
                fill={p.color}
              />
              <text
                x={4}
                y={12}
                fontSize={11}
                fontFamily="system-ui, sans-serif"
                fill="white"
              >
                {p.name}
              </text>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

export default CursorOverlay;
