/**
 * loftFromSketch — Phase 2.2 UI bridge for loft features.
 *
 * Sibling of extrudeFromSketch.ts / revolveFromSketch.ts. Bundles:
 *   - solverStateToProfile (Phase 2.A.1)
 *   - extractClosedLoops (Phase 2.1.1)
 *   - buildLoft + loftToScad (Phase 2.2)
 *   - FeatureTree + replayTree (Phase 2.6.1)
 *
 * Used by the LoftModal UI to turn one or more sketches at distinct z
 * planes into SCAD source (BOSL2 `skin`) ready for openscad rendering.
 *
 * ─── PHASE 1 LIMITATION ──────────────────────────────────────────────────
 *
 * Phase 1 supports loft between **2+ sections that all share the same
 * sketch profile** lofted across user-specified z values. The minimum
 * useful case the LoftModal exposes today is:
 *
 *   - 2 sections, both source='current' (the active sketch),
 *     at z=0 and z=user_input.
 *
 * Because all sections reference the same sketch (and therefore the same
 * closed loop), the per-section point count automatically matches — this
 * neatly satisfies the buildLoft point-count check (Phase 2.2 limitation).
 * The IR + serializer already support multi-section lofts; Phase 2 will
 * extend the modal to accept additional external sketches (one per
 * section) once cross-sketch ID matching is wired up.
 *
 * Out of scope (Phase 2+):
 *   - Heterogeneous sections (different sketches per section). The IR
 *     supports this but Phase 2.2 still requires matching point counts.
 *   - Multi-loop loft with hole detection
 *   - Guide curves / centerline / G1/G2 continuity
 */

import { solverStateToProfile, type SolverViewState } from './solverToProfile';
import { extractClosedLoops, type ClosedLoop } from './sketchProfile';
import { buildLoft, type SweepLoftMode } from '@/lib/cad/sweepLoft';
import { replayTree, type FeatureTree, type FeatureNode } from '@/lib/cad/featureTree';

export type LoftSectionInput =
  | { source: 'current'; z: number }
  | { source: 'external'; sketch: SolverViewState; z: number };

export type LoftFromSketchResult =
  | {
      ok: true;
      scad: string;
      /** The closed loop chosen from the primary (current) sketch — useful
       *  for the modal's preview/highlight UI. */
      loop: ClosedLoop;
      /** Lines from the primary sketch that didn't participate. */
      danglingLines: ReadonlyArray<string>;
    }
  | {
      ok: false;
      error: string;
    };

export interface LoftFromSketchOptions {
  /** 2+ sections in monotonically-ascending z order. */
  sections: ReadonlyArray<LoftSectionInput>;
  mode?: SweepLoftMode;
  featureName?: string;
}

/**
 * Phase 1: caller typically passes 2 sections with source='current'.
 * The same sketch is lofted across the supplied z values. External
 * sketches are accepted by the type but the Phase 2.2 sweepLoft IR
 * still requires matching point counts between sections.
 */
export function loftFromSketch(
  primarySketch: SolverViewState,
  opts: LoftFromSketchOptions,
): LoftFromSketchResult {
  // ─── validation ──────────────────────────────────────────────────────
  if (!opts.sections || opts.sections.length < 2) {
    return {
      ok: false,
      error: `loft needs at least 2 sections, got ${opts.sections?.length ?? 0}`,
    };
  }
  for (let i = 0; i < opts.sections.length; i++) {
    const s = opts.sections[i]!;
    if (typeof s.z !== 'number' || !Number.isFinite(s.z)) {
      return { ok: false, error: `section ${i} z must be a finite number` };
    }
  }
  for (let i = 1; i < opts.sections.length; i++) {
    if (opts.sections[i]!.z <= opts.sections[i - 1]!.z) {
      return {
        ok: false,
        error: `loft sections must be monotonically ascending in z (section ${i} z=${opts.sections[i]!.z} ≤ section ${i - 1} z=${opts.sections[i - 1]!.z})`,
      };
    }
  }

  // ─── extract loop per section ────────────────────────────────────────
  // For Phase 1 we accept the primary sketch by default for source='current'.
  // External sketches are extracted with the same pipeline.
  type Extracted = { loop: ClosedLoop; pointsById: Map<string, { id: string; x: number; y: number }>; z: number };
  const extracted: Extracted[] = [];
  let primaryLoop: ClosedLoop | null = null;
  let primaryDangling: ReadonlyArray<string> = [];

  for (let i = 0; i < opts.sections.length; i++) {
    const s = opts.sections[i]!;
    const sketch = s.source === 'current' ? primarySketch : s.sketch;
    const profileInput = solverStateToProfile(sketch);
    const extraction = extractClosedLoops(profileInput);
    if (extraction.loops.length === 0) {
      return {
        ok: false,
        error:
          extraction.danglingLines.length > 0
            ? `Section ${i}: no closed loop found — ${extraction.danglingLines.length} dangling line(s). Connect the sketch into a closed profile first.`
            : `Section ${i}: no closed loop found — draw a closed profile first.`,
      };
    }
    // Largest-area loop = outer profile.
    const loop = [...extraction.loops].sort(
      (l1, l2) => Math.abs(l2.signedArea) - Math.abs(l1.signedArea),
    )[0]!;
    const pointsById = new Map(profileInput.points.map((p) => [p.id, p]));
    extracted.push({ loop, pointsById, z: s.z });

    if (s.source === 'current' && primaryLoop === null) {
      primaryLoop = loop;
      primaryDangling = extraction.danglingLines;
    }
  }

  // Fallback if no section was source='current' (purely external): use the
  // first section's loop as the "primary" return-shape for the UI.
  if (primaryLoop === null) {
    primaryLoop = extracted[0]!.loop;
    primaryDangling = [];
  }

  // ─── build IR ────────────────────────────────────────────────────────
  let loft;
  try {
    loft = buildLoft({
      sections: extracted.map((e) => ({ loop: e.loop, pointsById: e.pointsById, z: e.z })),
      mode: opts.mode,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // ─── render via feature tree (consistent with sibling pipelines) ────
  const node: FeatureNode = {
    id: 'loft_1',
    name: opts.featureName ?? 'Loft',
    dependencies: [],
    payload: loft,
  };
  const tree: FeatureTree = { nodes: [node] };
  const result = replayTree(tree);
  return {
    ok: true,
    scad: result.scad,
    loop: primaryLoop,
    danglingLines: primaryDangling,
  };
}
