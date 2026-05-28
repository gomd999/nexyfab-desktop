/**
 * viz.test.ts — `buildReferenceMeshes` smoke tests.
 *
 * Wave 2 Phase 2 Track D3. Spec §8.
 *
 * The viz module is a Three.js builder, so we test the *structure* of
 * the returned `Object3D` array (count, names, positions) rather than
 * full GPU output. THREE itself is well-tested upstream; we only need
 * to verify the wiring.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ALL_FIXTURES,
  FIXTURE_01_OFFSET_PLANE,
  FIXTURE_03_AXIS_FROM_TWO_PLANES,
  FIXTURE_05_CSYS,
} from './fixtures';
import { buildReferenceMeshes, hashColor } from '../viz';
import type { ReferenceNode } from '../types';

describe('viz.buildReferenceMeshes (W3, spec §8)', () => {
  it('returns empty array for empty input', () => {
    expect(buildReferenceMeshes([])).toEqual([]);
  });

  it('builds one Object3D per non-hidden resolved node', () => {
    for (const fixture of ALL_FIXTURES) {
      const meshes = buildReferenceMeshes(fixture.nodes);
      expect(meshes.length, fixture.name).toBe(fixture.nodes.length);
    }
  });

  it('skips hidden nodes (spec §8 hidden flag)', () => {
    const hidden: ReferenceNode[] = [
      { ...FIXTURE_01_OFFSET_PLANE.nodes[0], hidden: true },
    ];
    const meshes = buildReferenceMeshes(hidden);
    expect(meshes.length).toBe(0);
  });

  it('skips errored nodes (spec §7.4)', () => {
    // Refgeom plane whose `parent` points at a missing node id → error.
    const errored: ReferenceNode[] = [
      {
        id: 'p_bad',
        kind: 'plane',
        method: 'offset',
        label: 'p_bad',
        hidden: false,
        dependsOn: ['missing'],
        evaluatedAt: 0,
        params: {
          method: 'offset',
          parent: { kind: 'reference', nodeId: 'missing' },
          distanceMm: 5,
          direction: 1,
        },
      },
    ];
    const meshes = buildReferenceMeshes(errored);
    expect(meshes.length).toBe(0);
  });

  it('places plane mesh at the resolved origin', () => {
    const meshes = buildReferenceMeshes(FIXTURE_01_OFFSET_PLANE.nodes);
    expect(meshes.length).toBe(1);
    const planeGroup = meshes[0] as THREE.Group;
    // Plane should be at z=30 per F-01.
    expect(planeGroup.position.z).toBeCloseTo(30, 6);
  });

  it('axis mesh is a THREE.Line', () => {
    const meshes = buildReferenceMeshes(FIXTURE_03_AXIS_FROM_TWO_PLANES.nodes);
    expect(meshes.length).toBe(1);
    expect(meshes[0]).toBeInstanceOf(THREE.Line);
  });

  it('CSys mesh is a Group with 4 children (3 axes + origin marker)', () => {
    const meshes = buildReferenceMeshes(FIXTURE_05_CSYS.nodes);
    expect(meshes.length).toBe(1);
    const csysGroup = meshes[0] as THREE.Group;
    expect(csysGroup).toBeInstanceOf(THREE.Group);
    expect(csysGroup.children.length).toBe(4);
  });

  it('tags each object with `name` and `userData.referenceNodeId`', () => {
    const meshes = buildReferenceMeshes(FIXTURE_01_OFFSET_PLANE.nodes);
    expect(meshes[0].name).toContain('refgeom:plane:');
    expect(meshes[0].userData.referenceNodeId).toBe(
      FIXTURE_01_OFFSET_PLANE.nodes[0].id,
    );
  });
});

describe('viz.hashColor', () => {
  it('returns a deterministic color for the same id', () => {
    const a = hashColor('abc');
    const b = hashColor('abc');
    expect(a.getHex()).toBe(b.getHex());
  });

  it('different ids produce different colors most of the time', () => {
    const a = hashColor('id-one');
    const b = hashColor('id-two');
    expect(a.getHex()).not.toBe(b.getHex());
  });
});
