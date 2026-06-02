/**
 * filletFromSketch — Phase 2.2 UI bridge for the Fillet feature.
 *
 * Sibling of shellFromSketch / extrudeFromSketch / revolveFromSketch.
 * Bundles:
 *   - solverStateToProfile (Phase 2.A.1)
 *   - extractClosedLoops (Phase 2.1.1)
 *   - buildExtrudeFromLoop (Phase 2.1.2) — the body to be filleted
 *   - buildFilletFeature + filletToScad (Phase 2.2)
 *   - FeatureTree + replayTree (Phase 2.6.1) sanity probe
 *
 * Used by the FilletModal UI to turn the current sketch + an extrude depth
 * + radius + edge selection into SCAD source ready for openscad rendering.
 *
 * Phase 2 scope:
 *   - Profile may be any convex N-vertex polygon (≥ 3 vertices). Axis-
 *     aligned rectangles take the original Phase 1 cube-based fast path
 *     in the IR; everything else uses the inward-offset Minkowski trick.
 *   - Concave or self-intersecting profiles are rejected with a clear
 *     error message bubbled from the IR builder.
 *   - Uniform radius only.
 *   - Single child extrude only — chained fillets (fillet-of-fillet) are
 *     not exposed in the wizard yet.
 */

import { solverStateToProfile, type SolverViewState } from './solverToProfile';
import { extractClosedLoops, type ClosedLoop } from './sketchProfile';
import { buildExtrudeFromLoop, type ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import {
  buildFilletFeature,
  filletToScad,
  type FilletEdgeSelection,
  type FilletFeature,
} from '@/lib/cad/filletProfile';
import { replayTree, type FeatureTree, type FeatureNode } from '@/lib/cad/featureTree';

export type FilletFromSketchResult =
  | {
      ok: true;
      scad: string;
      loop: ClosedLoop;
      fillet: FilletFeature;
      /** Lines from the sketch that didn't participate in the chosen loop. */
      danglingLines: ReadonlyArray<string>;
    }
  | {
      ok: false;
      error: string;
    };

export interface FilletFromSketchOptions {
  /** Extrude depth (mm) for the child body to be filleted. Must be > 0. */
  depth: number;
  /** Uniform fillet radius (mm). Must be > 0 and < min(profileBBox)/2;
   *  for top/bottom edge selections also < depth/2. */
  radius: number;
  edgeSelection: FilletEdgeSelection;
  featureName?: string;
}

export function filletFromSketch(
  sketch: SolverViewState,
  opts: FilletFromSketchOptions,
): FilletFromSketchResult {
  if (!Number.isFinite(opts.depth) || opts.depth <= 0) {
    return { ok: false, error: `depth must be a positive number, got: ${opts.depth}` };
  }
  if (!Number.isFinite(opts.radius) || opts.radius <= 0) {
    return { ok: false, error: `radius must be a positive number, got: ${opts.radius}` };
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
  if (extraction.loops.length > 1) {
    return {
      ok: false,
      error: `Fillet Phase 1: only single-loop profiles supported (got ${extraction.loops.length})`,
    };
  }
  const loop = extraction.loops[0]!;
  if (loop.points.length < 3) {
    return {
      ok: false,
      error: `Fillet: profile must have at least 3 vertices (got ${loop.points.length})`,
    };
  }
  const pointById = new Map(profileInput.points.map((p) => [p.id, p]));

  let childExtrude: ExtrudeFeature;
  try {
    childExtrude = buildExtrudeFromLoop(loop, pointById, {
      depth: opts.depth,
      direction: 'one_sided',
      mode: 'add',
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let fillet: FilletFeature;
  try {
    fillet = buildFilletFeature(childExtrude, opts.radius, opts.edgeSelection);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const scadBody = filletToScad(fillet);
  const featureName = opts.featureName ?? 'Fillet';
  const envelope = `// === fillet_1 (${featureName}) ===\n${scadBody}`;
  // Probe replayTree (no-op) so we surface any contract drift early.
  const tree: FeatureTree = { nodes: [] as ReadonlyArray<FeatureNode> };
  replayTree(tree);

  return {
    ok: true,
    scad: envelope,
    loop,
    fillet,
    danglingLines: extraction.danglingLines,
  };
}
