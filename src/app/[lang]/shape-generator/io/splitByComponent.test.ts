import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { splitGeometryByConnectedComponent, connectedComponentCount } from './splitByComponent';

/** Merge several geometries into one triangle soup (no shared vertices), the
 *  way a multi-body STL export looks. */
function soup(...geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.attributes.position;
    for (let i = 0; i < p.count; i++) positions.push(p.getX(i), p.getY(i), p.getZ(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return out;
}

function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position; const idx = geo.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(v);
}

describe('splitGeometryByConnectedComponent', () => {
  it('splits a 3-body soup into 3 separate parts', () => {
    const a = new THREE.BoxGeometry(10, 10, 10).translate(-50, 0, 0);
    const b = new THREE.BoxGeometry(10, 10, 10).translate(0, 0, 0);
    const c = new THREE.SphereGeometry(6, 16, 12).translate(50, 0, 0);
    const merged = soup(a, b, c);
    expect(connectedComponentCount(merged)).toBe(3);
    const parts = splitGeometryByConnectedComponent(merged);
    expect(parts).toHaveLength(3);
    // every part is a non-empty closed-ish shell
    for (const p of parts) expect(p.attributes.position.count).toBeGreaterThan(0);
  });

  it('a single solid stays one part', () => {
    const one = new THREE.BoxGeometry(20, 20, 20);
    const parts = splitGeometryByConnectedComponent(one);
    expect(parts).toHaveLength(1);
  });

  it('two touching-but-coincident boxes weld into ONE component', () => {
    // share a face exactly → welded vertices connect them.
    const a = new THREE.BoxGeometry(10, 10, 10).translate(-5, 0, 0);
    const b = new THREE.BoxGeometry(10, 10, 10).translate(5, 0, 0);
    expect(connectedComponentCount(soup(a, b))).toBe(1);
  });

  it('conserves total volume across the split (sum of parts ≈ original)', () => {
    const a = new THREE.BoxGeometry(10, 10, 10).translate(-40, 0, 0);
    const b = new THREE.BoxGeometry(20, 6, 20).translate(40, 0, 0);
    const merged = soup(a, b);
    const parts = splitGeometryByConnectedComponent(merged);
    const sum = parts.reduce((s, p) => s + meshVolume(p), 0);
    expect(sum).toBeCloseTo(meshVolume(soup(a)) + meshVolume(soup(b)), 1);
    // 10³=1000, 20*6*20=2400 → ~3400
    expect(sum).toBeGreaterThan(3300);
    expect(sum).toBeLessThan(3500);
  });

  it('drops sub-minTriangles noise shells', () => {
    const big = new THREE.BoxGeometry(20, 20, 20).translate(-30, 0, 0); // 12 tris
    const tiny = new THREE.PlaneGeometry(0.1, 0.1).translate(40, 0, 0);  // 2 tris
    const parts = splitGeometryByConnectedComponent(soup(big, tiny), 4);
    expect(parts).toHaveLength(1); // tiny (2 tris) dropped
  });
});
