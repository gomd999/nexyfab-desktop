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
import type { SnapTarget } from '@/lib/sketch/sketchSnap';

export interface SketchSnapIndicatorProps {
  snap: SnapTarget | null;
  /** Marker size in SVG units. Default 6. */
  size?: number;
}

const COLORS = {
  grid: '#6b7280',           // grey-500
  point: '#06b6d4',          // cyan-500
  line_endpoint: '#f97316',  // orange-500
  line_midpoint: '#eab308',  // yellow-500
  circle_center: '#d946ef',  // fuchsia-500
  intersection: '#ef4444',   // red-500
} as const;

const SketchSnapIndicator: React.FC<SketchSnapIndicatorProps> = ({
  snap,
  size = 6,
}) => {
  if (!snap) return null;

  const { pos, kind } = snap;
  const color = COLORS[kind];
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
    default:
      marker = null;
  }

  return (
    <g data-testid="snap-indicator" pointerEvents="none">
      {marker}
    </g>
  );
};

export default SketchSnapIndicator;
