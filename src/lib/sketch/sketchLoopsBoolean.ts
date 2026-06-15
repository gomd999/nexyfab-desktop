/**
 * sketchLoopsBoolean — multi-loop sketch helper for the Extrude modal.
 *
 * Bridges a `SolverViewState` (the editor's view-entity graph) and
 * `sketchBoolean` (pure 2D polygon boolean ops). Used by the Extrude modal
 * when the user has drawn multiple closed loops in one sketch — we need to
 * either union / subtract / intersect them into a single profile, or keep
 * them separate, before extruding.
 *
 * Pure module: no DOM, no React, no I/O. All exports are deterministic.
 *
 * ─── Pipeline ──────────────────────────────────────────────────────────────
 *
 *   SolverViewState
 *     │
 *     ▼  detectLoopsAsPolygons (uses sketchProfile.extractClosedLoops)
 *   ReadonlyArray<SketchLoop>     ← detected closed loops as Point2[]
 *     │
 *     ▼  combineLoops(loops, op)
 *   ReadonlyArray<SketchLoop>     ← combined per chosen op
 *     │
 *     ▼  sketchFromLoops
 *   SolverViewState               ← synthesised sketch (synthetic ids)
 *
 * The downstream extrude pipeline (extrudeFromSketch / API) then runs the
 * existing single-loop path on the synthesised sketch and never has to know
 * about the boolean combine that just happened.
 *
 * ─── Boolean ops ───────────────────────────────────────────────────────────
 *
 *   union     → fold-left unionLoops across all detected loops
 *   subtract  → first loop minus every subsequent loop
 *   intersect → fold-left intersectLoops across all detected loops
 *   separate  → return inputs untouched (each loop becomes its own profile)
 *
 * For 0 or 1 input loops every op is a no-op (just returns the input as-is)
 * so the single-loop fast path is byte-for-byte back-compat.
 *
 * The boolean ops can collapse to zero loops (e.g., intersect of disjoint
 * inputs); callers must handle the empty-result case (the Extrude modal
 * surfaces an error to the user).
 */

import {
  unionLoops,
  subtractLoops,
  intersectLoops,
  type SketchLoop,
  type Point2,
} from './sketchBoolean';
import { extractClosedLoops } from './sketchProfile';
import { solverStateToProfile, type SolverViewState } from './solverToProfile';

// ─── public types ─────────────────────────────────────────────────────────

export type SketchBooleanOp = 'union' | 'subtract' | 'intersect' | 'separate';

export interface DetectedLoopsResult {
  /** Loops as Point2 polygons (open vertex lists, no closing vertex). */
  loops: ReadonlyArray<SketchLoop>;
  /** Line ids in the source sketch that did not participate in any loop. */
  danglingLines: ReadonlyArray<string>;
}

// ─── public helpers ───────────────────────────────────────────────────────

/**
 * Detect every closed loop in the sketch and resolve its point ids to
 * Point2 coordinates suitable for sketchBoolean. Output ordering matches
 * `extractClosedLoops` (deterministic, lowest-id-first canonical form).
 */
export function detectLoopsAsPolygons(sketch: SolverViewState): DetectedLoopsResult {
  const profile = solverStateToProfile(sketch);
  const extraction = extractClosedLoops(profile);
  const pointById = new Map(profile.points.map((p) => [p.id, p]));
  const loops: SketchLoop[] = extraction.loops.map((loop) =>
    loop.points
      .map((id) => pointById.get(id))
      .filter((p): p is { id: string; x: number; y: number } => p !== undefined)
      .map<Point2>((p) => ({ x: p.x, y: p.y })),
  );
  return { loops, danglingLines: extraction.danglingLines };
}

/**
 * Apply a boolean op across N detected loops.
 *
 *   - 0 loops   → []                  (caller error-paths it)
 *   - 1 loop    → [loop]              (every op is a no-op)
 *   - union     → fold-left unionLoops (combined outer; may return >1 if
 *                                       inputs are disjoint)
 *   - subtract  → loop[0] minus every subsequent loop
 *   - intersect → fold-left intersectLoops (may return [] when disjoint)
 *   - separate  → return loops unchanged
 *
 * Output loops are CCW (sketchBoolean normalises orientation), with no
 * trailing closing vertex.
 */
export function combineLoops(
  loops: ReadonlyArray<SketchLoop>,
  op: SketchBooleanOp,
): ReadonlyArray<SketchLoop> {
  if (loops.length === 0) return [];
  if (loops.length === 1) return [loops[0]!];
  if (op === 'separate') return loops.slice();

  let acc: SketchLoop[] = [loops[0]!];
  for (let i = 1; i < loops.length; i++) {
    const next = loops[i]!;
    if (op === 'union') {
      // Union the new loop against every accumulator loop pairwise,
      // collapsing into a single growing accumulator list.
      const merged: SketchLoop[] = [];
      let nextStaging: SketchLoop = next;
      for (const existing of acc) {
        const combined = unionLoops(existing, nextStaging);
        if (combined.length === 1) {
          // Merged into a single loop; treat as the new "next" so it can
          // also merge with subsequent accumulator entries.
          nextStaging = combined[0]!;
        } else if (combined.length === 0) {
          // unionLoops never returns [] for non-empty inputs but be safe.
          // Drop the existing entry (it was absorbed into nothing).
        } else {
          // Disjoint — keep both. The first element is `existing`-derived;
          // the second is `nextStaging`-derived. We keep `existing` and
          // continue testing the next staging against the rest.
          merged.push(combined[0]!);
          // combined[1] is `nextStaging` essentially — keep walking.
          nextStaging = combined[1]!;
        }
      }
      merged.push(nextStaging);
      acc = merged;
    } else if (op === 'subtract') {
      // Apply subtract to every accumulator loop; collect every result.
      const merged: SketchLoop[] = [];
      for (const existing of acc) {
        const carved = subtractLoops(existing, next);
        for (const c of carved) merged.push(c);
      }
      acc = merged;
      if (acc.length === 0) return [];
    } else if (op === 'intersect') {
      // Intersect the new loop with every accumulator loop, union the
      // resulting overlaps. Phase 1 simplification: pairwise intersect
      // and concatenate (most sketches in the modal are 1-vs-1, so the
      // generality here is just for safety).
      const merged: SketchLoop[] = [];
      for (const existing of acc) {
        const inter = intersectLoops(existing, next);
        for (const c of inter) merged.push(c);
      }
      acc = merged;
      if (acc.length === 0) return [];
    }
  }
  return acc;
}

/**
 * Convert a list of polygon loops back into a SolverViewState so the
 * existing extrude pipeline (`solverStateToProfile` → `extractClosedLoops`
 * → `buildExtrudeFromLoop`) can consume them without modification.
 *
 * Each loop becomes a chain of synthetic points + lines with stable ids of
 * the form `bool_p{loopIdx}_{vertIdx}` and `bool_l{loopIdx}_{edgeIdx}`.
 * Loops are CLOSED (last line connects back to the first vertex) so the
 * downstream cycle finder picks them up as closed profiles.
 *
 * Empty input → empty sketch. Loops with < 3 vertices are skipped (they
 * can't form a valid extrude profile).
 */
export function sketchFromLoops(loops: ReadonlyArray<SketchLoop>): SolverViewState {
  const points: { id: string; x: number; y: number }[] = [];
  const lines: { id: string; p1: string; p2: string }[] = [];
  loops.forEach((loop, loopIdx) => {
    // Strip a duplicated closing vertex (some helpers return closed loops).
    let verts = loop.slice();
    if (
      verts.length > 1 &&
      verts[0]!.x === verts[verts.length - 1]!.x &&
      verts[0]!.y === verts[verts.length - 1]!.y
    ) {
      verts = verts.slice(0, -1);
    }
    if (verts.length < 3) return;
    const baseIds: string[] = [];
    verts.forEach((p, vIdx) => {
      const id = `bool_p${loopIdx}_${vIdx}`;
      points.push({ id, x: p.x, y: p.y });
      baseIds.push(id);
    });
    for (let i = 0; i < baseIds.length; i++) {
      const a = baseIds[i]!;
      const b = baseIds[(i + 1) % baseIds.length]!;
      lines.push({ id: `bool_l${loopIdx}_${i}`, p1: a, p2: b });
    }
  });
  return { points, lines };
}

/**
 * Convenience pipeline used by the Extrude modal: detect → combine →
 * synthesise back to a SolverViewState. Returns the (possibly combined)
 * sketch plus the diagnostic loop arrays so the UI can render a preview.
 *
 * When the input sketch has 0 or 1 closed loops the op is a no-op and the
 * returned `sketch` is the input itself (referential equality) — so the
 * single-loop fast path in the wrapper stays bit-identical for back-compat
 * with every prior extrude test.
 */
export function applyBooleanToSketch(
  sketch: SolverViewState,
  op: SketchBooleanOp,
): {
  sketch: SolverViewState;
  detectedLoops: ReadonlyArray<SketchLoop>;
  combinedLoops: ReadonlyArray<SketchLoop>;
} {
  const { loops } = detectLoopsAsPolygons(sketch);
  if (loops.length <= 1) {
    return { sketch, detectedLoops: loops, combinedLoops: loops };
  }
  const combined = combineLoops(loops, op);
  if (combined.length === 0) {
    return { sketch, detectedLoops: loops, combinedLoops: combined };
  }
  return {
    sketch: sketchFromLoops(combined),
    detectedLoops: loops,
    combinedLoops: combined,
  };
}
