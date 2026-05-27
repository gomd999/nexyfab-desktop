import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { flattenTree, countLeaves, leaf, group, type AssemblyTreeNode } from './assemblyTree';
import type { AssemblyBody } from './matesSolver';

function makeBody(name: string, x = 0, y = 0, z = 0): AssemblyBody {
  return {
    name,
    position: new THREE.Vector3(x, y, z),
    rotation: new THREE.Euler(0, 0, 0),
    fixed: false,
  };
}

describe('flattenTree · structure', () => {
  it('flattens a single leaf into one body', () => {
    const tree: AssemblyTreeNode = leaf(makeBody('a'));
    const r = flattenTree(tree);
    expect(r.bodies).toHaveLength(1);
    expect(r.bodies[0].name).toBe('a');
    expect(r.cyclesDetected).toBe(0);
  });

  it('flattens a group of leaves into N bodies with the group name prefixed', () => {
    const tree = group('wheel', [leaf(makeBody('hub')), leaf(makeBody('rim'))]);
    const r = flattenTree(tree);
    expect(r.bodies).toHaveLength(2);
    expect(r.bodies[0].name).toBe('wheel/hub');
    expect(r.bodies[1].name).toBe('wheel/rim');
  });

  it('composes a group transform into every descendant', () => {
    const tree = group('shifted',
      [leaf(makeBody('a', 10, 0, 0)), leaf(makeBody('b', 0, 5, 0))],
      { position: new THREE.Vector3(100, 0, 0) },
    );
    const r = flattenTree(tree);
    expect(r.bodies[0].position.x).toBeCloseTo(110);
    expect(r.bodies[1].position.x).toBeCloseTo(100);
    expect(r.bodies[1].position.y).toBeCloseTo(5);
  });

  it('handles nested groups (depth-2)', () => {
    const tree = group('car', [
      group('front-axle',
        [leaf(makeBody('hub', 0, 0, 0))],
        { position: new THREE.Vector3(0, 0, 50) }),
      group('rear-axle',
        [leaf(makeBody('hub', 0, 0, 0))],
        { position: new THREE.Vector3(0, 0, -50) }),
    ], { position: new THREE.Vector3(1000, 0, 0) });
    const r = flattenTree(tree);
    expect(r.bodies).toHaveLength(2);
    expect(r.bodies[0].name).toBe('car/front-axle/hub');
    expect(r.bodies[0].position.x).toBeCloseTo(1000);
    expect(r.bodies[0].position.z).toBeCloseTo(50);
    expect(r.bodies[1].position.z).toBeCloseTo(-50);
  });

  it('group rotation propagates to children (rotates child positions)', () => {
    const tree = group('rotated',
      [leaf(makeBody('a', 10, 0, 0))],
      { rotation: new THREE.Euler(0, Math.PI / 2, 0) }, // 90° around Y
    );
    const r = flattenTree(tree);
    // After 90° rotation around +Y, point (10, 0, 0) → (0, 0, -10).
    expect(r.bodies[0].position.x).toBeCloseTo(0, 4);
    expect(r.bodies[0].position.z).toBeCloseTo(-10, 4);
  });

  it('does not mutate the source bodies', () => {
    const srcBody = makeBody('a', 10, 0, 0);
    const tree = group('g', [leaf(srcBody)], { position: new THREE.Vector3(100, 0, 0) });
    flattenTree(tree);
    expect(srcBody.position.x).toBe(10); // original untouched
  });

  it('preserves the `fixed` flag and geometry reference', () => {
    const geo = new THREE.BufferGeometry();
    const body = makeBody('a');
    body.fixed = true;
    body.geometry = geo;
    const tree = group('g', [leaf(body)]);
    const r = flattenTree(tree);
    expect(r.bodies[0].fixed).toBe(true);
    expect(r.bodies[0].geometry).toBe(geo);
  });

  it('returns empty list for a group with no children', () => {
    const tree = group('empty', []);
    expect(flattenTree(tree).bodies).toHaveLength(0);
  });

  it('detects a cycle (group referencing itself) without infinite recursion', () => {
    const g: ReturnType<typeof group> = group('cycle', []);
    g.children.push(g); // self-reference
    const r = flattenTree(g);
    expect(r.cyclesDetected).toBeGreaterThan(0);
    // No bodies because the only child is the cycle.
    expect(r.bodies).toHaveLength(0);
  });
});

describe('countLeaves', () => {
  it('counts a single leaf as 1', () => {
    expect(countLeaves(leaf(makeBody('a')))).toBe(1);
  });

  it('counts leaves through a nested tree', () => {
    const tree = group('top', [
      group('inner', [leaf(makeBody('a')), leaf(makeBody('b'))]),
      leaf(makeBody('c')),
    ]);
    expect(countLeaves(tree)).toBe(3);
  });

  it('returns 0 for an empty group', () => {
    expect(countLeaves(group('empty', []))).toBe(0);
  });
});
