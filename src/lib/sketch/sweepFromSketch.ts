/**
 * sweepFromSketch — Phase 2.2 UI bridge for sweep features.
 *
 * Sibling of revolveFromSketch.ts / extrudeFromSketch.ts. Bundles:
 *   - solverStateToProfile (Phase 2.A.1)
 *   - extractClosedLoops (Phase 2.1.1)
 *   - buildSweep + sweepToScad (Phase 2.2)
 *   - FeatureTree + replayTree (Phase 2.6.1)
 *
 * Used by the SweepModal UI to turn the current sketch + a polyline path
 * in 3D world space + a mode flag into SCAD source ready for openscad
 * rendering.
 *
 * Scope (Phase 2.2 sweep-minimal):
 *   - Single closed loop (largest by area)
 *   - Caller supplies a 3D polyline path (>=2 points, no zero-length segments)
 *   - mode: 'add' | 'cut' (matches extrude / revolve UX)
 *
 * Out of scope (Phase 2.x+):
 *   - Multi-loop sweep with hole detection
 *   - Sweep with twist / guide rails / centerline
 *   - Helix sweep (separate IR — different generator)
 */

import { solverStateToProfile, type SolverViewState } from './solverToProfile';
import { extractClosedLoops, type ClosedLoop } from './sketchProfile';
import { buildSweep, type SweepLoftMode } from '@/lib/cad/sweepLoft';
import { replayTree, type FeatureTree, type FeatureNode } from '@/lib/cad/featureTree';

export type SweepPathPoint = { x: number; y: number; z: number };

export type SweepFromSketchResult =
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

export interface SweepFromSketchOptions {
  path: ReadonlyArray<SweepPathPoint>;
  mode?: SweepLoftMode;
  featureName?: string;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function sweepFromSketch(
  sketch: SolverViewState,
  opts: SweepFromSketchOptions,
): SweepFromSketchResult {
  // Validate path up-front so we surface a clear UX error before extraction.
  if (!opts.path || !Array.isArray(opts.path)) {
    return { ok: false, error: 'sweep path is required (array of {x,y,z})' };
  }
  if (opts.path.length < 2) {
    return { ok: false, error: 'sweep path must have at least 2 points' };
  }
  for (let i = 0; i < opts.path.length; i++) {
    const p = opts.path[i]!;
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
      return { ok: false, error: `sweep path point ${i} must have finite x,y,z` };
    }
  }
  for (let i = 1; i < opts.path.length; i++) {
    const a = opts.path[i - 1]!;
    const b = opts.path[i]!;
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 1e-9) {
      return { ok: false, error: `sweep path segment ${i - 1}→${i} is zero-length` };
    }
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

  let sweep;
  try {
    sweep = buildSweep({
      profileLoop: loop,
      profilePoints: pointById,
      path: opts.path,
      mode: opts.mode,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const node: FeatureNode = {
    id: 'sweep_1',
    name: opts.featureName ?? 'Sweep',
    dependencies: [],
    payload: sweep,
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
