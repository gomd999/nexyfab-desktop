/**
 * patternFromSketch — Phase 2.4 UI bridge for linear / circular patterns.
 *
 * Sibling of extrudeFromSketch.ts and revolveFromSketch.ts. Bundles:
 *   - solverStateToProfile (Phase 2.A.1)
 *   - extractClosedLoops (Phase 2.1.1)
 *   - buildExtrudeFromLoop + extrudeToScad (Phase 2.1.2) to produce a
 *     child SCAD body
 *   - buildLinearPattern / buildCircularPattern + their toScad serializers
 *     (Phase 2.4) to wrap the child in for() translate / rotate
 *   - FeatureTree + replayTree (Phase 2.6.1) so the wrapped SCAD lives in
 *     the same `// === id (name) ===` envelope as other features
 *
 * Why "child = extrude from the sketch"?
 *   Pattern is feature-agnostic at the IR level (the pattern IR carries the
 *   child's serialized SCAD body as opaque string). For the Phase 2.4 UI
 *   slice we treat the sketch as a profile + extrude depth so the user can
 *   pattern a sketch-shaped body directly — same UX shape as Extrude /
 *   Revolve modals. A future "pick a feature in the tree to pattern"
 *   workflow can call the IR builders directly with a different child.
 *
 * Out of scope (later):
 *   - Sketch-driven pattern (positions from a sketch curve)
 *   - Patterning an arbitrary feature-tree node (not just a fresh extrude)
 *   - Variable spacing / skip instances
 */

import { solverStateToProfile, type SolverViewState } from './solverToProfile';
import { extractClosedLoops, type ClosedLoop } from './sketchProfile';
import { buildExtrudeFromLoop, extrudeToScad } from '@/lib/cad/extrudeProfile';
import {
  buildLinearPatternRef,
  buildCircularPatternRef,
  type Vec3D,
} from '@/lib/cad/pattern';
import { replayTree, type FeatureTree, type FeatureNode } from '@/lib/cad/featureTree';

// ─── shared types ─────────────────────────────────────────────────────────

export interface PatternChildOptions {
  /** Extrude depth used to build the child body that gets patterned. */
  depth: number;
}

export type PatternFromSketchResult =
  | {
      ok: true;
      scad: string;
      /** Editable dependency tree used to produce `scad`; safe to persist. */
      tree: FeatureTree;
      loop: ClosedLoop;
      /** Lines from the sketch that didn't participate in the chosen loop. */
      danglingLines: ReadonlyArray<string>;
    }
  | {
      ok: false;
      error: string;
    };

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Build the child SCAD body from a sketch + extrude depth. Shared between
 * linearPatternFromSketch and circularPatternFromSketch.
 */
function buildChildScad(
  sketch: SolverViewState,
  child: PatternChildOptions,
):
  | { ok: true; scad: string; loop: ClosedLoop; danglingLines: ReadonlyArray<string>; extrude: ReturnType<typeof buildExtrudeFromLoop> }
  | { ok: false; error: string } {
  if (!Number.isFinite(child.depth) || child.depth <= 0) {
    return { ok: false, error: `child extrude depth must be positive, got ${child.depth}` };
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
  let extrude;
  try {
    extrude = buildExtrudeFromLoop(loop, pointById, { depth: child.depth });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const childScad = extrudeToScad(extrude);
  return {
    ok: true,
    scad: childScad,
    loop,
    danglingLines: extraction.danglingLines,
    extrude,
  };
}

// ─── linear ───────────────────────────────────────────────────────────────

export interface LinearPatternFromSketchOptions {
  child: PatternChildOptions;
  count: number;
  direction: Vec3D;
  spacing: number;
  featureName?: string;
}

export function linearPatternFromSketch(
  sketch: SolverViewState,
  opts: LinearPatternFromSketchOptions,
): PatternFromSketchResult {
  const childRes = buildChildScad(sketch, opts.child);
  if (!childRes.ok) return childRes;

  let pattern;
  try {
    pattern = buildLinearPatternRef('linear_pattern_child', {
      childScad: childRes.scad,
      count: opts.count,
      direction: opts.direction,
      spacing: opts.spacing,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const childNode: FeatureNode = {
    id: 'linear_pattern_child',
    name: 'Pattern seed',
    dependencies: [],
    payload: childRes.extrude,
  };
  const node: FeatureNode = {
    id: 'linear_pattern_1',
    name: opts.featureName ?? 'LinearPattern',
    dependencies: ['linear_pattern_child'],
    payload: pattern,
  };
  const tree: FeatureTree = { nodes: [childNode, node] };
  const result = replayTree(tree);
  return {
    ok: true,
    scad: result.scad,
    tree,
    loop: childRes.loop,
    danglingLines: childRes.danglingLines,
  };
}

// ─── circular ─────────────────────────────────────────────────────────────

export interface CircularPatternFromSketchOptions {
  child: PatternChildOptions;
  count: number;
  axisOrigin: Vec3D;
  axisDirection: Vec3D;
  totalAngleDegrees?: number; // default 360
  featureName?: string;
}

export function circularPatternFromSketch(
  sketch: SolverViewState,
  opts: CircularPatternFromSketchOptions,
): PatternFromSketchResult {
  const childRes = buildChildScad(sketch, opts.child);
  if (!childRes.ok) return childRes;

  let pattern;
  try {
    pattern = buildCircularPatternRef('circular_pattern_child', {
      childScad: childRes.scad,
      count: opts.count,
      axisOrigin: opts.axisOrigin,
      axisDirection: opts.axisDirection,
      totalAngleDegrees: opts.totalAngleDegrees,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const childNode: FeatureNode = {
    id: 'circular_pattern_child',
    name: 'Pattern seed',
    dependencies: [],
    payload: childRes.extrude,
  };
  const node: FeatureNode = {
    id: 'circular_pattern_1',
    name: opts.featureName ?? 'CircularPattern',
    dependencies: ['circular_pattern_child'],
    payload: pattern,
  };
  const tree: FeatureTree = { nodes: [childNode, node] };
  const result = replayTree(tree);
  return {
    ok: true,
    scad: result.scad,
    tree,
    loop: childRes.loop,
    danglingLines: childRes.danglingLines,
  };
}
