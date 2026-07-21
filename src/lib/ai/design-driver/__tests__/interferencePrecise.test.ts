/**
 * WB-4b — precise narrow-phase interference refinement.
 *
 * Proves the two behaviours the mission requires:
 *   (1) a genuinely-PENETRATING unmated pair still FAILS, with the broad-phase
 *       penetration measured AND the narrow phase confirming a real surface
 *       collision (measured intersecting triangle-pair count > 0);
 *   (2) a pair whose world-AABBs OVERLAP but whose real solids are DISJOINT
 *       now PASSES — the false positive the old AABB-only gate wrongly failed.
 *       The L-channel part's bounding box swallows the peg sitting in its
 *       concavity, so the broad phase raises the candidate (rawOverlaps ≠ ∅,
 *       penetration ≈ 10 mm) yet the narrow phase clears it.
 *
 * Both assertions are gate-level (buildInterferenceArtifact → interferenceGate)
 * over a real solved placement (solvePlanAssembly) and real meshes
 * (buildPartGeometry) — no fabricated numbers.
 */

import { describe, expect, it } from 'vitest';
import type { MeshableFeature } from '@/lib/cad/featureMesh';
import {
  buildInterferenceArtifact,
  buildPartGeometry,
  interferenceGate,
  solvePlanAssembly,
  type DesignPlan,
  type PartGeometry,
  type PlanBody,
  type PlanPart,
} from '../index';

// ─── fixtures ──────────────────────────────────────────────────────────────

/** Axis-aligned rectangular extrude body [0..w]×[0..d]×[0..h] (CCW loop). */
function boxBody(bodyId: string, w: number, d: number, h: number, translate?: { x: number; y: number; z: number }): PlanBody {
  const feature: MeshableFeature = {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ],
    depth: h,
    direction: 'one_sided',
    mode: 'add',
  };
  return { bodyId, feature, ...(translate ? { translate } : {}) };
}

/** Single 20×20×20 cube part (world AABB = solid — no slack). */
function cubePart(id: string): PlanPart {
  return { partId: id, name: id, material: 'AL6061', process: 'cnc', bodies: [boxBody('main', 20, 20, 20)] };
}

/**
 * L-channel part built from TWO convex box bodies sharing the y=10 plane
 * (zero-thickness contact, no positive-volume body overlap):
 *   bar_x: x[0..30] y[0..10] z[0..10]
 *   bar_y: x[0..10] y[10..30] z[0..10]
 * Composite AABB = x[0..30] y[0..30] z[0..10]; the top-right quadrant
 * (x[10..30] y[10..30]) is EMPTY — the concavity a peg can sit in.
 */
function lChannelPart(id: string): PlanPart {
  return {
    partId: id,
    name: id,
    material: 'AL6061',
    process: 'cnc',
    bodies: [
      boxBody('bar_x', 30, 10, 10),
      boxBody('bar_y', 10, 20, 10, { x: 0, y: 10, z: 0 }),
    ],
  };
}

/** 10×10×10 peg part. */
function pegPart(id: string): PlanPart {
  return { partId: id, name: id, material: 'AL6061', process: 'cnc', bodies: [boxBody('main', 10, 10, 10)] };
}

function unmatedPlan(planId: string, parts: PlanPart[], placements: Record<string, { x: number; y: number; z: number }>): DesignPlan {
  return {
    planId,
    name: planId,
    parts,
    assembly: {
      parts: parts.map((p) => ({
        partId: p.partId,
        fixed: true,
        ...(placements[p.partId] ? { position: placements[p.partId] } : {}),
        refs: { o: { kind: 'point' as const, origin: { x: 0, y: 0, z: 0 } } },
      })),
      mates: [], // deliberately unmated — the gate must decide from geometry
      tolerance: 1e-6,
    },
    drawing: { paperSize: 'A3', scale: 1, dimensions: [] },
  };
}

function geometriesOf(plan: DesignPlan): Map<string, PartGeometry> {
  return new Map(plan.parts.map((p) => [p.partId, buildPartGeometry(p)]));
}

// ─── (1) TRUE penetration — narrow phase confirms, gate FAILS ────────────────

describe('WB-4b (1) genuine penetration (unmated solids really overlap)', () => {
  const plan = unmatedPlan(
    'penetrate',
    [cubePart('cube_a'), cubePart('cube_b')],
    { cube_b: { x: 10, y: 0, z: 0 } }, // cube_a x[0..20], cube_b x[10..30] → overlap 10 mm
  );

  it('broad phase measures the overlap AND narrow phase confirms a real collision → FAIL', () => {
    const art = buildInterferenceArtifact(plan, solvePlanAssembly(plan.assembly!), geometriesOf(plan));

    // broad phase raised the candidate with a measured 10 mm interpenetration
    expect(art.rawOverlaps).toHaveLength(1);
    expect(art.rawOverlaps[0]!.penetration).toBeCloseTo(10, 9);

    // narrow phase CONFIRMED it (real triangle intersections measured)
    expect(art.confirmedPairs).toHaveLength(1);
    expect(art.confirmedPairs[0]!.triPairs).toBeGreaterThan(0);
    expect(art.confirmedPairs[0]!.byContainment).toBe(false);
    expect(art.clearedPairs).toHaveLength(0);
    expect(art.fallbackPairs).toHaveLength(0);
    expect(art.flagged).toHaveLength(1);

    const gate = interferenceGate(plan, art);
    expect(gate.pass).toBe(false);
    expect(gate.metrics.flaggedPairs).toBe(1);
    expect(gate.metrics.narrowPhaseConfirmed).toBe(1);
    expect(gate.metrics.maxPenetrationMm).toBeCloseTo(10, 9);
    expect(gate.reason).toContain('cube_a');
    expect(gate.reason).toContain('cube_b');
    expect(gate.reason).toContain('정밀 협역 확정');
  });
});

// ─── (2) FALSE positive — narrow phase clears, gate PASSES ───────────────────

describe('WB-4b (2) AABB false positive (bboxes overlap, solids disjoint)', () => {
  const plan = unmatedPlan(
    'cradle',
    [lChannelPart('lc'), pegPart('pg')],
    { pg: { x: 15, y: 15, z: 0 } }, // peg sits in the L's empty concavity x[15..25] y[15..25]
  );

  it('the peg in the L concavity: old AABB gate would FAIL, precise gate PASSES', () => {
    const geos = geometriesOf(plan);
    const art = buildInterferenceArtifact(plan, solvePlanAssembly(plan.assembly!), geos);

    // broad phase STILL raises the candidate — proving the old gate would fail:
    // the L's bounding box overlaps the peg by a real 10 mm on the shallow axis.
    expect(art.rawOverlaps).toHaveLength(1);
    expect(art.rawOverlaps[0]!.penetration).toBeCloseTo(10, 9);

    // narrow phase CLEARS it (solids never touch) → nothing flagged
    expect(art.clearedPairs).toHaveLength(1);
    expect(art.clearedPairs[0]!.pair).toBe('lc::pg');
    expect(art.clearedPairs[0]!.aabbPenetrationMm).toBeCloseTo(10, 9);
    expect(art.confirmedPairs).toHaveLength(0);
    expect(art.fallbackPairs).toHaveLength(0);
    expect(art.flagged).toHaveLength(0);

    const gate = interferenceGate(plan, art);
    expect(gate.pass).toBe(true);
    expect(gate.metrics.flaggedPairs).toBe(0);
    expect(gate.metrics.narrowPhaseCleared).toBe(1);
    expect(gate.metrics.rawOverlapPairs).toBe(1); // the candidate really existed
    // the honesty note must state the false positive was removed
    expect(gate.notes.some((n) => n.includes('위양성') && n.includes('제거'))).toBe(true);
  });

  it('sanity: if the peg is pushed INTO the L wall, the precise gate FAILS', () => {
    // peg at x[5..15] y[5..15] overlaps bar_x (y[0..10]) and bar_y (x[0..10]) solids.
    const hit = unmatedPlan('cradle-hit', [lChannelPart('lc'), pegPart('pg')], { pg: { x: 5, y: 5, z: 0 } });
    const art = buildInterferenceArtifact(hit, solvePlanAssembly(hit.assembly!), geometriesOf(hit));
    expect(art.confirmedPairs).toHaveLength(1);
    expect(art.confirmedPairs[0]!.triPairs).toBeGreaterThan(0);
    expect(interferenceGate(hit, art).pass).toBe(false);
  });
});
