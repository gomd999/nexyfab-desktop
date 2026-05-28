/**
 * fixtures.ts — Wave 2 Phase 2 Track D3 reference-geometry test fixtures.
 *
 * Spec §13.1 fixtures 01-05 (the non-CRDT subset W3 ships). Each fixture
 * is a `ReferenceNode[]` plus an `expected` map of `id → ResolvedValue`
 * the evaluator must produce after a graph walk (within 1e-6 mm).
 *
 * Fixtures 06-10 (hole-on-tilted, cycle, parent-deleted, legacy-v2,
 * cylinder-axis) ship W4 per spec §15.
 *
 * The fixtures live in TS rather than `.nfab` JSON because:
 *
 *   - The `.nfab` v3 schema only carries the node array (no expected
 *     resolved values) — the test would need to recompute them anyway.
 *   - TS lets us share the same `ReferenceNode` type definitions the
 *     production code uses; pure-JSON fixtures need a Zod parse step.
 *   - Round-trip through `serializeProject` / `parseProject` is still
 *     exercised by the same test (`roundTrip` helper).
 */

import type {
  ReferenceCsysNode,
  ReferenceNode,
  ReferencePlaneNode,
  ReferenceAxisNode,
} from '../types';

export interface ReferenceFixture {
  readonly name: string;
  readonly nodes: readonly ReferenceNode[];
  /** Expected resolved values per node id. Tolerance is 1e-6 mm. */
  readonly expected: ReadonlyMap<string, ExpectedShape>;
}

export type ExpectedShape =
  | { kind: 'plane'; origin: readonly [number, number, number]; normal: readonly [number, number, number] }
  | { kind: 'axis'; origin: readonly [number, number, number]; direction: readonly [number, number, number] }
  | { kind: 'point'; position: readonly [number, number, number] }
  | { kind: 'csys'; origin: readonly [number, number, number]; xAxis: readonly [number, number, number]; yAxis: readonly [number, number, number]; zAxis: readonly [number, number, number] };

// ─── Helpers ────────────────────────────────────────────────────

function plane(
  id: string,
  partial: Omit<ReferencePlaneNode, 'id' | 'kind' | 'label' | 'hidden' | 'evaluatedAt' | 'dependsOn'> & { dependsOn?: readonly string[] },
): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    label: id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: partial.dependsOn ?? [],
    method: partial.method,
    params: partial.params,
  };
}

function axis(
  id: string,
  partial: Omit<ReferenceAxisNode, 'id' | 'kind' | 'label' | 'hidden' | 'evaluatedAt' | 'dependsOn'> & { dependsOn?: readonly string[] },
): ReferenceAxisNode {
  return {
    id,
    kind: 'axis',
    label: id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: partial.dependsOn ?? [],
    method: partial.method,
    params: partial.params,
  };
}

function csys(
  id: string,
  partial: Omit<ReferenceCsysNode, 'id' | 'kind' | 'label' | 'hidden' | 'evaluatedAt' | 'dependsOn'> & { dependsOn?: readonly string[] },
): ReferenceCsysNode {
  return {
    id,
    kind: 'csys',
    label: id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: partial.dependsOn ?? [],
    method: partial.method,
    params: partial.params,
  };
}

// ─── F-REFGEOM-01: single offset plane ──────────────────────────
//
// One plane built by offsetting 'front' (z=0 normal) by +30 mm along +Z.
// Verifies: standard-plane resolution + offset constructor.

export const FIXTURE_01_OFFSET_PLANE: ReferenceFixture = {
  name: 'F-REFGEOM-01: single offset plane',
  nodes: [
    plane('p_offset', {
      method: 'offset',
      params: {
        method: 'offset',
        parent: { kind: 'standard', id: 'front' },
        distanceMm: 30,
        direction: 1,
      },
    }),
  ],
  expected: new Map<string, ExpectedShape>([
    ['p_offset', { kind: 'plane', origin: [0, 0, 30], normal: [0, 0, 1] }],
  ]),
};

// ─── F-REFGEOM-02: through-3-points plane ───────────────────────
//
// Plane through (0,0,0), (10,0,0), (0,10,0). Normal should resolve to
// world +Z (since the points lie in the XY plane). Origin = first point.

export const FIXTURE_02_THREE_POINTS: ReferenceFixture = {
  name: 'F-REFGEOM-02: through-3-points plane',
  nodes: [
    plane('p_3pt', {
      method: 'through3Points',
      params: {
        method: 'through3Points',
        points: [
          { kind: 'inline', position: [0, 0, 0] },
          { kind: 'inline', position: [10, 0, 0] },
          { kind: 'inline', position: [0, 10, 0] },
        ],
      },
    }),
  ],
  expected: new Map<string, ExpectedShape>([
    ['p_3pt', { kind: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] }],
  ]),
};

// ─── F-REFGEOM-03: axis from 2 planes ───────────────────────────
//
// Intersection of Front (z=0) and Top (y=0) is the world X axis.

export const FIXTURE_03_AXIS_FROM_TWO_PLANES: ReferenceFixture = {
  name: 'F-REFGEOM-03: axis from 2 planes',
  nodes: [
    axis('a_intersect', {
      method: 'twoPlaneIntersect',
      params: {
        method: 'twoPlaneIntersect',
        a: { kind: 'standard', id: 'front' }, // z=0
        b: { kind: 'standard', id: 'top' },   // y=0
      },
    }),
  ],
  expected: new Map<string, ExpectedShape>([
    // Direction = front.normal(0,0,1) × top.normal(0,1,0) = (-1, 0, 0)
    // Origin solves the 3-plane system → (0,0,0).
    ['a_intersect', { kind: 'axis', origin: [0, 0, 0], direction: [-1, 0, 0] }],
  ]),
};

// ─── F-REFGEOM-04: chained plane (depends on F-01's plane) ──────
//
// Plane A: offset Front by +30 (same as F-01). Plane B: offset A by
// another +20 → world z=50. Verifies multi-step toposort + chained
// reference resolution.

export const FIXTURE_04_CHAINED: ReferenceFixture = {
  name: 'F-REFGEOM-04: chained plane',
  nodes: [
    plane('p_a', {
      method: 'offset',
      params: {
        method: 'offset',
        parent: { kind: 'standard', id: 'front' },
        distanceMm: 30,
        direction: 1,
      },
    }),
    plane('p_b', {
      method: 'offset',
      dependsOn: ['p_a'],
      params: {
        method: 'offset',
        parent: { kind: 'reference', nodeId: 'p_a' },
        distanceMm: 20,
        direction: 1,
      },
    }),
  ],
  expected: new Map<string, ExpectedShape>([
    ['p_a', { kind: 'plane', origin: [0, 0, 30], normal: [0, 0, 1] }],
    ['p_b', { kind: 'plane', origin: [0, 0, 50], normal: [0, 0, 1] }],
  ]),
};

// ─── F-REFGEOM-05: CSys with custom yDir ────────────────────────
//
// CSys at origin (5,5,5), xDir = world X axis, yDir = world Y axis.
// Z derives via right-hand cross product → world Z.

export const FIXTURE_05_CSYS: ReferenceFixture = {
  name: 'F-REFGEOM-05: CSys originAndTwoAxes',
  nodes: [
    csys('c_corner', {
      method: 'originAndTwoAxes',
      params: {
        method: 'originAndTwoAxes',
        origin: { kind: 'inline', position: [5, 5, 5] },
        xDir: { kind: 'standard', id: 'x' },
        yDir: { kind: 'standard', id: 'y' },
      },
    }),
  ],
  expected: new Map<string, ExpectedShape>([
    [
      'c_corner',
      {
        kind: 'csys',
        origin: [5, 5, 5],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        zAxis: [0, 0, 1],
      },
    ],
  ]),
};

export const ALL_FIXTURES: readonly ReferenceFixture[] = [
  FIXTURE_01_OFFSET_PLANE,
  FIXTURE_02_THREE_POINTS,
  FIXTURE_03_AXIS_FROM_TWO_PLANES,
  FIXTURE_04_CHAINED,
  FIXTURE_05_CSYS,
];
