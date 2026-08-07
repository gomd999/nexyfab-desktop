import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyBooleanRobust, deterministicJitterGeometry } from './booleanRobust';

function cubeAt(x: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(10, 10, 10);
  geometry.translate(x, 0, 0);
  return geometry;
}

function meshVolume(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  const idx = geometry.index;
  const triangleCount = idx ? idx.count / 3 : pos.count / 3;
  let volume = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const i0 = idx ? idx.getX(triangle * 3) : triangle * 3;
    const i1 = idx ? idx.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const i2 = idx ? idx.getX(triangle * 3 + 2) : triangle * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(volume);
}

describe('applyBooleanRobust disjoint short-circuits', () => {
  it('preserves both disjoint solids for union and reports a valid faceted compound', () => {
    const result = applyBooleanRobust('union', cubeAt(0), cubeAt(100));
    expect(result).toMatchObject({ failure: null, attempts: 0, quality: { valid: true, grade: 'FACETED', metrics: { componentCount: 2 } } });
    expect(meshVolume(result.geometry!)).toBeCloseTo(2000, 0);
  });
  it('returns the unchanged base for a disjoint subtract', () => {
    const result = applyBooleanRobust('subtract', cubeAt(0), cubeAt(100));
    expect(result).toMatchObject({ failure: null, quality: { valid: true, grade: 'FACETED' } });
    expect(meshVolume(result.geometry!)).toBeCloseTo(1000, 0);
  });
  it('classifies an empty disjoint intersection explicitly', () => {
    const result = applyBooleanRobust('intersect', cubeAt(0), cubeAt(100));
    expect(result).toMatchObject({ geometry: null, failure: { kind: 'disjoint_inputs' }, quality: { valid: false, grade: 'FAILED' } });
  });
});

describe('applyBooleanRobust identical-input identities', () => {
  it('returns an explicit empty result for A minus A', () => {
    expect(applyBooleanRobust('subtract', cubeAt(0), cubeAt(0))).toMatchObject({ geometry: null, failure: { kind: 'identical_inputs' } });
  });
  it.each(['union', 'intersect'] as const)('%s returns the unchanged solid', operation => {
    const result = applyBooleanRobust(operation, cubeAt(0), cubeAt(0));
    expect(result).toMatchObject({ failure: null, quality: { valid: true, grade: 'FACETED' } });
    expect(meshVolume(result.geometry!)).toBeCloseTo(1000, 0);
  });
});

/** Volume-correct but genuinely open: a welded box with one face removed —
 *  its rim edges are covered by no collinear neighbour, unlike the CSG
 *  T-junction artifacts the watertight check deliberately tolerates. */
function openBox(): THREE.BufferGeometry {
  const solid = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
  const pos = solid.getAttribute('position') as THREE.BufferAttribute;
  const trimmed = new THREE.BufferGeometry();
  trimmed.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(pos.array as Float32Array).slice(0, (pos.count - 6) * 3), 3));
  return trimmed;
}

describe('applyBooleanRobust fail-closed topology gate', () => {
  it.each(['subtract', 'union'] as const)('rejects a volume-correct %s result with genuinely open boundaries', operation => {
    const result = applyBooleanRobust(operation, cubeAt(0), cubeAt(5), () => ({ geometry: openBox(), error: null }));
    expect(result.geometry).toBeNull();
    expect(result.failure).toMatchObject({ kind: 'invalid_result', issues: expect.arrayContaining(['error:watertight']) });
    expect(result.attempts).toBe(3);
    expect(result.hints.map(item => item.code)).toEqual(expect.arrayContaining(['retry-jitter', 'retry-weld']));
  });
  // Coplanar overlapping cubes are the pathological mesh-CSG case (shared
  // ±Y/±Z planes). The evaluator's output carries T-junction seams but is a
  // closed solid with the exact expected volume — the gate must let it pass.
  it.each([['subtract', 500], ['union', 1500]] as const)('%s of coplanar overlapping cubes passes with exact volume', (operation, expected) => {
    const result = applyBooleanRobust(operation, cubeAt(0), cubeAt(5));
    expect(result.failure).toBeNull();
    expect(result.quality.valid).toBe(true);
    expect(meshVolume(result.geometry!)).toBeCloseTo(expected, 0);
  });
});

describe('applyBooleanRobust deterministic recovery evidence', () => {
  it('produces byte-identical jitter and never mutates the source', () => {
    const source = cubeAt(0);
    const before = Array.from(source.attributes.position.array as ArrayLike<number>);
    const a = deterministicJitterGeometry(source, 0.001);
    const b = deterministicJitterGeometry(source, 0.001);
    expect(Array.from(a.attributes.position.array as ArrayLike<number>)).toEqual(Array.from(b.attributes.position.array as ArrayLike<number>));
    expect(Array.from(source.attributes.position.array as ArrayLike<number>)).toEqual(before);
  });
  it('rejects invalid jitter amounts', () => {
    expect(() => deterministicJitterGeometry(cubeAt(0), Number.NaN)).toThrow('jitter amount');
    expect(() => deterministicJitterGeometry(cubeAt(0), -1)).toThrow('jitter amount');
  });
});
