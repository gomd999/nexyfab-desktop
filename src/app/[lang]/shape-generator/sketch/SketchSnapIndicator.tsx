'use client';

/**
 * SketchSnapIndicator — Phase 1.4 sketch UX (ADR-013, own pro-CAD).
 *
 * Tiny SVG marker that surfaces the active snap target while the user
 * is hovering with a drawing tool (point/line/circle/arc). Drawn as a
 * sibling group inside the host <svg>; the host (SolverSketchEditor or
 * a snap wrapper) is responsible for computing the target via
 * `findSnapTarget` and feeding it in via the `snap` prop.
 *
 * Standalone-by-design:
 *   - No solver, no sketchSnap import (props-only, decoupled).
 *   - Renders `null` when `snap` is null (zero DOM footprint when idle).
 *
 * Per-kind marker (radius defaults to 6):
 *   - grid          → grey "+"  (small crosshair)
 *   - point         → cyan filled circle ring
 *   - line_endpoint → orange square
 *   - line_midpoint → yellow triangle
 *   - circle_center → magenta diamond + dot
 *   - intersection  → red "×"
 *
 * Test surface (data-testids):
 *   snap-indicator                    (root group; absent when snap=null)
 *   snap-indicator-{kind}             (per-kind marker; one of:
 *                                       grid / point / line_endpoint /
 *                                       line_midpoint / circle_center /
 *                                       intersection)
 */

import React from 'react';
import type { SnapTarget, SnapKind } from '@/lib/sketch/sketchSnap';

export interface SketchSnapIndicatorProps {
  snap: SnapTarget | null;
  /** Marker size in SVG units. Default 6. */
  size?: number;
}

// COLORS table covers every SnapKind. Phase 1 kinds (grid / point /
// line_endpoint / line_midpoint / circle_center / intersection) keep
// their original swatches; Phase 2 kinds get a coherent palette:
//   arc_*               → warm family (orange/blue/yellow/amber/neutral) so
//                         arc snaps read as a single "arc" group while still
//                         distinguishing endpoint vs center vs quadrant vs
//                         midpoint vs nearest-on-arc;
//   line_perpendicular  → pink-500   (paired with cyan point, pops against
//                                     dark line strokes)
//   circle_perpendicular→ fuchsia-500 (matches circle_center hue family —
//                                      both belong to the "circle" group)
// Partial<Record<SnapKind, string>> keeps indexing type-safe; any future
// kind without an entry falls back to FALLBACK_COLOR rather than crashing.
const COLORS: Partial<Record<SnapKind, string>> = {
  grid: '#6b7280',                // grey-500
  point: '#06b6d4',               // cyan-500
  line_endpoint: '#f97316',       // orange-500
  line_midpoint: '#eab308',       // yellow-500
  circle_center: '#d946ef',       // fuchsia-500
  intersection: '#ef4444',        // red-500
  // ── Phase 2 ──
  arc_endpoint: '#fb923c',        // orange-400 (echoes line_endpoint, lighter)
  arc_center: '#60a5fa',          // blue-400   (cool, distinct from circle_center)
  arc_quadrant: '#facc15',        // yellow-400 (cardinal points stand out)
  arc_midpoint: '#fbbf24',        // amber-400  (between yellow & orange — midpoint)
  arc_nearest: '#a3a3a3',         // neutral-400 (low-priority fallback)
  line_perpendicular: '#ec4899',  // pink-500
  circle_perpendicular: '#d946ef',// fuchsia-500
};

// Defensive default for any future SnapKind that lands before its colour
// is mapped above — keeps the indicator visible (slate-400) rather than
// silently invisible. Phase 1 + Phase 2 kinds all have explicit entries.
const FALLBACK_COLOR = '#94a3b8'; // slate-400

const SketchSnapIndicator: React.FC<SketchSnapIndicatorProps> = ({
  snap,
  size = 6,
}) => {
  if (!snap) return null;

  const { pos, kind } = snap;
  const color = COLORS[kind] ?? FALLBACK_COLOR;
  const r = size;

  let marker: React.ReactNode;
  switch (kind) {
    case 'grid':
      // Small "+" crosshair.
      marker = (
        <g data-testid={`snap-indicator-${kind}`} stroke={color} strokeWidth={1.25}>
          <line x1={pos.x - r} y1={pos.y} x2={pos.x + r} y2={pos.y} />
          <line x1={pos.x} y1={pos.y - r} x2={pos.x} y2={pos.y + r} />
        </g>
      );
      break;
    case 'point':
      // Filled circle ring (hollow with thick stroke).
      marker = (
        <g data-testid={`snap-indicator-${kind}`}>
          <circle
            cx={pos.x}
            cy={pos.y}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
        </g>
      );
      break;
    case 'line_endpoint':
      // Square outline.
      marker = (
        <g data-testid={`snap-indicator-${kind}`}>
          <rect
            x={pos.x - r}
            y={pos.y - r}
            width={r * 2}
            height={r * 2}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
        </g>
      );
      break;
    case 'line_midpoint': {
      // Equilateral triangle (point up).
      const h = r * Math.sqrt(3);
      const points = [
        `${pos.x},${pos.y - (2 / 3) * h}`,
        `${pos.x - r},${pos.y + (1 / 3) * h}`,
        `${pos.x + r},${pos.y + (1 / 3) * h}`,
      ].join(' ');
      marker = (
        <g data-testid={`snap-indicator-${kind}`}>
          <polygon
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
        </g>
      );
      break;
    }
    case 'circle_center': {
      // Diamond outline + center dot.
      const points = [
        `${pos.x},${pos.y - r}`,
        `${pos.x + r},${pos.y}`,
        `${pos.x},${pos.y + r}`,
        `${pos.x - r},${pos.y}`,
      ].join(' ');
      marker = (
        <g data-testid={`snap-indicator-${kind}`}>
          <polygon
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
          <circle cx={pos.x} cy={pos.y} r={1.5} fill={color} />
        </g>
      );
      break;
    }
    case 'intersection':
      // "×" cross mark.
      marker = (
        <g data-testid={`snap-indicator-${kind}`} stroke={color} strokeWidth={2}>
          <line x1={pos.x - r} y1={pos.y - r} x2={pos.x + r} y2={pos.y + r} />
          <line x1={pos.x - r} y1={pos.y + r} x2={pos.x + r} y2={pos.y - r} />
        </g>
      );
      break;
    default: {
      // Phase 2 kinds (arc_endpoint / arc_center / arc_quadrant /
      // arc_midpoint / arc_nearest / line_perpendicular /
      // circle_perpendicular) — same dispatcher, dedicated colors from
      // COLORS so the testid + colour assertion suffices for visual diff.
      // Generic marker: thin ring around `pos` (low visual weight so the
      // Phase 2 family doesn't dominate the canvas) with a centre dot for
      // perpendicular-foot kinds (which sit *on* a curve and need a
      // pinpoint anchor). The data-testid contract `snap-indicator-{kind}`
      // is preserved for every kind so the host editor's visual regression
      // assertions stay 1:1 with the SnapKind union.
      const isPerp = kind === 'line_perpendicular' || kind === 'circle_perpendicular';
      marker = (
        <g data-testid={`snap-indicator-${kind}`}>
          <circle
            cx={pos.x}
            cy={pos.y}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={isPerp ? '2 2' : undefined}
          />
          <circle cx={pos.x} cy={pos.y} r={1.25} fill={color} />
        </g>
      );
      break;
    }
  }

  return (
    <g data-testid="snap-indicator" pointerEvents="none">
      {marker}
    </g>
  );
};

export default SketchSnapIndicator;
