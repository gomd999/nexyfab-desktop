/**
 * holeRecovery.test.ts — the dependency-free hole-count recovery path.
 *
 * PROVES the fix for the "holesBuilt:0 on a part that has holes, bbox correct"
 * signature: when the rich `verifyStlBuffer` enrichment can't resolve its deep
 * `[lang]` analysis import in a production bundle, the server geometry adapter's
 * BASELINE must still surface the topological through-hole count (genus) straight
 * from the STL bytes, using only same-dir `./faceInspection`.
 *
 * We round-trip a real THREE geometry → binary STL bytes → `parseStlBufferToPositions`
 * → duck-typed geometry → `computeMeshTopology`, asserting the genus survives. A
 * torus is genus 1 (one through-hole); a cube is genus 0.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseStlBufferToPositions, parseStlBufferToBounds } from '../renderToGeometry';
import { computeMeshTopology } from '../faceInspection';

/** Serialize a non-indexed THREE geometry to a binary STL buffer. */
function toBinaryStl(geo: THREE.BufferGeometry): Uint8Array {
  const pos = geo.attributes.position.array as ArrayLike<number>;
  const triCount = Math.floor(pos.length / 9);
  const buf = new Uint8Array(84 + triCount * 50);
  const dv = new DataView(buf.buffer);
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    o += 12; // leave the normal as zeros (parser skips it)
    for (let k = 0; k < 9; k++) dv.setFloat32(o + k * 4, pos[t * 9 + k]!, true);
    o += 36 + 2;
  }
  return buf;
}

/** The exact baseline recovery the server adapter runs (genus from STL bytes). */
function recoveredGenus(bytes: Uint8Array): number | null {
  const positions = parseStlBufferToPositions(bytes);
  if (positions.length < 9) return null;
  const duck = {
    attributes: { position: { array: positions, count: positions.length / 3 } },
    index: null,
  } as unknown as THREE.BufferGeometry;
  return computeMeshTopology(duck).totalGenus;
}

describe('dependency-free hole-count recovery (parseStlBufferToPositions → genus)', () => {
  it('a torus (one through-hole) round-trips to genus 1', () => {
    const torus = new THREE.TorusGeometry(10, 3, 24, 48).toNonIndexed();
    const bytes = toBinaryStl(torus);
    expect(recoveredGenus(bytes)).toBe(1);
  });

  it('a solid cube (no hole) round-trips to genus 0', () => {
    const cube = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    const bytes = toBinaryStl(cube);
    expect(recoveredGenus(bytes)).toBe(0);
  });

  it('parseStlBufferToPositions preserves the vertex stream (bbox matches the bounds parser)', () => {
    const torus = new THREE.TorusGeometry(10, 3, 24, 48).toNonIndexed();
    const bytes = toBinaryStl(torus);
    const pos = parseStlBufferToPositions(bytes);
    const bounds = parseStlBufferToBounds(bytes);
    // recompute bbox from the position stream and compare to the bounds parser
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < pos.length; i += 3) { if (pos[i]! < minX) minX = pos[i]!; if (pos[i]! > maxX) maxX = pos[i]!; }
    expect(bounds.bbox).not.toBeNull();
    expect(minX).toBeCloseTo(bounds.bbox!.min[0], 3);
    expect(maxX).toBeCloseTo(bounds.bbox!.max[0], 3);
  });

  it('an ASCII STL parses the same vertex count as binary', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const pos = cube.attributes.position.array as ArrayLike<number>;
    const triCount = Math.floor(pos.length / 9);
    let ascii = 'solid t\n';
    for (let t = 0; t < triCount; t++) {
      ascii += 'facet normal 0 0 0\nouter loop\n';
      for (let v = 0; v < 3; v++) {
        const i = t * 9 + v * 3;
        ascii += `vertex ${pos[i]} ${pos[i + 1]} ${pos[i + 2]}\n`;
      }
      ascii += 'endloop\nendfacet\n';
    }
    ascii += 'endsolid t\n';
    const parsed = parseStlBufferToPositions(new TextEncoder().encode(ascii));
    expect(parsed.length).toBe(triCount * 9);
  });
});
