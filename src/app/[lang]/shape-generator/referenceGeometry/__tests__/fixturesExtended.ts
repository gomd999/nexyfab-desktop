/**
 * fixturesExtended.ts — Wave 2 Phase 2 Track D4 reference-geometry fixtures 06-10.
 *
 * Spec §13.1 fixtures 06-10. These complement the W3 fixtures 01-05
 * (`fixtures.ts`) by stressing the dep solver, KS conventions, and the
 * standalone-ref-geom case.
 *
 *   - F-REFGEOM-06: complex part with 8 mixed-kind ref-geom items
 *   - F-REFGEOM-07: deep chain (10 planes, each on the previous)
 *   - F-REFGEOM-08: branching (multiple children of one parent plane)
 *   - F-REFGEOM-09: KS datum label round-trip
 *   - F-REFGEOM-10: ref-geom-only project (no sketches)
 *
 * Same TS-fixture pattern as fixtures 01-05 — see `fixtures.ts` header
 * for the rationale (shared types, shared round-trip helper).
 */

import type {
  ReferenceAxisNode,
  ReferenceCsysNode,
  ReferenceNode,
  ReferencePlaneNode,
  ReferencePointNode,
} from '../types';
import type { ExpectedShape, ReferenceFixture } from './fixtures';

// ─── Local helpers (mirror of fixtures.ts) ──────────────────────

function plane(
  id: string,
  partial: Omit<
    ReferencePlaneNode,
    'id' | 'kind' | 'label' | 'hidden' | 'evaluatedAt' | 'dependsOn'
  > & { dependsOn?: readonly string[]; label?: string },
): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    label: partial.label ?? id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: partial.dependsOn ?? [],
    method: partial.method,
    params: partial.params,
  };
}

function axis(
  id: string,
  partial: Omit<
    ReferenceAxisNode,
    'id' | 'kind' | 'label' | 'hidden' | 'evaluatedAt' | 'dependsOn'
  > & { dependsOn?: readonly string[]; label?: string },
): ReferenceAxisNode {
  return {
    id,
    kind: 'axis',
    label: partial.label ?? id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: partial.dependsOn ?? [],
    method: partial.method,
    params: partial.params,
  };
}

function point(
  id: string,
  partial: Omit<
    ReferencePointNode,
    'id' | 'kind' | 'label' | 'hidden' | 'evaluatedAt' | 'dependsOn'
  > & { dependsOn?: readonly string[]; label?: string },
): ReferencePointNode {
  return {
    id,
    kind: 'point',
    label: partial.label ?? id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: partial.dependsOn ?? [],
    method: partial.method,
    params: partial.params,
  };
}

function csys(
  id: string,
  partial: Omit<
    ReferenceCsysNode,
    'id' | 'kind' | 'label' | 'hidden' | 'evaluatedAt' | 'dependsOn'
  > & { dependsOn?: readonly string[]; label?: string },
): ReferenceCsysNode {
  return {
    id,
    kind: 'csys',
    label: partial.label ?? id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: partial.dependsOn ?? [],
    method: partial.method,
    params: partial.params,
  };
}

// ─── F-REFGEOM-06: complex part with 8 mixed-kind ref-geom items ─

/**
 * Stresses the dep solver across all four kinds in one fixture.
 *
 * Composition (creation order):
 *   1. p_a   : offset Front by +30  → z=30 plane
 *   2. p_b   : offset Front by -20  → z=-20 plane
 *   3. a_xy  : standard X axis
 *   4. a_int : Top ∩ Front          → -X direction
 *   5. p_mid : mid of p_a / p_b     → z=5 plane
 *   6. pt_a  : byCoordinates (10,0,0)
 *   7. pt_b  : intersect a_xy + p_mid → (5, 0, 0)... actually X-axis ∩ z=5
 *              plane has no intersection (axis is in z=0). Use a_int with
 *              p_a (which is z=30) — line z=0, X-dir, parallel to plane
 *              z=30 → no intersection either. Use pt_a projection instead.
 *   7. pt_proj : project pt_a onto p_a → (10, 0, 30)
 *   8. c_corner : originAndTwoAxes (pt_a as origin, x + y standard axes)
 */
export const FIXTURE_06_COMPLEX: ReferenceFixture = {
  name: 'F-REFGEOM-06: complex part (8 mixed-kind refs)',
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
      params: {
        method: 'offset',
        parent: { kind: 'standard', id: 'front' },
        distanceMm: 20,
        direction: -1,
      },
    }),
    axis('a_xy', {
      method: 'standard',
      params: { method: 'standard', id: 'x' },
    }),
    axis('a_int', {
      method: 'twoPlaneIntersect',
      params: {
        method: 'twoPlaneIntersect',
        a: { kind: 'standard', id: 'front' },
        b: { kind: 'standard', id: 'top' },
      },
    }),
    plane('p_mid', {
      method: 'midBetween',
      dependsOn: ['p_a', 'p_b'],
      params: {
        method: 'midBetween',
        a: { kind: 'reference', nodeId: 'p_a' },
        b: { kind: 'reference', nodeId: 'p_b' },
      },
    }),
    point('pt_a', {
      method: 'byCoordinates',
      params: { method: 'byCoordinates', position: [10, 0, 0] },
    }),
    point('pt_proj', {
      method: 'projectPointOntoPlane',
      dependsOn: ['pt_a', 'p_a'],
      params: {
        method: 'projectPointOntoPlane',
        point: { kind: 'reference', nodeId: 'pt_a' },
        plane: { kind: 'reference', nodeId: 'p_a' },
      },
    }),
    csys('c_corner', {
      method: 'originAndTwoAxes',
      dependsOn: ['pt_a'],
      params: {
        method: 'originAndTwoAxes',
        origin: { kind: 'reference', nodeId: 'pt_a' },
        xDir: { kind: 'standard', id: 'x' },
        yDir: { kind: 'standard', id: 'y' },
      },
    }),
  ],
  expected: new Map<string, ExpectedShape>([
    ['p_a', { kind: 'plane', origin: [0, 0, 30], normal: [0, 0, 1] }],
    ['p_b', { kind: 'plane', origin: [0, 0, -20], normal: [0, 0, 1] }],
    ['a_xy', { kind: 'axis', origin: [0, 0, 0], direction: [1, 0, 0] }],
    ['a_int', { kind: 'axis', origin: [0, 0, 0], direction: [-1, 0, 0] }],
    // Mid of z=30 and z=-20 = z=5, normal +Z (parents have same normal).
    ['p_mid', { kind: 'plane', origin: [0, 0, 5], normal: [0, 0, 1] }],
    ['pt_a', { kind: 'point', position: [10, 0, 0] }],
    // Project (10,0,0) onto z=30 plane → (10, 0, 30).
    ['pt_proj', { kind: 'point', position: [10, 0, 30] }],
    [
      'c_corner',
      {
        kind: 'csys',
        origin: [10, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        zAxis: [0, 0, 1],
      },
    ],
  ]),
};

// ─── F-REFGEOM-07: deep chain (10 planes) ───────────────────────

/** Each plane offsets the previous by +5mm along +Z. Verifies the
 *  toposort + evaluator scale linearly with chain depth and that
 *  references resolve through 9 layers of indirection. */
function buildDeepChain(): ReferenceFixture {
  const nodes: ReferenceNode[] = [];
  const expected = new Map<string, ExpectedShape>();
  const stepMm = 5;

  for (let i = 0; i < 10; i += 1) {
    const id = `p_chain_${i}`;
    const parent =
      i === 0
        ? ({ kind: 'standard' as const, id: 'front' as const })
        : ({ kind: 'reference' as const, nodeId: `p_chain_${i - 1}` });
    nodes.push(
      plane(id, {
        method: 'offset',
        dependsOn: i === 0 ? [] : [`p_chain_${i - 1}`],
        params: {
          method: 'offset',
          parent,
          distanceMm: stepMm,
          direction: 1,
        },
      }),
    );
    expected.set(id, {
      kind: 'plane',
      origin: [0, 0, stepMm * (i + 1)],
      normal: [0, 0, 1],
    });
  }

  return {
    name: 'F-REFGEOM-07: deep chain (10 planes)',
    nodes,
    expected,
  };
}

export const FIXTURE_07_DEEP_CHAIN = buildDeepChain();

// ─── F-REFGEOM-08: branching (multi-child of one parent) ────────

/** One root plane spawns 4 children (offsets +10, +20, +30, +40). The
 *  toposort must visit the root before any child, and the evaluator
 *  must produce 4 different resolved planes from the same parent's
 *  resolved value. */
function buildBranching(): ReferenceFixture {
  const nodes: ReferenceNode[] = [
    plane('p_root', {
      method: 'offset',
      params: {
        method: 'offset',
        parent: { kind: 'standard', id: 'front' },
        distanceMm: 10,
        direction: 1,
      },
    }),
  ];
  const expected = new Map<string, ExpectedShape>([
    ['p_root', { kind: 'plane', origin: [0, 0, 10], normal: [0, 0, 1] }],
  ]);

  for (let i = 0; i < 4; i += 1) {
    const id = `p_child_${i}`;
    const offset = 10 * (i + 1);
    nodes.push(
      plane(id, {
        method: 'offset',
        dependsOn: ['p_root'],
        params: {
          method: 'offset',
          parent: { kind: 'reference', nodeId: 'p_root' },
          distanceMm: offset,
          direction: 1,
        },
      }),
    );
    // p_root is at z=10; child adds `offset` on top → z = 10 + offset.
    expected.set(id, {
      kind: 'plane',
      origin: [0, 0, 10 + offset],
      normal: [0, 0, 1],
    });
  }

  return {
    name: 'F-REFGEOM-08: branching (4 children of 1 parent)',
    nodes,
    expected,
  };
}

export const FIXTURE_08_BRANCHING = buildBranching();

// ─── F-REFGEOM-09: KS datum label round-trip ────────────────────

/** Three planes + two axes + one point + one csys in creation order.
 *  After buildKsDatumLabels the expected per-id assignment is:
 *
 *    p_alpha → A
 *    p_beta  → B
 *    p_gamma → C
 *    a_one   → A'
 *    a_two   → B'
 *    pt_one  → a
 *    c_one   → [A]
 *
 *  The fixture round-trips through .nfab and re-runs buildKsDatumLabels;
 *  the assignment must be identical (creation order is preserved by
 *  the serialiser). */
export const FIXTURE_09_KS_DATUM: ReferenceFixture = {
  name: 'F-REFGEOM-09: KS datum label round-trip',
  nodes: [
    plane('p_alpha', {
      method: 'offset',
      label: 'Alpha',
      params: {
        method: 'offset',
        parent: { kind: 'standard', id: 'front' },
        distanceMm: 10,
        direction: 1,
      },
    }),
    plane('p_beta', {
      method: 'offset',
      label: 'Beta',
      params: {
        method: 'offset',
        parent: { kind: 'standard', id: 'front' },
        distanceMm: 20,
        direction: 1,
      },
    }),
    plane('p_gamma', {
      method: 'offset',
      label: 'Gamma',
      params: {
        method: 'offset',
        parent: { kind: 'standard', id: 'front' },
        distanceMm: 30,
        direction: 1,
      },
    }),
    axis('a_one', {
      method: 'standard',
      label: 'Axis One',
      params: { method: 'standard', id: 'x' },
    }),
    axis('a_two', {
      method: 'standard',
      label: 'Axis Two',
      params: { method: 'standard', id: 'y' },
    }),
    point('pt_one', {
      method: 'byCoordinates',
      label: 'Point One',
      params: { method: 'byCoordinates', position: [1, 2, 3] },
    }),
    csys('c_one', {
      method: 'world',
      label: 'CSys One',
      params: { method: 'world' },
    }),
  ],
  expected: new Map<string, ExpectedShape>([
    ['p_alpha', { kind: 'plane', origin: [0, 0, 10], normal: [0, 0, 1] }],
    ['p_beta', { kind: 'plane', origin: [0, 0, 20], normal: [0, 0, 1] }],
    ['p_gamma', { kind: 'plane', origin: [0, 0, 30], normal: [0, 0, 1] }],
    ['a_one', { kind: 'axis', origin: [0, 0, 0], direction: [1, 0, 0] }],
    ['a_two', { kind: 'axis', origin: [0, 0, 0], direction: [0, 1, 0] }],
    ['pt_one', { kind: 'point', position: [1, 2, 3] }],
    [
      'c_one',
      {
        kind: 'csys',
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        zAxis: [0, 0, 1],
      },
    ],
  ]),
};

/** Expected KS letters for F-09 in creation order. Asserted by the test
 *  before and after .nfab round-trip. */
export const FIXTURE_09_EXPECTED_KS: ReadonlyMap<string, string> = new Map<string, string>([
  ['p_alpha', 'A'],
  ['p_beta', 'B'],
  ['p_gamma', 'C'],
  ['a_one', "A'"],
  ['a_two', "B'"],
  ['pt_one', 'a'],
  ['c_one', '[A]'],
]);

// ─── F-REFGEOM-10: ref-geom-only project (no sketches) ──────────

/** Standalone case: a part with only reference geometry, no features,
 *  no sketches. Verifies the serialiser writes ref-geom in absence of
 *  feature-tree content and the evaluator resolves a graph that has
 *  no consumers downstream. */
export const FIXTURE_10_REF_GEOM_ONLY: ReferenceFixture = {
  name: 'F-REFGEOM-10: ref-geom-only (no sketches)',
  nodes: [
    plane('p_only_a', {
      method: 'offset',
      params: {
        method: 'offset',
        parent: { kind: 'standard', id: 'front' },
        distanceMm: 15,
        direction: 1,
      },
    }),
    plane('p_only_b', {
      method: 'standard',
      params: { method: 'standard', id: 'top' },
    }),
    axis('a_only', {
      method: 'standard',
      params: { method: 'standard', id: 'z' },
    }),
    point('pt_only', {
      method: 'byCoordinates',
      params: { method: 'byCoordinates', position: [7, 7, 7] },
    }),
    csys('c_only', { method: 'world', params: { method: 'world' } }),
  ],
  expected: new Map<string, ExpectedShape>([
    ['p_only_a', { kind: 'plane', origin: [0, 0, 15], normal: [0, 0, 1] }],
    // Standard 'top' plane = y=0 (normal +Y).
    ['p_only_b', { kind: 'plane', origin: [0, 0, 0], normal: [0, 1, 0] }],
    ['a_only', { kind: 'axis', origin: [0, 0, 0], direction: [0, 0, 1] }],
    ['pt_only', { kind: 'point', position: [7, 7, 7] }],
    [
      'c_only',
      {
        kind: 'csys',
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        zAxis: [0, 0, 1],
      },
    ],
  ]),
};

export const ALL_FIXTURES_EXTENDED: readonly ReferenceFixture[] = [
  FIXTURE_06_COMPLEX,
  FIXTURE_07_DEEP_CHAIN,
  FIXTURE_08_BRANCHING,
  FIXTURE_09_KS_DATUM,
  FIXTURE_10_REF_GEOM_ONLY,
];
