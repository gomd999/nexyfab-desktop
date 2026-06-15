/**
 * holesFromSketch — Phase 2.7 UI bridge for the Hole wizard.
 *
 * Sibling of extrudeFromSketch / revolveFromSketch / sweepFromSketch.
 * Differs in shape: a hole isn't a standalone body — it's a `difference()`
 * against a parent solid. The wizard supplies:
 *   - the current SolverViewState (sketch with the closed outer profile)
 *   - an extrudeDepth (parent body thickness)
 *   - an array of hole requests, each anchored to a sketch point id
 *
 * The pipeline:
 *   1. Build the parent extrude feature (same path as extrudeFromSketch).
 *   2. For each hole, resolve the (x,y) center from `pointId`, build a
 *      HoleFeature, validate dimensions.
 *   3. Compose SCAD: wrap the parent body in `difference()`, then drop
 *      the parent extrude body and each hole cut inside.
 *   4. Wrap in a FeatureTree (parent extrude as node 1; each hole as a
 *      subsequent node with the parent as its dependency) so the
 *      featureTree replay envelope (per-node SCAD breakdown, suppress
 *      semantics) stays consistent across all Phase 2.x features.
 *
 * Scope (Phase 2.7 minimal):
 *   - Holes drill from the parent's top face (+Z direction) downward.
 *   - Single parent extrude; no multi-body assemblies yet.
 *   - At least 1 hole required (matches the wizard UX: a hole modal with
 *     no holes makes no sense, the parent extrude itself is reachable
 *     from the Extrude modal).
 *
 * Out of scope (Phase 2.7.x+):
 *   - Sketch-on-face: holes always drilled from z=parent.depth toward z=0.
 *   - Through-hole detection vs. blind-hole metadata.
 *   - Pattern (linear / circular) of holes — Phase 2.4 pattern feature can
 *     wrap the hole IR once cross-IR pattern lands.
 */

import { solverStateToProfile, type SolverViewState } from './solverToProfile';
import { extractClosedLoops, type ClosedLoop } from './sketchProfile';
import { buildExtrudeFromLoop, extrudeToScad } from '@/lib/cad/extrudeProfile';
import {
  buildHoleFeature,
  holeToScad,
  type HoleType,
} from '@/lib/cad/holeProfile';
import {
  replayTree,
  type FeatureTree,
  type FeatureNode,
} from '@/lib/cad/featureTree';

export interface HoleRequest {
  /** Sketch point id (must appear in sketch.points). */
  pointId: string;
  holeType: HoleType;
  diameter: number;
  depth: number;
  counterboreDiameter?: number;
  counterboreDepth?: number;
  countersinkAngleDegrees?: number;
  countersinkDepth?: number;
}

export interface HolesFromSketchOptions {
  extrudeDepth: number;
  holes: ReadonlyArray<HoleRequest>;
  featureName?: string;
}

export type HolesFromSketchResult =
  | {
      ok: true;
      scad: string;
      loop: ClosedLoop;
      /** Lines from the sketch that didn't participate in the outer loop. */
      danglingLines: ReadonlyArray<string>;
      /** Per-hole resolved IRs — useful for the wizard to echo dimensions. */
      holeCount: number;
    }
  | {
      ok: false;
      error: string;
    };

export function holesFromSketch(
  sketch: SolverViewState,
  opts: HolesFromSketchOptions,
): HolesFromSketchResult {
  if (!Number.isFinite(opts.extrudeDepth) || opts.extrudeDepth <= 0) {
    return { ok: false, error: `extrudeDepth must be positive, got: ${opts.extrudeDepth}` };
  }
  if (!opts.holes || !Array.isArray(opts.holes) || opts.holes.length === 0) {
    return { ok: false, error: 'at least 1 hole is required' };
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
  const loop = [...extraction.loops].sort(
    (a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea),
  )[0]!;
  const pointById = new Map(profileInput.points.map((p) => [p.id, p]));

  // Build parent extrude (always mode='add' here — holes subtract from it).
  let parentExtrude;
  try {
    parentExtrude = buildExtrudeFromLoop(loop, pointById, {
      depth: opts.extrudeDepth,
      mode: 'add',
      direction: 'one_sided',
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Resolve every hole's center from the sketch points + validate.
  const holeFeatures: ReturnType<typeof buildHoleFeature>[] = [];
  for (let i = 0; i < opts.holes.length; i++) {
    const h = opts.holes[i]!;
    const center = pointById.get(h.pointId);
    if (!center) {
      return { ok: false, error: `hole ${i + 1}: sketch point '${h.pointId}' not found` };
    }
    try {
      holeFeatures.push(
        buildHoleFeature({
          center: { x: center.x, y: center.y },
          holeType: h.holeType,
          diameter: h.diameter,
          depth: h.depth,
          counterboreDiameter: h.counterboreDiameter,
          counterboreDepth: h.counterboreDepth,
          countersinkAngleDegrees: h.countersinkAngleDegrees,
          countersinkDepth: h.countersinkDepth,
        }),
      );
    } catch (e) {
      return {
        ok: false,
        error: `hole ${i + 1}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // Build the FeatureTree envelope. Parent extrude is node 1; each hole is
  // a subsequent node with the parent as its dependency. Per-node SCAD is
  // emitted by replayTree but for the host openscad pipeline we *also*
  // compose a single difference() block so the rendered geometry actually
  // subtracts the holes from the parent. The replay output is kept as
  // structural metadata; the rendered SCAD is the difference() block.
  const parentNode: FeatureNode = {
    id: 'extrude_parent',
    name: opts.featureName ?? 'Parent body',
    dependencies: [],
    payload: parentExtrude,
  };
  const holeNodes: FeatureNode[] = holeFeatures.map((feat, idx) => ({
    id: `hole_${idx + 1}`,
    name: `Hole ${idx + 1}`,
    dependencies: ['extrude_parent'],
    payload: feat,
  }));
  const tree: FeatureTree = { nodes: [parentNode, ...holeNodes] };
  // Validate the tree (catches any structural error before SCAD assembly).
  replayTree(tree);

  // Compose the rendered SCAD: difference() { parent; each hole; }.
  const parentBody = scadForParent(parentExtrude);
  const holeBodies = holeFeatures.map((h) => holeToScad(h));
  const indentedHoles = holeBodies
    .map((b) => indent(b, 2))
    .join('\n');
  const composed =
`// === ${parentNode.name} → minus ${holeNodes.length} hole(s) ===
difference() {
${indent(parentBody, 2)}
${indentedHoles}
}`;

  return {
    ok: true,
    scad: composed,
    loop,
    danglingLines: extraction.danglingLines,
    holeCount: holeFeatures.length,
  };
}

function indent(body: string, n: number): string {
  const pad = ' '.repeat(n);
  return body
    .split('\n')
    .map((line) => (line.length === 0 ? line : `${pad}${line}`))
    .join('\n');
}

// We re-emit the parent extrude SCAD via extrudeToScad — the per-node
// header lines that featureTree's replay envelope adds are intentionally
// stripped here so the rendered SCAD only contains the geometry that
// matters to the openscad CLI; per-node breakdown is still exposed via
// the FeatureTree replay if a caller wants it.
function scadForParent(parent: ReturnType<typeof buildExtrudeFromLoop>): string {
  return extrudeToScad(parent);
}
