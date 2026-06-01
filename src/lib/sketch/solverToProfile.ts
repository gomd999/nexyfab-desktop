/**
 * solverToProfile — Phase 2.A UI bridge.
 *
 * Converts a SolverSketchEditor's view-entity state into a ProfileInput
 * suitable for `extractClosedLoops`. This is the missing piece that lets
 * the UI take a user-drawn sketch and pipe it through Phase 2.1 extrude
 * IR + Phase 2.6.1 FeatureTree replay → SCAD source → openscad render.
 *
 * Scope (Phase 2.A.1 minimal):
 *   - Plain points + lines extraction (no circles/arcs — those need
 *     decomposition into polyline segments for the polygon-based extrude
 *     IR; Phase 2.A.2 adds that).
 *   - Resolves PointId/LineId opaque types into plain string ids for the
 *     downstream profile module.
 *
 * Out of scope (Phase 2.A.2+):
 *   - Circle/arc → polyline approximation (segment count from
 *     view-zoom level + tolerance)
 *   - Multiple sketch profiles in a single extract (multi-body)
 *   - Sketch-on-face (Phase 1.4 SketchPlane integration)
 */

import type { ProfileInput, ProfilePoint, ProfileLine } from './sketchProfile';

// ─── input types (mirror SolverSketchEditor's view model) ────────────────

export interface SolverViewPoint {
  id: string;
  x: number;
  y: number;
}

export interface SolverViewLine {
  id: string;
  p1: string;
  p2: string;
}

export interface SolverViewState {
  points: ReadonlyArray<SolverViewPoint>;
  lines: ReadonlyArray<SolverViewLine>;
}

// ─── conversion ──────────────────────────────────────────────────────────

export function solverStateToProfile(state: SolverViewState): ProfileInput {
  const points: ProfilePoint[] = state.points.map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
  }));
  const lines: ProfileLine[] = state.lines.map((l) => ({
    id: l.id,
    p1: l.p1,
    p2: l.p2,
  }));
  return { points, lines };
}
