import { describe, it, expect } from 'vitest';
import {
  bakeNormalMap,
  analyzeBake,
  type MeshArrays,
} from './normalMapBaking';

function unitQuad(): MeshArrays {
  return {
    positions: [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ],
    indices: [0, 1, 2, 0, 2, 3],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  };
}

describe('bakeNormalMap', () => {
  it('produces texture of requested size', () => {
    const r = bakeNormalMap(unitQuad(), unitQuad(), { textureSize: 16 });
    expect(r.width).toBe(16);
    expect(r.height).toBe(16);
    expect(r.pixels.length).toBe(16 * 16 * 3);
  });

  it('missing UVs → returns neutral map with all misses', () => {
    const noUv = { ...unitQuad(), uvs: undefined };
    const r = bakeNormalMap(noUv, unitQuad(), { textureSize: 8 });
    expect(r.hits).toBe(0);
    expect(r.misses).toBeGreaterThan(0);
  });

  it('hits + misses both reported as non-negative', () => {
    const r = bakeNormalMap(unitQuad(), unitQuad(), { textureSize: 16 });
    expect(r.hits).toBeGreaterThanOrEqual(0);
    expect(r.misses).toBeGreaterThanOrEqual(0);
  });

  it('pixels are byte-packed', () => {
    const r = bakeNormalMap(unitQuad(), unitQuad(), { textureSize: 8 });
    for (let i = 0; i < r.pixels.length; i++) {
      expect(r.pixels[i]).toBeGreaterThanOrEqual(0);
      expect(r.pixels[i]).toBeLessThanOrEqual(255);
    }
  });
});

describe('analyzeBake', () => {
  it('reports hit fraction', () => {
    const map = { pixels: new Uint8Array(0), width: 0, height: 0, hits: 50, misses: 50 };
    const d = analyzeBake(map);
    expect(d.hitFraction).toBeCloseTo(0.5, 5);
  });

  it('zero total → 0 coverage', () => {
    const map = { pixels: new Uint8Array(0), width: 0, height: 0, hits: 0, misses: 0 };
    expect(analyzeBake(map).hitFraction).toBe(0);
  });
});

describe('bakeNormalMap — coplanar quad coincidence', () => {
  it('high-poly identical to low-poly → near-neutral normals', () => {
    const r = bakeNormalMap(unitQuad(), unitQuad(), { textureSize: 8 });
    // For coplanar surfaces, the tangent-space normal should be near (0, 0, 1) = (128, 128, 255).
    // We just verify that center pixels are in a sensible range.
    const centerIdx = (4 * 8 + 4) * 3;
    expect(r.pixels[centerIdx + 2]).toBeGreaterThan(100);
  });
});
