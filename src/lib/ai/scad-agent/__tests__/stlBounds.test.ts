import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseStlBufferToBounds, countStlTriangles } from '../renderToGeometry';

/**
 * Plumbing proof for the reconstruction gate: a rendered STL must ALWAYS
 * yield a real bbox, independent of the (fragile, deep-import) rich
 * verification chain. parseStlBufferToBounds is that guaranteed path —
 * pure Buffer/string arithmetic, no three/examples, no app-route modules.
 */

/** Serialize non-indexed positions into a BINARY STL (the binstl the render
 *  path emits with --export-format=binstl). Header carries OpenSCAD-style text
 *  to prove the parser tolerates a non-zero header. */
function binaryStl(positions: ArrayLike<number>): Uint8Array {
  const triCount = Math.floor(positions.length / 9);
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write('OpenSCAD Model', 0, 'ascii');
  buf.writeUInt32LE(triCount, 80);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    o += 12; // face normal (unused)
    for (let v = 0; v < 9; v++) { buf.writeFloatLE(positions[t * 9 + v]!, o); o += 4; }
    o += 2; // attribute byte count
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Serialize into ASCII STL (OpenSCAD's default when --export-format is
 *  omitted, as in runOpenScadCli). */
function asciiStl(positions: ArrayLike<number>): Uint8Array {
  const triCount = Math.floor(positions.length / 9);
  let s = 'solid OpenSCAD_Model\n';
  for (let t = 0; t < triCount; t++) {
    s += ' facet normal 0 0 0\n  outer loop\n';
    for (let v = 0; v < 3; v++) {
      const i = t * 9 + v * 3;
      s += `   vertex ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}\n`;
    }
    s += '  endloop\n endfacet\n';
  }
  s += 'endsolid OpenSCAD_Model\n';
  return new Uint8Array(Buffer.from(s, 'ascii'));
}

// A 20 x 30 x 10 box centred at the origin -> bbox [-10,-15,-5] .. [10,15,5].
function boxPositions(w = 20, h = 30, d = 10): Float32Array {
  return new THREE.BoxGeometry(w, h, d).toNonIndexed().attributes.position.array as Float32Array;
}

describe('parseStlBufferToBounds — dependency-free STL bbox (gate plumbing)', () => {
  it('BINARY STL cube 20x30x10 -> correct bbox, 12 triangles, ~6000mm3 volume', () => {
    const b = parseStlBufferToBounds(binaryStl(boxPositions(20, 30, 10)));
    expect(b.triangleCount).toBe(12);
    expect(b.bbox).not.toBeNull();
    expect(b.bbox!.min).toEqual([-10, -15, -5]);
    expect(b.bbox!.max).toEqual([10, 15, 5]);
    // extents are exactly the requested dimensions
    expect(b.bbox!.max[0] - b.bbox!.min[0]).toBeCloseTo(20, 5);
    expect(b.bbox!.max[1] - b.bbox!.min[1]).toBeCloseTo(30, 5);
    expect(b.bbox!.max[2] - b.bbox!.min[2]).toBeCloseTo(10, 5);
    expect(b.volume_mm3).toBeCloseTo(6000, 1); // 20*30*10
  });

  it('ASCII STL cube 20x30x10 -> same bbox (default OpenSCAD format handled too)', () => {
    const b = parseStlBufferToBounds(asciiStl(boxPositions(20, 30, 10)));
    expect(b.triangleCount).toBe(12);
    expect(b.bbox!.min).toEqual([-10, -15, -5]);
    expect(b.bbox!.max).toEqual([10, 15, 5]);
    expect(b.volume_mm3).toBeCloseTo(6000, 1);
  });

  it('countStlTriangles agrees for both binary and ASCII', () => {
    expect(countStlTriangles(binaryStl(boxPositions()))).toBe(12);
    expect(countStlTriangles(asciiStl(boxPositions()))).toBe(12);
  });

  it('a corrupt binary header claiming too many faces does not over-read', () => {
    const good = binaryStl(boxPositions());
    const buf = Buffer.from(good);
    buf.writeUInt32LE(9_999_999, 80); // lie about the face count
    const b = parseStlBufferToBounds(new Uint8Array(buf));
    // clamped to what the buffer actually holds; still a finite bbox
    expect(b.triangleCount).toBe(12);
    expect(b.bbox).not.toBeNull();
  });

  it('an empty (zero-triangle) STL yields bbox: null, not a throw', () => {
    const empty = Buffer.alloc(84); // valid binary header, 0 faces
    const b = parseStlBufferToBounds(new Uint8Array(empty));
    expect(b.triangleCount).toBe(0);
    expect(b.bbox).toBeNull();
    expect(b.volume_mm3).toBe(0);
  });
});
