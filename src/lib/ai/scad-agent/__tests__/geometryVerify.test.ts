import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { verifyStlBuffer } from '../serverAdapters';

/** Serialize a non-indexed positions array into a binary STL Buffer. The
 *  80-byte header is left zero (so it isn't mistaken for ASCII "solid"). */
function binaryStl(positions: ArrayLike<number>): Buffer {
  const triCount = Math.floor(positions.length / 9);
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.writeUInt32LE(triCount, 80);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    o += 12; // normal left as (0,0,0) — STLLoader uses vertices, not this
    for (let v = 0; v < 9; v++) {
      buf.writeFloatLE(positions[t * 9 + v]!, o);
      o += 4;
    }
    o += 2; // attribute byte count
  }
  return buf;
}

function cubePositions(s = 20): Float32Array {
  return new THREE.BoxGeometry(s, s, s).toNonIndexed().attributes.position.array as Float32Array;
}

describe('verifyStlBuffer — real geometry verification of rendered STL', () => {
  it('a closed cube STL is reported watertight + manifold (not just "compiled")', async () => {
    const stats = await verifyStlBuffer(binaryStl(cubePositions(20)));
    expect(stats.watertight).toBe(true);
    expect(stats.manifold).toBe(true);
    expect(stats.componentCount).toBe(1);
    expect(stats.triangleCount).toBe(12);
    expect(stats.volume_mm3!).toBeGreaterThan(7000); // ~8000 for a 20mm cube
    expect(stats.issues).toBeUndefined();
    expect(stats.bbox).toBeDefined();
  });

  it('an open mesh (a face removed) is flagged not-watertight with a critique', async () => {
    const full = cubePositions(20);
    const open = full.slice(0, full.length - 2 * 9); // drop one face (2 tris)
    const stats = await verifyStlBuffer(binaryStl(open));
    expect(stats.watertight).toBe(false);
    expect(stats.manifold).toBe(false);
    expect(stats.issues).toMatch(/watertight/i);
  });

  it('two disjoint cubes report 2 bodies', async () => {
    const a = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    const b = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    b.translate(100, 0, 0);
    const ap = a.attributes.position.array as Float32Array;
    const bp = b.attributes.position.array as Float32Array;
    const merged = new Float32Array(ap.length + bp.length);
    merged.set(ap, 0); merged.set(bp, ap.length);
    const stats = await verifyStlBuffer(binaryStl(merged));
    expect(stats.componentCount).toBe(2);
  });
});
