/**
 * extrudeFromSketch — Phase 2.A.2 UI bridge.
 *
 * High-level "give me SCAD source for this sketch + extrude depth" helper.
 * Bundles together:
 *   - solverStateToProfile (Phase 2.A.1)
 *   - extractClosedLoops (Phase 2.1.1)
 *   - buildExtrudeFromLoop (Phase 2.1.2)
 *   - FeatureTree + replayTree (Phase 2.6.1)
 *
 * Used by SolverSketchEditor's "Extrude" button — one call produces the
 * SCAD string the user can preview, copy, or send to the render endpoint.
 *
 * Scope (Phase 2.A.2 minimal):
 *   - Single closed loop (uses the largest-area loop if multiple).
 *   - Returns ExtrudeResult { ok, scad, loop, danglingLines } or
 *     { ok: false, error }.
 *
 * Out of scope (Phase 2.A.3+):
 *   - Multi-loop extrude with auto hole detection
 *   - Render call (separate UI concern — caller decides server vs WASM)
 *   - Sketch-on-3D-face (lift the 2D SCAD into the part's plane)
 */

import { solverStateToProfile, type SolverViewState } from './solverToProfile';
import { extractClosedLoops, type ClosedLoop } from './sketchProfile';
import { buildExtrudeFromLoop, type ExtrudeMode, type ExtrudeDirection } from '@/lib/cad/extrudeProfile';
import { replayTree, type FeatureTree, type FeatureNode } from '@/lib/cad/featureTree';

export type ExtrudeFromSketchResult =
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

export interface ExtrudeFromSketchOptions {
  depth: number;
  draftDegrees?: number;
  direction?: ExtrudeDirection;
  mode?: ExtrudeMode;
  featureName?: string;
}

export function extrudeFromSketch(
  sketch: SolverViewState,
  opts: ExtrudeFromSketchOptions,
): ExtrudeFromSketchResult {
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
    (a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea),
  )[0]!;
  const pointById = new Map(profileInput.points.map((p) => [p.id, p]));
  let extrude;
  try {
    extrude = buildExtrudeFromLoop(loop, pointById, {
      depth: opts.depth,
      draftDegrees: opts.draftDegrees,
      direction: opts.direction,
      mode: opts.mode,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const node: FeatureNode = {
    id: 'extrude_1',
    name: opts.featureName ?? 'Extrude',
    dependencies: [],
    payload: extrude,
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
