/**
 * chamferFromSketch — Phase 2.2 UI bridge for the Chamfer feature.
 *
 * Mirror of filletFromSketch.ts. Same shape, just builds a ChamferFeature
 * (45° beveled edges) instead of a rounded FilletFeature.
 *
 * Phase 1 limitations:
 *   - Profile must be an axis-aligned rectangle.
 *   - Uniform 45° chamfer only (no asymmetric distance/angle).
 *   - Single child extrude only.
 */

import { solverStateToProfile, type SolverViewState } from './solverToProfile';
import { extractClosedLoops, type ClosedLoop } from './sketchProfile';
import { buildExtrudeFromLoop, type ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import {
  buildChamferFeature,
  chamferToScad,
  type ChamferEdgeSelection,
  type ChamferFeature,
} from '@/lib/cad/chamferProfile';
import { isAxisAlignedRect } from '@/lib/cad/shellProfile';
import { replayTree, type FeatureTree, type FeatureNode } from '@/lib/cad/featureTree';

export type ChamferFromSketchResult =
  | {
      ok: true;
      scad: string;
      loop: ClosedLoop;
      chamfer: ChamferFeature;
      danglingLines: ReadonlyArray<string>;
    }
  | {
      ok: false;
      error: string;
    };

export interface ChamferFromSketchOptions {
  /** Extrude depth (mm) for the child body to be chamfered. Must be > 0. */
  depth: number;
  /** Uniform chamfer setback distance (mm). Must be > 0 and
   *  < min(profileBBox)/2; for top/bottom edge selections also < depth/2. */
  distance: number;
  edgeSelection: ChamferEdgeSelection;
  featureName?: string;
}

export function chamferFromSketch(
  sketch: SolverViewState,
  opts: ChamferFromSketchOptions,
): ChamferFromSketchResult {
  if (!Number.isFinite(opts.depth) || opts.depth <= 0) {
    return { ok: false, error: `depth must be a positive number, got: ${opts.depth}` };
  }
  if (!Number.isFinite(opts.distance) || opts.distance <= 0) {
    return { ok: false, error: `distance must be a positive number, got: ${opts.distance}` };
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
      error: `Chamfer Phase 1: only single-loop profiles supported (got ${extraction.loops.length})`,
    };
  }
  const loop = extraction.loops[0]!;
  if (loop.points.length !== 4) {
    return {
      ok: false,
      error: `Chamfer Phase 1: profile must be a rectangle with 4 corners (got ${loop.points.length})`,
    };
  }
  const pointById = new Map(profileInput.points.map((p) => [p.id, p]));
  const loopXY = loop.points.map((id) => {
    const p = pointById.get(id)!;
    return { x: p.x, y: p.y };
  });
  if (!isAxisAlignedRect(loopXY)) {
    return {
      ok: false,
      error:
        'Chamfer Phase 1: profile must be an axis-aligned rectangle (4 corners + 4 right angles)',
    };
  }

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

  let chamfer: ChamferFeature;
  try {
    chamfer = buildChamferFeature(childExtrude, opts.distance, opts.edgeSelection);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const scadBody = chamferToScad(chamfer);
  const featureName = opts.featureName ?? 'Chamfer';
  const envelope = `// === chamfer_1 (${featureName}) ===\n${scadBody}`;
  const tree: FeatureTree = { nodes: [] as ReadonlyArray<FeatureNode> };
  replayTree(tree);

  return {
    ok: true,
    scad: envelope,
    loop,
    chamfer,
    danglingLines: extraction.danglingLines,
  };
}
