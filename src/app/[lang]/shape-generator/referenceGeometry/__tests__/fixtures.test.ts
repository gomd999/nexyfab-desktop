/**
 * fixtures.test.ts — Wave 2 Phase 2 Track D3 spec §13.1 fixtures 01–05.
 *
 * For each fixture:
 *
 *   1. Resolve via the evaluator → check resolved values match the
 *      expected map (1e-6 mm tolerance).
 *   2. Round-trip through `.nfab` v3 serializer/parser → check the
 *      reloaded node list matches the original byte-for-byte.
 *   3. After reload, re-resolve → check resolved values still match.
 *
 * The round-trip step is the smoke check for the spec §6.4 v3 schema:
 * persisted ref-geom must come back deterministically.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_FIXTURES,
  type ExpectedShape,
} from './fixtures';
import { computeResolvedNodes } from '../evaluator';
import { resolveSketchPlane } from '../sketchPlaneAdapter';
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

function approxEqVec3(
  a: readonly number[],
  b: readonly number[],
): boolean {
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

/** Build a minimal `FeatureHistory` for the serializer. */
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

/** Round-trip a fixture's node list through the v3 .nfab serializer + parser
 *  and return the reloaded list. */
function roundTripNfab(nodes: readonly ReferenceNode[]): readonly ReferenceNode[] {
  const proj = serializeProject({
    name: 'fixture',
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

describe('reference geometry fixtures (W3, spec §13.1)', () => {
  for (const fixture of ALL_FIXTURES) {
    describe(fixture.name, () => {
      it('evaluator resolves every node to the expected shape', () => {
        const resolved = computeResolvedNodes(fixture.nodes);
        expect(
          resolved.errors.size,
          `${fixture.name} produced errors: ${JSON.stringify([...resolved.errors])}`,
        ).toBe(0);
        for (const [id, expected] of fixture.expected) {
          assertExpected(id, expected, resolved.values.get(id));
        }
      });

      it('round-trips through .nfab v3 serializer', () => {
        const reloaded = roundTripNfab(fixture.nodes);
        expect(reloaded.length).toBe(fixture.nodes.length);
        // Deep equality on the full node array — JSON serialization
        // strips function refs (there are none on `ReferenceNode`), so
        // structural equal-by-value is sufficient.
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

describe('sketchPlaneAdapter (W3, spec §6.3 / §10.1)', () => {
  it('resolves legacy literal "xy" to FRONT plane', () => {
    const r = resolveSketchPlane('xy', []);
    expect(r).not.toBeNull();
    expect(approxEqVec3(r!.normal, [0, 0, 1])).toBe(true);
  });

  it('resolves `standard` spec with offset', () => {
    const r = resolveSketchPlane(
      { kind: 'standard', plane: 'xy', offset: 25 },
      [],
    );
    expect(r).not.toBeNull();
    expect(approxEqVec3(r!.origin, [0, 0, 25])).toBe(true);
  });

  it('resolves `refGeom` spec via the store snapshot', () => {
    const fixture = ALL_FIXTURES[0]; // offset plane @ z=30
    const planeId = fixture.nodes[0].id;
    const r = resolveSketchPlane(
      { kind: 'refGeom', planeId },
      [...fixture.nodes],
    );
    expect(r).not.toBeNull();
    expect(approxEqVec3(r!.origin, [0, 0, 30])).toBe(true);
    expect(approxEqVec3(r!.normal, [0, 0, 1])).toBe(true);
  });

  it('returns null for refGeom spec pointing at unknown node', () => {
    const r = resolveSketchPlane(
      { kind: 'refGeom', planeId: 'missing' },
      [],
    );
    expect(r).toBeNull();
  });

  it('returns null when refGeom points at a non-plane node', () => {
    const axisFixture = ALL_FIXTURES[2]; // F-03: axis from 2 planes
    const axisId = axisFixture.nodes[0].id;
    const r = resolveSketchPlane(
      { kind: 'refGeom', planeId: axisId },
      [...axisFixture.nodes],
    );
    expect(r).toBeNull();
  });
});

describe('smoke: sketch can ride a ref-geom plane through .nfab', () => {
  it('SketchNodeData.planeSpec round-trips inside a .nfab v3 project', () => {
    // Build a minimal feature history with one sketchExtrude whose
    // `sketchData.planeSpec` points at a ref-geom plane node.
    const fixture = ALL_FIXTURES[0];
    const refGeomPlaneId = fixture.nodes[0].id;
    const history: FeatureHistory = {
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
          children: ['sk1'],
          editingActive: false,
          timestamp: 0,
        },
        {
          id: 'sk1',
          type: 'feature',
          label: 'Sketch Extrude 1',
          icon: '✏️',
          featureType: 'sketchExtrude',
          params: { depth: 25, planeOffset: 0 },
          enabled: true,
          expanded: true,
          parentId: 'root',
          children: [],
          editingActive: false,
          timestamp: 0,
          sketchData: {
            profile: { segments: [], closed: false },
            config: {
              mode: 'extrude',
              depth: 25,
              revolveAngle: 360,
              revolveAxis: 'y',
              segments: 32,
            },
            plane: 'xy',
            planeOffset: 0,
            operation: 'add',
            planeSpec: { kind: 'refGeom', planeId: refGeomPlaneId },
          },
        },
      ],
      rootId: 'root',
      activeNodeId: 'sk1',
      editingNodeId: null,
    };

    const proj = serializeProject({
      name: 'smoke',
      history,
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
      referenceGeometry: [...fixture.nodes],
    });

    const reloaded = parseProject(toJsonString(proj));
    const sk = reloaded.tree.nodes.find((n) => n.id === 'sk1');
    expect(sk).toBeDefined();
    expect(sk?.sketchData?.planeSpec).toEqual({
      kind: 'refGeom',
      planeId: refGeomPlaneId,
    });
    // And the ref-geom node id is still in the reloaded ref-geom list.
    expect(reloaded.referenceGeometry?.some((n) => n.id === refGeomPlaneId)).toBe(true);
  });
});
