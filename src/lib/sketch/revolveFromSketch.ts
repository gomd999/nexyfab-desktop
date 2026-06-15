/**
 * revolveFromSketch — Phase 2.A UI bridge for revolve features.
 *
 * Sibling of extrudeFromSketch.ts. Bundles:
 *   - solverStateToProfile (Phase 2.A.1)
 *   - extractClosedLoops (Phase 2.1.1)
 *   - buildRevolveFromLoop + revolveToScad (Phase 2.2)
 *   - FeatureTree + replayTree (Phase 2.6.1)
 *
 * Used by the RevolveModal UI to turn the current sketch + an axis line +
 * a sweep angle into SCAD source ready for openscad rendering.
 *
 * Scope (Phase 2.A revolve-minimal):
 *   - Single closed loop (largest by area)
 *   - Caller supplies axis as AxisLine2D in sketch coordinates
 *   - 0 < angleDegrees ≤ 360
 *   - mode: 'add' | 'cut' (matches extrude UX)
 *
 * Out of scope (later):
 *   - Multi-loop revolve with hole detection
 *   - Auto-axis from a selected line in the sketch (UI passes that data in)
 *   - Helix sweep (different feature kind — see sweepLoft.ts)
 */

import { solverStateToProfile, type SolverViewState } from './solverToProfile';
import { extractClosedLoops, type ClosedLoop } from './sketchProfile';
import {
  buildRevolveFromLoop,
  type RevolveMode,
  type AxisLine2D,
} from '@/lib/cad/revolveProfile';
import { replayTree, type FeatureTree, type FeatureNode } from '@/lib/cad/featureTree';

export type RevolveFromSketchResult =
  | {
      ok: true;
      scad: string;
      loop: ClosedLoop;
      /** Lines from the sketch that didn't participate in the chosen loop. */
      danglingLines: ReadonlyArray<string>;
    }
  | {
      ok: false;
      error: string;
    };

export interface RevolveFromSketchOptions {
  axis: AxisLine2D;
  angleDegrees?: number; // default 360
  mode?: RevolveMode; // default 'add'
  featureName?: string;
}

export function revolveFromSketch(
  sketch: SolverViewState,
  opts: RevolveFromSketchOptions,
): RevolveFromSketchResult {
  // Validate axis up-front so we surface a clear UX error before extraction.
  if (!opts.axis || !opts.axis.a || !opts.axis.b) {
    return { ok: false, error: 'revolve axis is required (two 2D points)' };
  }
  const { a, b } = opts.axis;
  if (
    !Number.isFinite(a.x) || !Number.isFinite(a.y) ||
    !Number.isFinite(b.x) || !Number.isFinite(b.y)
  ) {
    return { ok: false, error: 'revolve axis coordinates must be finite numbers' };
  }
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) {
    return { ok: false, error: 'revolve axis points are coincident' };
  }

  const profileInput = solverStateToProfile(sketch);
  const extraction = extractClosedLoops(profileInput);
  if (extraction.loops.length === 0) {
    return {
      ok: false,
      error:
        extraction.danglingLines.length > 0
          ? `No closed loop found — ${extraction.danglingLines.length} dangling line(s). Connect the sketch into a closed profile first.`
          : 'No closed loop found — draw a closed profile first.',
    };
  }
  // Pick the largest-area loop (outer profile).
  const loop = [...extraction.loops].sort(
    (l1, l2) => Math.abs(l2.signedArea) - Math.abs(l1.signedArea),
  )[0]!;
  const pointById = new Map(profileInput.points.map((p) => [p.id, p]));

  let revolve;
  try {
    revolve = buildRevolveFromLoop(loop, pointById, {
      axis: opts.axis,
      angleDegrees: opts.angleDegrees,
      mode: opts.mode,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const node: FeatureNode = {
    id: 'revolve_1',
    name: opts.featureName ?? 'Revolve',
    dependencies: [],
    payload: revolve,
  };
  const tree: FeatureTree = { nodes: [node] };
  const result = replayTree(tree);
  return {
    ok: true,
    scad: result.scad,
    loop,
    danglingLines: extraction.danglingLines,
  };
}
