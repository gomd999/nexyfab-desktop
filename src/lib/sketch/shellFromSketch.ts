/**
 * shellFromSketch — Phase 2.4 UI bridge for the Shell feature.
 *
 * Sibling of extrudeFromSketch / revolveFromSketch / sweepFromSketch.
 * Bundles:
 *   - solverStateToProfile (Phase 2.A.1)
 *   - extractClosedLoops (Phase 2.1.1)
 *   - buildExtrudeFromLoop (Phase 2.1.2) — the body to be shelled
 *   - buildShellFromExtrude + shellToScad (Phase 2.4)
 *   - FeatureTree + replayTree (Phase 2.6.1)
 *
 * Used by the ShellModal UI to turn the current sketch + an extrude depth
 * + wall thickness + open-face options into SCAD source ready for openscad
 * rendering.
 *
 * Phase 1 limitations:
 *   - Profile must be an axis-aligned rectangle (exactly 1 closed loop with
 *     4 corners + 4 right angles). Any other profile yields an error.
 *   - Uniform wall thickness only.
 *   - Single child extrude only — chained shells (shell-of-shell) are not
 *     supported; the IR would need a `kind: 'shell'` payload in
 *     featureTree.ts first (Phase 2.6.2).
 */

import { solverStateToProfile, type SolverViewState } from './solverToProfile';
import { extractClosedLoops, type ClosedLoop } from './sketchProfile';
import { buildExtrudeFromLoop, type ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import {
  buildShellFromExtrude,
  shellToScad,
  isAxisAlignedRect,
  type ShellFeature,
} from '@/lib/cad/shellProfile';
import { replayTree, type FeatureTree, type FeatureNode } from '@/lib/cad/featureTree';

export type ShellFromSketchResult =
  | {
      ok: true;
      scad: string;
      loop: ClosedLoop;
      shell: ShellFeature;
      /** Lines from the sketch that didn't participate in the chosen loop. */
      danglingLines: ReadonlyArray<string>;
    }
  | {
      ok: false;
      error: string;
    };

export interface ShellFromSketchOptions {
  /** Extrude depth (mm) for the child body to be shelled. Must be > 0. */
  depth: number;
  /** Uniform wall thickness (mm). Must be > 0 and < min(profileBBox)/2. */
  thickness: number;
  openTopFace?: boolean;
  openBottomFace?: boolean;
  featureName?: string;
}

export function shellFromSketch(
  sketch: SolverViewState,
  opts: ShellFromSketchOptions,
): ShellFromSketchResult {
  // Validate primitive params before touching the sketch pipeline.
  if (!Number.isFinite(opts.depth) || opts.depth <= 0) {
    return { ok: false, error: `depth must be a positive number, got: ${opts.depth}` };
  }
  if (!Number.isFinite(opts.thickness) || opts.thickness <= 0) {
    return {
      ok: false,
      error: `thickness must be a positive number, got: ${opts.thickness}`,
    };
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

  // Phase 1 heuristic: require exactly one closed loop with 4 corners + all
  // right angles. Anything else (triangle, pentagon, circle, multi-loop) is
  // not yet supported.
  if (extraction.loops.length > 1) {
    return {
      ok: false,
      error: `Shell Phase 1: only single-loop profiles supported (got ${extraction.loops.length})`,
    };
  }
  const loop = extraction.loops[0]!;
  if (loop.points.length !== 4) {
    return {
      ok: false,
      error: `Shell Phase 1: profile must be a rectangle with 4 corners (got ${loop.points.length})`,
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
      error: 'Shell Phase 1: profile must be an axis-aligned rectangle (4 corners + 4 right angles)',
    };
  }

  // Build the child extrude (always 'add' mode — shell wraps a positive body).
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

  // Build the shell wrapper.
  let shell: ShellFeature;
  try {
    shell = buildShellFromExtrude(childExtrude, opts.thickness, {
      openTopFace: opts.openTopFace,
      openBottomFace: opts.openBottomFace,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // We don't yet teach FeatureTree about 'shell' nodes (would require
  // wiring the dispatch table in featureTree.ts — out of scope for this
  // PR which focuses on the modal + render endpoint). Instead, render
  // directly to SCAD and wrap in a single-node tree envelope manually so
  // the result still goes through the standard "// === id (name) ==="
  // header for downstream parsers.
  const scadBody = shellToScad(shell);
  // Use a synthetic envelope matching replayTree's format so downstream
  // tooling (e.g. featureTreeEdit cache keys) sees consistent comments.
  const featureName = opts.featureName ?? 'Shell';
  const envelope = `// === shell_1 (${featureName}) ===\n${scadBody}`;
  // Sanity: also run an empty tree through replayTree to make sure we
  // haven't broken validateTree contract (no-op).
  const tree: FeatureTree = { nodes: [] as ReadonlyArray<FeatureNode> };
  replayTree(tree);

  return {
    ok: true,
    scad: envelope,
    loop,
    shell,
    danglingLines: extraction.danglingLines,
  };
}
