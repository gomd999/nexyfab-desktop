import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { expandPattern, type LinearComponentPattern, type CircularComponentPattern } from './componentPattern';
import type { AssemblyBody } from './matesSolver';

function makeBody(name: string, x = 0, y = 0, z = 0): AssemblyBody {
  return {
    name,
    position: new THREE.Vector3(x, y, z),
    rotation: new THREE.Euler(0, 0, 0),
    fixed: false,
  };
}

describe('expandPattern · linear', () => {
  it('emits count-1 clones (source kept in caller) when includeSource = true', () => {
    const source = makeBody('hole', 10, 0, 0);
    const pattern: LinearComponentPattern = {
      kind: 'linear',
      sourceBodyIndex: 0,
      count: 4,
      direction: new THREE.Vector3(1, 0, 0),
      spacing: 20,
    };
    const clones = expandPattern([source], pattern);
    expect(clones).toHaveLength(3);
    expect(clones[0].position.x).toBeCloseTo(30); // source.x (10) + spacing (20)
    expect(clones[1].position.x).toBeCloseTo(50);
    expect(clones[2].position.x).toBeCloseTo(70);
  });

  it('emits count clones when includeSource = false', () => {
    const source = makeBody('hole', 0, 0, 0);
    const pattern: LinearComponentPattern = {
      kind: 'linear',
      sourceBodyIndex: 0,
      count: 3,
      direction: new THREE.Vector3(0, 1, 0),
      spacing: 10,
      includeSource: false,
    };
    const clones = expandPattern([source], pattern);
    expect(clones).toHaveLength(3);
    expect(clones[0].position.y).toBeCloseTo(10);
    expect(clones[1].position.y).toBeCloseTo(20);
    expect(clones[2].position.y).toBeCloseTo(30);
  });

  it('normalises a non-unit direction vector', () => {
    const source = makeBody('hole', 0, 0, 0);
    const pattern: LinearComponentPattern = {
      kind: 'linear',
      sourceBodyIndex: 0,
      count: 2,
      direction: new THREE.Vector3(3, 4, 0), // length 5 → normalised to (0.6, 0.8, 0)
      spacing: 10,
      includeSource: false,
    };
    const clones = expandPattern([source], pattern);
    expect(clones[0].position.x).toBeCloseTo(6, 3);
    expect(clones[0].position.y).toBeCloseTo(8, 3);
  });

  it('preserves orientation across clones (rotation copied)', () => {
    const source = makeBody('hole', 0, 0, 0);
    source.rotation.set(0, Math.PI / 4, 0);
    const clones = expandPattern([source], {
      kind: 'linear', sourceBodyIndex: 0, count: 3,
      direction: new THREE.Vector3(1, 0, 0), spacing: 5,
    });
    for (const c of clones) {
      expect(c.rotation.y).toBeCloseTo(Math.PI / 4);
    }
  });

  it('returns [] when count = 0 or 1 with includeSource=true', () => {
    const source = makeBody('h', 0, 0, 0);
    const p0: LinearComponentPattern = {
      kind: 'linear', sourceBodyIndex: 0, count: 0,
      direction: new THREE.Vector3(1, 0, 0), spacing: 10,
    };
    expect(expandPattern([source], p0)).toHaveLength(0);
    const p1: LinearComponentPattern = {
      kind: 'linear', sourceBodyIndex: 0, count: 1,
      direction: new THREE.Vector3(1, 0, 0), spacing: 10,
    };
    expect(expandPattern([source], p1)).toHaveLength(0); // count-1 = 0
  });

  it('returns [] for zero-length direction', () => {
    const source = makeBody('h');
    const pattern: LinearComponentPattern = {
      kind: 'linear', sourceBodyIndex: 0, count: 4,
      direction: new THREE.Vector3(0, 0, 0), spacing: 10,
    };
    expect(expandPattern([source], pattern)).toHaveLength(0);
  });

  it('returns [] when sourceBodyIndex is out of range', () => {
    const source = makeBody('h');
    const pattern: LinearComponentPattern = {
      kind: 'linear', sourceBodyIndex: 99, count: 4,
      direction: new THREE.Vector3(1, 0, 0), spacing: 10,
    };
    expect(expandPattern([source], pattern)).toHaveLength(0);
  });
});

describe('expandPattern · circular', () => {
  it('places 6 instances around full circle (60° step)', () => {
    const source = makeBody('blade', 10, 0, 0); // 10mm off-centre
    const pattern: CircularComponentPattern = {
      kind: 'circular',
      sourceBodyIndex: 0,
      count: 6,
      axis: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(0, 0, 0),
      totalAngleDeg: 360,
      includeSource: false,
    };
    const clones = expandPattern([source], pattern);
    expect(clones).toHaveLength(6);
    // All clones should be 10mm from centre.
    for (const c of clones) {
      expect(c.position.length()).toBeCloseTo(10, 3);
    }
  });

  it('partial arc (180°) with includeSource = false → count steps', () => {
    const source = makeBody('blade', 10, 0, 0);
    const pattern: CircularComponentPattern = {
      kind: 'circular',
      sourceBodyIndex: 0,
      count: 3,
      axis: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(0, 0, 0),
      totalAngleDeg: 180,
      includeSource: false,
    };
    const clones = expandPattern([source], pattern);
    expect(clones).toHaveLength(3);
    // First step is 180/3 = 60°. So clone 0 should be at (cos60°·10, 0, -sin60°·10) — wait,
    // rotation around +Y by +60° turns +X toward -Z. Let me just check magnitudes.
    for (const c of clones) {
      expect(c.position.length()).toBeCloseTo(10, 3);
    }
  });

  it('includeSource=true distributes count-1 clones across the full sweep', () => {
    const source = makeBody('blade', 10, 0, 0);
    const pattern: CircularComponentPattern = {
      kind: 'circular',
      sourceBodyIndex: 0,
      count: 4,
      axis: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(0, 0, 0),
      totalAngleDeg: 360,
    };
    const clones = expandPattern([source], pattern);
    // count=4 with includeSource → 3 clones at 120°, 240°, 360°.
    expect(clones).toHaveLength(3);
  });

  it('rotates body orientation too (not just translation)', () => {
    const source = makeBody('blade', 10, 0, 0);
    const pattern: CircularComponentPattern = {
      kind: 'circular',
      sourceBodyIndex: 0,
      count: 4,
      axis: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(0, 0, 0),
      totalAngleDeg: 360,
      includeSource: false,
    };
    const clones = expandPattern([source], pattern);
    // First clone rotated 90° around +Y → its local +X (rotation.y = π/2).
    expect(Math.abs(clones[0].rotation.y - Math.PI / 2)).toBeLessThan(0.01);
  });

  it('uses the centre as the pivot (not the world origin)', () => {
    const source = makeBody('blade', 100, 0, 0);
    const pattern: CircularComponentPattern = {
      kind: 'circular',
      sourceBodyIndex: 0,
      count: 4,
      axis: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(50, 0, 0),
      totalAngleDeg: 360,
      includeSource: false,
    };
    const clones = expandPattern([source], pattern);
    // All clones should be 50mm from the centre (source was at 100, centre at 50).
    for (const c of clones) {
      const distFromCenter = c.position.distanceTo(pattern.center);
      expect(distFromCenter).toBeCloseTo(50, 3);
    }
  });

  it('returns [] for zero-axis or count 0', () => {
    const source = makeBody('b', 10, 0, 0);
    expect(expandPattern([source], {
      kind: 'circular', sourceBodyIndex: 0, count: 4,
      axis: new THREE.Vector3(0, 0, 0),
      center: new THREE.Vector3(0, 0, 0),
      totalAngleDeg: 360,
    })).toHaveLength(0);

    expect(expandPattern([source], {
      kind: 'circular', sourceBodyIndex: 0, count: 0,
      axis: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(0, 0, 0),
      totalAngleDeg: 360,
    })).toHaveLength(0);
  });
});
