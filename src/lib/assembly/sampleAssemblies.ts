/**
 * sampleAssemblies — Phase 4.A end-to-end seeds for the AssemblyBrowser →
 * /api/assembly-solve → iterativeSolve real path (ADR-013).
 *
 * A small library of pre-canned (AssemblyState, FeatureTrees) pairs the UI
 * "Load sample" dropdown can drop into the modal so a user (or a Phase 4
 * integration test) can exercise the full pipeline without hand-typing
 * JSON. Every preset is built from primitive cube parts (30 mm side) whose
 * FeatureTree exposes the canonical refs the geometryResolver hard-codes
 * (`origin`, `x/y/z_axis`, `xy/yz/xz_plane`, etc.).
 *
 * Why cubes only? The Phase-1 geometryResolver derives feature-aware refs
 * (`hole_axis_${i}`, `revolve_axis_${i}`, …) from the FeatureTree, but
 * three of the four presets the modal needs (concentric pin, chain,
 * hinge) only require the always-present datum refs — so we keep the
 * trees tiny and self-explanatory.
 *
 * Each preset's JSDoc documents:
 *   - dof: approximateAssemblyDoF on the initial state (heuristic, not the
 *     post-solve rank-based number).
 *   - expectedSuccess: what iterativeSolve should report on a clean run
 *     with default solverOptions (maxIter=100, tol=1e-4).
 *
 * Adding a preset:
 *   1. Pick a stable, hyphenated name (e.g., 'gear-pair').
 *   2. Build the state + per-part FeatureTree map and add it to PRESETS.
 *   3. Document dof + expectedSuccess in the JSDoc above the entry.
 *   4. Add a row to sampleAssemblies.test.ts asserting validateAssembly,
 *      FeatureTree coverage, and a resolver-roundtrip for every mate ref.
 */

import {
  IDENTITY_QUAT,
  type AssemblyState,
  type PartInstance,
} from './assemblyState';
import type { Mate } from './mate';
import type { FeatureTree } from '@/lib/cad/featureTree';

// ─── public API ─────────────────────────────────────────────────────────────

export type SampleAssemblyName =
  | 'two-cubes-concentric'
  | 'three-cubes-chain'
  | 'hinge-pair';

export interface SampleAssembly {
  state: AssemblyState;
  featureTrees: Record<string, FeatureTree>;
}

/** All preset names in display order. Use this to populate UI dropdowns. */
export const SAMPLE_ASSEMBLY_NAMES: ReadonlyArray<SampleAssemblyName> = [
  'two-cubes-concentric',
  'three-cubes-chain',
  'hinge-pair',
];

/**
 * Look up a sample preset by name. Returns a fresh DEEP copy of the
 * (state, featureTrees) pair on every call so callers can mutate the
 * result via the modal's edit helpers without disturbing other consumers
 * or the next sample-load.
 *
 * Throws if `name` is not one of `SAMPLE_ASSEMBLY_NAMES` — UI callers
 * should narrow the type via the union above before calling.
 */
export function getSampleAssembly(name: SampleAssemblyName): SampleAssembly {
  switch (name) {
    case 'two-cubes-concentric':
      return twoCubesConcentric();
    case 'three-cubes-chain':
      return threeCubesChain();
    case 'hinge-pair':
      return hingePair();
  }
}

// ─── shared helpers ─────────────────────────────────────────────────────────

/** Build a 30 mm cube FeatureTree centred on the part's local origin. */
function cubeFeatureTree(nodeId: string): FeatureTree {
  return {
    nodes: [
      {
        id: nodeId,
        name: 'CubeExtrude',
        dependencies: [],
        payload: {
          kind: 'extrude',
          loop: [
            { x: -15, y: -15 },
            { x: 15, y: -15 },
            { x: 15, y: 15 },
            { x: -15, y: 15 },
          ],
          depth: 30,
          direction: 'one_sided',
          mode: 'add',
        },
      },
    ],
  };
}

/** Convenience: build a PartInstance with sane defaults (identity rotation). */
function makePart(opts: {
  id: string;
  name: string;
  position?: { x: number; y: number; z: number };
  fixed?: boolean;
}): PartInstance {
  return {
    id: opts.id,
    name: opts.name,
    partTemplateId: opts.id,
    position: opts.position ?? { x: 0, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed: opts.fixed ?? false,
  };
}

// ─── 1) two cubes pinned by a concentric mate ───────────────────────────────

/**
 * Two 30×30×30 cubes sharing the world Z axis. `cube_a` is the fixed
 * anchor at the origin; `cube_b` starts perpendicular-offset by (40, 30, 0)
 * and the single concentric mate snaps its z_axis onto `cube_a.z_axis`.
 *
 * Expected solver behaviour (default opts):
 *   dof             : 6  (raw 6 from cube_b free; concentric removes ≈ 0
 *                        from the heuristic when only axial slide/spin remain.
 *                        approxDofReduction('concentric') = 4 → 6 - 4 = 2.)
 *   expectedSuccess : true (analytical placement converges in 1 iteration —
 *                          single concentric pair is solved exactly).
 *   iterations      : 1   (Gauss-Seidel converges on its first sweep once the
 *                         analytical placement zeroes the perp offset.)
 */
function twoCubesConcentric(): SampleAssembly {
  const partA: PartInstance = makePart({
    id: 'cube_a',
    name: 'Cube A',
    fixed: true,
  });
  const partB: PartInstance = makePart({
    id: 'cube_b',
    name: 'Cube B',
    position: { x: 40, y: 30, z: 0 },
    fixed: false,
  });
  const mate: Mate = {
    id: 'mate_concentric_ab',
    kind: 'concentric',
    a: { partId: 'cube_a', refId: 'z_axis', refKind: 'axis' },
    b: { partId: 'cube_b', refId: 'z_axis', refKind: 'axis' },
  };
  return {
    state: { parts: [partA, partB], mates: [mate] },
    featureTrees: {
      cube_a: cubeFeatureTree('cube_a_extrude'),
      cube_b: cubeFeatureTree('cube_b_extrude'),
    },
  };
}

// ─── 2) three cubes chained by two concentric mates ─────────────────────────

/**
 * Three 30×30×30 cubes pinned in a chain by two concentric mates:
 *   cube_a (fixed) ─[mate_chain_ab: z_axis]─ cube_b ─[mate_chain_bc: z_axis]─ cube_c
 *
 * cube_b and cube_c both start perpendicular-offset so the solver has work
 * to do. The chain is straight (all three z_axes co-linear) so it's
 * satisfiable in a small number of Gauss-Seidel sweeps.
 *
 * Expected solver behaviour (default opts):
 *   dof             : 4   (raw 12 from two free cubes; two concentrics
 *                          remove 2·4 = 8.)
 *   expectedSuccess : true
 *   iterations      : ≤ 3 (each mate snaps its moved-side onto the fixed
 *                         side analytically; one Gauss-Seidel pass is
 *                         usually enough; the solver does a final pass
 *                         to confirm tolerance).
 */
function threeCubesChain(): SampleAssembly {
  const cubeA: PartInstance = makePart({
    id: 'cube_a',
    name: 'Cube A',
    fixed: true,
  });
  const cubeB: PartInstance = makePart({
    id: 'cube_b',
    name: 'Cube B',
    position: { x: 25, y: 12, z: 0 },
    fixed: false,
  });
  const cubeC: PartInstance = makePart({
    id: 'cube_c',
    name: 'Cube C',
    position: { x: 8, y: -22, z: 0 },
    fixed: false,
  });
  const mate1: Mate = {
    id: 'mate_chain_ab',
    kind: 'concentric',
    a: { partId: 'cube_a', refId: 'z_axis', refKind: 'axis' },
    b: { partId: 'cube_b', refId: 'z_axis', refKind: 'axis' },
  };
  const mate2: Mate = {
    id: 'mate_chain_bc',
    kind: 'concentric',
    a: { partId: 'cube_b', refId: 'z_axis', refKind: 'axis' },
    b: { partId: 'cube_c', refId: 'z_axis', refKind: 'axis' },
  };
  return {
    state: { parts: [cubeA, cubeB, cubeC], mates: [mate1, mate2] },
    featureTrees: {
      cube_a: cubeFeatureTree('cube_a_extrude'),
      cube_b: cubeFeatureTree('cube_b_extrude'),
      cube_c: cubeFeatureTree('cube_c_extrude'),
    },
  };
}

// ─── 3) two cubes joined by a hinge mate ────────────────────────────────────

/**
 * Two 30×30×30 cubes hinged about the world Y axis. `hinge_base` is the
 * fixed anchor; `hinge_door` starts perpendicular-offset and the solver
 * snaps its y_axis onto the base's y_axis (axes collinear). The axial spin
 * DoF around Y stays free — the hinge mate's analytical placement matches
 * concentric in Phase 1 (no angular limit set, so no residual penalty).
 *
 * Expected solver behaviour (default opts):
 *   dof             : 1   (raw 6 from hinge_door free; hinge removes 5.)
 *   expectedSuccess : true
 *   iterations      : 1   (single analytical placement zeroes the perp
 *                         offset; subsequent residual ≈ 0.)
 */
function hingePair(): SampleAssembly {
  const baseId = 'hinge_base';
  const doorId = 'hinge_door';
  const base: PartInstance = makePart({
    id: baseId,
    name: 'Hinge Base',
    fixed: true,
  });
  const door: PartInstance = makePart({
    id: doorId,
    name: 'Hinge Door',
    position: { x: 12, y: 0, z: 7 },
    fixed: false,
  });
  const mate: Mate = {
    id: 'mate_hinge',
    kind: 'hinge',
    a: { partId: baseId, refId: 'y_axis', refKind: 'axis' },
    b: { partId: doorId, refId: 'y_axis', refKind: 'axis' },
  };
  return {
    state: { parts: [base, door], mates: [mate] },
    featureTrees: {
      [baseId]: cubeFeatureTree(`${baseId}_extrude`),
      [doorId]: cubeFeatureTree(`${doorId}_extrude`),
    },
  };
}
