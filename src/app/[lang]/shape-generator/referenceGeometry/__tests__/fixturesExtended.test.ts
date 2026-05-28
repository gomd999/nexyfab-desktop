/**
 * fixturesExtended.test.ts — W4 spec §13.1 fixtures 06-10.
 *
 * Mirrors `fixtures.test.ts` but covers fixtures 06-10:
 *   - 06: complex 8-item mixed-kind fixture
 *   - 07: deep chain (10 planes)
 *   - 08: branching (1 parent → 4 children)
 *   - 09: KS datum label round-trip
 *   - 10: ref-geom-only project
 *
 * Each fixture is checked for:
 *   1. evaluator resolution within 1e-6 mm of `expected`
 *   2. .nfab v3 round-trip — reloaded node list equals the original
 *   3. re-resolution after round-trip still matches `expected`
 *
 * F-REFGEOM-09 additionally asserts the KS datum letter assignment
 * survives the round-trip — the key W4 acceptance criterion for the
 * `ksConventions` module.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_FIXTURES_EXTENDED,
  FIXTURE_09_KS_DATUM,
  FIXTURE_09_EXPECTED_KS,
} from './fixturesExtended';
import type { ExpectedShape, ReferenceFixture } from './fixtures';
import { computeResolvedNodes } from '../evaluator';
import { buildKsDatumLabels } from '../ksConventions';
import type { ReferenceNode, ResolvedValue } from '../types';
import {
  serializeProject,
  parseProject,
  toJsonString,
} from '../../io/nfabFormat';
import type { FeatureHistory } from '../../useFeatureStack';

const TOLERANCE = 1e-6;

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) < TOLERANCE;
}

function approxEqVec3(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== 3 || b.length !== 3) return false;
  return approxEq(a[0], b[0]) && approxEq(a[1], b[1]) && approxEq(a[2], b[2]);
}

function assertExpected(
  id: string,
  expected: ExpectedShape,
  actual: ResolvedValue | undefined,
): void {
  expect(actual, `no resolved value for ${id}`).toBeDefined();
  if (actual === undefined) return;
  expect(actual.kind).toBe(expected.kind);
  switch (expected.kind) {
    case 'plane':
      if (actual.kind !== 'plane') throw new Error(`expected plane for ${id}`);
      expect(approxEqVec3(actual.value.origin, expected.origin)).toBe(true);
      expect(approxEqVec3(actual.value.normal, expected.normal)).toBe(true);
      break;
    case 'axis':
      if (actual.kind !== 'axis') throw new Error(`expected axis for ${id}`);
      expect(approxEqVec3(actual.value.origin, expected.origin)).toBe(true);
      expect(approxEqVec3(actual.value.direction, expected.direction)).toBe(true);
      break;
    case 'point':
      if (actual.kind !== 'point') throw new Error(`expected point for ${id}`);
      expect(approxEqVec3(actual.value.position, expected.position)).toBe(true);
      break;
    case 'csys':
      if (actual.kind !== 'csys') throw new Error(`expected csys for ${id}`);
      expect(approxEqVec3(actual.value.origin, expected.origin)).toBe(true);
      expect(approxEqVec3(actual.value.xAxis, expected.xAxis)).toBe(true);
      expect(approxEqVec3(actual.value.yAxis, expected.yAxis)).toBe(true);
      expect(approxEqVec3(actual.value.zAxis, expected.zAxis)).toBe(true);
      break;
  }
}

function emptyHistory(): FeatureHistory {
  return {
    nodes: [
      {
        id: 'root',
        type: 'baseShape',
        label: 'Base Shape',
        icon: '📦',
        params: {},
        enabled: true,
        expanded: true,
        parentId: null,
        children: [],
        editingActive: false,
        timestamp: 0,
      },
    ],
    rootId: 'root',
    activeNodeId: 'root',
    editingNodeId: null,
  };
}

function roundTripNfab(nodes: readonly ReferenceNode[]): readonly ReferenceNode[] {
  const proj = serializeProject({
    name: 'fixture-extended',
    history: emptyHistory(),
    scene: {
      selectedId: 'box',
      params: {},
      paramExpressions: {},
      materialId: 'aluminum',
      color: '#4FC3F7',
      isSketchMode: false,
      sketchPlane: 'xy',
      sketchProfile: { segments: [], closed: false },
      sketchConfig: {
        mode: 'extrude',
        depth: 50,
        revolveAngle: 360,
        revolveAxis: 'y',
        segments: 32,
      },
    },
    referenceGeometry: [...nodes],
  });
  const json = toJsonString(proj);
  const reloaded = parseProject(json);
  return reloaded.referenceGeometry ?? [];
}

describe('reference geometry fixtures 06-10 (W4, spec §13.1)', () => {
  for (const fixture of ALL_FIXTURES_EXTENDED as readonly ReferenceFixture[]) {
    describe(fixture.name, () => {
      it('evaluator resolves every node to the expected shape', () => {
        const resolved = computeResolvedNodes(fixture.nodes);
        expect(
          resolved.errors.size,
          `${fixture.name} produced errors: ${JSON.stringify([
            ...resolved.errors,
          ])}`,
        ).toBe(0);
        for (const [id, expected] of fixture.expected) {
          assertExpected(id, expected, resolved.values.get(id));
        }
      });

      it('round-trips through .nfab v3 serializer', () => {
        const reloaded = roundTripNfab(fixture.nodes);
        expect(reloaded.length).toBe(fixture.nodes.length);
        expect(JSON.parse(JSON.stringify(reloaded))).toEqual(
          JSON.parse(JSON.stringify(fixture.nodes)),
        );
      });

      it('reloaded nodes re-resolve to the same values', () => {
        const reloaded = roundTripNfab(fixture.nodes);
        const resolved = computeResolvedNodes(reloaded);
        for (const [id, expected] of fixture.expected) {
          assertExpected(id, expected, resolved.values.get(id));
        }
      });
    });
  }
});

// ─── F-REFGEOM-09 specifics ────────────────────────────────────

describe('F-REFGEOM-09: KS datum label assignment + round-trip', () => {
  it('assigns KS letters per kind in creation order (A, B, C / A\', B\' / a / [A])', () => {
    const labels = buildKsDatumLabels(FIXTURE_09_KS_DATUM.nodes);
    for (const [id, expectedLetter] of FIXTURE_09_EXPECTED_KS) {
      expect(labels.get(id), `KS letter for ${id}`).toBe(expectedLetter);
    }
  });

  it('KS letter assignment survives .nfab round-trip', () => {
    const reloaded = roundTripNfab(FIXTURE_09_KS_DATUM.nodes);
    const labels = buildKsDatumLabels(reloaded);
    for (const [id, expectedLetter] of FIXTURE_09_EXPECTED_KS) {
      expect(labels.get(id), `post-roundtrip KS letter for ${id}`).toBe(
        expectedLetter,
      );
    }
  });

  it('every node in F-09 gets a non-empty KS letter', () => {
    const labels = buildKsDatumLabels(FIXTURE_09_KS_DATUM.nodes);
    for (const n of FIXTURE_09_KS_DATUM.nodes) {
      const letter = labels.get(n.id);
      expect(letter).toBeTruthy();
      expect(letter!.length).toBeGreaterThan(0);
    }
  });
});

// ─── F-REFGEOM-07 specifics — toposort depth ───────────────────

describe('F-REFGEOM-07: deep chain integrity', () => {
  it('produces 10 distinct planes in monotonic +Z order', () => {
    // Find by index because the fixture builder is iterative.
    const fx = ALL_FIXTURES_EXTENDED[1]; // F-07
    const resolved = computeResolvedNodes(fx.nodes);
    let prevZ: number | null = null;
    for (let i = 0; i < 10; i += 1) {
      const id = `p_chain_${i}`;
      const v = resolved.values.get(id);
      expect(v).toBeDefined();
      if (v?.kind !== 'plane') throw new Error('expected plane');
      const z = v.value.origin[2];
      if (prevZ !== null) {
        expect(z).toBeGreaterThan(prevZ);
      }
      prevZ = z;
    }
  });
});

// ─── F-REFGEOM-08 specifics — branching ─────────────────────────

describe('F-REFGEOM-08: branching tree integrity', () => {
  it('produces 4 children all dependent on the same parent', () => {
    const fx = ALL_FIXTURES_EXTENDED[2]; // F-08
    for (let i = 0; i < 4; i += 1) {
      const id = `p_child_${i}`;
      const node = fx.nodes.find((n) => n.id === id);
      expect(node).toBeDefined();
      expect(node!.dependsOn).toContain('p_root');
    }
  });

  it('resolves all 4 children + root in one pass', () => {
    const fx = ALL_FIXTURES_EXTENDED[2]; // F-08
    const resolved = computeResolvedNodes(fx.nodes);
    expect(resolved.errors.size).toBe(0);
    expect(resolved.values.size).toBe(5);
  });
});

// ─── F-REFGEOM-10 specifics — standalone ref-geom ───────────────

describe('F-REFGEOM-10: ref-geom-only project', () => {
  it('serializes + reloads with no feature-tree content', () => {
    const fx = ALL_FIXTURES_EXTENDED[4]; // F-10
    const proj = serializeProject({
      name: 'standalone',
      history: emptyHistory(),
      scene: {
        selectedId: 'box',
        params: {},
        paramExpressions: {},
        materialId: 'aluminum',
        color: '#4FC3F7',
        isSketchMode: false,
        sketchPlane: 'xy',
        sketchProfile: { segments: [], closed: false },
        sketchConfig: {
          mode: 'extrude',
          depth: 50,
          revolveAngle: 360,
          revolveAxis: 'y',
          segments: 32,
        },
      },
      referenceGeometry: [...fx.nodes],
    });
    const reloaded = parseProject(toJsonString(proj));
    expect(reloaded.referenceGeometry).toBeDefined();
    expect(reloaded.referenceGeometry?.length).toBe(fx.nodes.length);
    // Feature tree has only the root (no sketches) — standalone case.
    expect(reloaded.tree.nodes.length).toBe(1);
    expect(reloaded.tree.nodes[0].id).toBe('root');
  });
});
