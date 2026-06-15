'use client';

/**
 * SheetSnapIndicator — Phase 4.7 cursor snap marker for the drawing page.
 *
 * Standalone, presentational SVG marker that visualises the snap target
 * returned by `findSheetSnapTarget` from `@/lib/drawing/sheetSnap`. The
 * indicator is rendered as an inline `<svg>` positioned absolutely over
 * the drawing canvas — the host page is responsible for placing this
 * component such that its origin matches the snap's screen-space pixel
 * coordinates. Props carry the snap target (or null) plus the screen
 * pixel position; we never re-resolve the snap here.
 *
 * Design intent:
 *   - One indicator shape per snap kind (visual disambiguation for
 *     dimension placement: corner ≠ midpoint ≠ center ≠ grid).
 *   - DOM-free helper: no React state, no effects.
 *   - When `snap` is null the component returns `null` so the host
 *     doesn't have to gate the mount.
 *
 * Colour + shape language (matches sketch-snap conventions):
 *   - viewport_corner    → square,   crimson  (#dc2626)
 *   - viewport_midpoint  → triangle, amber    (#d97706)
 *   - viewport_center    → cross/plus, teal   (#0891b2)
 *   - grid               → circle,   slate    (#475569)
 */

import * as React from 'react';
import type { SheetSnapTarget, SheetSnapKind } from '@/lib/drawing/sheetSnap';

// ─── props ───────────────────────────────────────────────────────────────

export interface SheetSnapIndicatorProps {
  /** Snap target to draw, or null to render nothing. */
  snap: SheetSnapTarget | null;
  /**
   * Screen-space pixel position where the marker should be drawn. Provided
   * by the host because converting sheet-mm → screen-px requires knowledge
   * of the current SVG transform that this component does not have.
   */
  screenPos?: { x: number; y: number };
}

// ─── visual constants ────────────────────────────────────────────────────

const KIND_COLOR: Record<SheetSnapKind, string> = {
  viewport_corner:   '#dc2626', // crimson
  viewport_midpoint: '#d97706', // amber
  viewport_center:   '#0891b2', // teal
  grid:              '#475569', // slate
};

const MARKER_SIZE = 14;
const STROKE_WIDTH = 2;
const HALF = MARKER_SIZE / 2;

// ─── shape renderers (one per kind) ──────────────────────────────────────

function CornerMarker({ color }: { color: string }): React.ReactElement {
  // Hollow square.
  return (
    <rect
      data-testid="sheet-snap-marker-shape"
      x={-HALF}
      y={-HALF}
      width={MARKER_SIZE}
      height={MARKER_SIZE}
      fill="none"
      stroke={color}
      strokeWidth={STROKE_WIDTH}
    />
  );
}

function MidpointMarker({ color }: { color: string }): React.ReactElement {
  // Upward-pointing triangle.
  const points = `0,${-HALF} ${HALF},${HALF} ${-HALF},${HALF}`;
  return (
    <polygon
      data-testid="sheet-snap-marker-shape"
      points={points}
      fill="none"
      stroke={color}
      strokeWidth={STROKE_WIDTH}
    />
  );
}

function CenterMarker({ color }: { color: string }): React.ReactElement {
  // Plus sign (two strokes).
  return (
    <g data-testid="sheet-snap-marker-shape">
      <line
        x1={-HALF}
        y1={0}
        x2={HALF}
        y2={0}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
      <line
        x1={0}
        y1={-HALF}
        x2={0}
        y2={HALF}
        stroke={color}
        strokeWidth={STROKE_WIDTH}
      />
    </g>
  );
}

function GridMarker({ color }: { color: string }): React.ReactElement {
  // Hollow circle.
  return (
    <circle
      data-testid="sheet-snap-marker-shape"
      cx={0}
      cy={0}
      r={HALF - 1}
      fill="none"
      stroke={color}
      strokeWidth={STROKE_WIDTH}
    />
  );
}

function renderShape(kind: SheetSnapKind, color: string): React.ReactElement {
  switch (kind) {
    case 'viewport_corner':   return <CornerMarker color={color} />;
    case 'viewport_midpoint': return <MidpointMarker color={color} />;
    case 'viewport_center':   return <CenterMarker color={color} />;
    case 'grid':              return <GridMarker color={color} />;
  }
}

// ─── component ───────────────────────────────────────────────────────────

export function SheetSnapIndicator({
  snap,
  screenPos,
}: SheetSnapIndicatorProps): React.ReactElement | null {
  if (!snap) return null;
  const color = KIND_COLOR[snap.kind];
  // Pixel position defaults to (0,0) so a host that hasn't computed a
  // screen mapping yet still mounts a visible marker for tests.
  const px = screenPos?.x ?? 0;
  const py = screenPos?.y ?? 0;
  return (
    <svg
      data-testid="sheet-snap-indicator"
      data-snap-kind={snap.kind}
      data-snap-pos-x={snap.pos.x}
      data-snap-pos-y={snap.pos.y}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: px - HALF - STROKE_WIDTH,
        top: py - HALF - STROKE_WIDTH,
        width: MARKER_SIZE + STROKE_WIDTH * 2,
        height: MARKER_SIZE + STROKE_WIDTH * 2,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      viewBox={`${-HALF - STROKE_WIDTH} ${-HALF - STROKE_WIDTH} ${MARKER_SIZE + STROKE_WIDTH * 2} ${MARKER_SIZE + STROKE_WIDTH * 2}`}
    >
      {renderShape(snap.kind, color)}
    </svg>
  );
}

export default SheetSnapIndicator;
