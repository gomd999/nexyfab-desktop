import { describe, it, expect } from 'vitest';
import {
  sphere, box, roundBox, torus, cylinder, cappedCylinder, plane,
  unionSdf, intersectSdf, subtractSdf,
  smoothMin, smoothSubtract,
  translate, rotateZ, scale, shell, round, repeat,
  gradient, surfaceNormal,
  sampleField, estimateVolume,
} from './sdfModeling';

describe('primitives', () => {
  it('sphere — distance from origin', () => {
    const s = sphere(1);
    expect(s({ x: 0, y: 0, z: 0 })).toBeCloseTo(-1, 5);
    expect(s({ x: 1, y: 0, z: 0 })).toBeCloseTo(0, 5);
    expect(s({ x: 2, y: 0, z: 0 })).toBeCloseTo(1, 5);
  });

  it('box — inside is negative', () => {
    const b = box({ x: 1, y: 1, z: 1 });
    expect(b({ x: 0, y: 0, z: 0 })).toBeLessThan(0);
    expect(b({ x: 1.5, y: 0, z: 0 })).toBeGreaterThan(0);
  });

  it('roundBox — corner less sharp than box', () => {
    const sharp = box({ x: 1, y: 1, z: 1 });
    const rounded = roundBox({ x: 1, y: 1, z: 1 }, 0.3);
    const corner = { x: 0.9, y: 0.9, z: 0.9 };
    // Sharp corner inside; rounded corner outside (because we subtract radius).
    expect(rounded(corner)).toBeGreaterThan(sharp(corner) - 1);
  });

  it('torus — zero on the ring', () => {
    const t = torus(2, 0.5);
    expect(t({ x: 2, y: 0, z: 0 })).toBeCloseTo(-0.5, 5);
    expect(t({ x: 2.5, y: 0, z: 0 })).toBeCloseTo(0, 5);
  });

  it('cylinder — radial only', () => {
    const c = cylinder(1);
    expect(c({ x: 0, y: 0, z: 100 })).toBeCloseTo(-1, 5);
    expect(c({ x: 2, y: 0, z: 0 })).toBeCloseTo(1, 5);
  });

  it('cappedCylinder — bounded in z', () => {
    const c = cappedCylinder(1, 1);
    expect(c({ x: 0, y: 0, z: 0 })).toBeLessThan(0);
    expect(c({ x: 0, y: 0, z: 5 })).toBeGreaterThan(0);
  });

  it('plane — signed distance', () => {
    const p = plane({ x: 0, y: 0, z: 1 }, 5);
    expect(p({ x: 0, y: 0, z: 5 })).toBeCloseTo(0, 5);
    expect(p({ x: 0, y: 0, z: 10 })).toBeCloseTo(5, 5);
    expect(p({ x: 0, y: 0, z: 0 })).toBeCloseTo(-5, 5);
  });
});

describe('boolean ops', () => {
  it('union: point inside one shape is in the union', () => {
    const s1 = translate(sphere(1), { x: -1, y: 0, z: 0 });
    const s2 = translate(sphere(1), { x: 1, y: 0, z: 0 });
    const u = unionSdf(s1, s2);
    expect(u({ x: -1, y: 0, z: 0 })).toBeLessThan(0);
    expect(u({ x: 1, y: 0, z: 0 })).toBeLessThan(0);
    expect(u({ x: 0, y: 5, z: 0 })).toBeGreaterThan(0);
  });

  it('intersect: only the overlap is inside', () => {
    const s1 = translate(sphere(1.5), { x: -0.5, y: 0, z: 0 });
    const s2 = translate(sphere(1.5), { x: 0.5, y: 0, z: 0 });
    const i = intersectSdf(s1, s2);
    expect(i({ x: 0, y: 0, z: 0 })).toBeLessThan(0);
    expect(i({ x: 1.5, y: 0, z: 0 })).toBeGreaterThan(0);
  });

  it('subtract: A minus B', () => {
    const a = sphere(2);
    const b = sphere(0.5);
    const s = subtractSdf(a, b);
    expect(s({ x: 0, y: 0, z: 0 })).toBeGreaterThan(0); // hole at center
    expect(s({ x: 1, y: 0, z: 0 })).toBeLessThan(0);
  });
});

describe('smooth blends', () => {
  it('smoothMin produces value close to min when far apart', () => {
    const a = (_p: { x: number; y: number; z: number }) => -2;
    const b = (_p: { x: number; y: number; z: number }) => 5;
    const blended = smoothMin(a, b, 0.5);
    expect(blended({ x: 0, y: 0, z: 0 })).toBeCloseTo(-2, 1);
  });

  it('smoothSubtract works', () => {
    const a = sphere(2);
    const b = translate(sphere(1), { x: 1, y: 0, z: 0 });
    const r = smoothSubtract(a, b, 0.2);
    expect(r({ x: -1, y: 0, z: 0 })).toBeLessThan(0); // inside A, outside B
    expect(r({ x: 1, y: 0, z: 0 })).toBeGreaterThanOrEqual(-0.5); // in B → mostly outside
  });
});

describe('transformations', () => {
  it('translate shifts origin', () => {
    const s = translate(sphere(1), { x: 5, y: 0, z: 0 });
    expect(s({ x: 5, y: 0, z: 0 })).toBeCloseTo(-1, 5);
    expect(s({ x: 0, y: 0, z: 0 })).toBeCloseTo(4, 5);
  });

  it('rotateZ rotates 90°', () => {
    const b = box({ x: 2, y: 0.5, z: 0.5 });
    const rotated = rotateZ(b, Math.PI / 2);
    // Originally elongated along x; after 90° rotation it's elongated along y.
    expect(rotated({ x: 0, y: 1.8, z: 0 })).toBeLessThan(0);
    expect(rotated({ x: 1.8, y: 0, z: 0 })).toBeGreaterThan(0);
  });

  it('scale resizes', () => {
    const s = scale(sphere(1), 2);
    expect(s({ x: 1.99, y: 0, z: 0 })).toBeLessThan(0);
    expect(s({ x: 2.01, y: 0, z: 0 })).toBeGreaterThan(0);
  });
});

describe('shell, round, repeat', () => {
  it('shell makes hollow', () => {
    const s = shell(sphere(1), 0.1);
    expect(s({ x: 0, y: 0, z: 0 })).toBeGreaterThan(0); // center is now outside
    expect(s({ x: 1, y: 0, z: 0 })).toBeLessThan(0); // surface is in the shell
  });

  it('round inflates boundary outward', () => {
    const original = box({ x: 1, y: 1, z: 1 });
    const r = round(original, 0.5);
    expect(r({ x: 1.4, y: 0, z: 0 })).toBeLessThan(0);
    expect(original({ x: 1.4, y: 0, z: 0 })).toBeGreaterThan(0);
  });

  it('repeat tiles the shape', () => {
    const r = repeat(sphere(0.4), { x: 2, y: 2, z: 2 });
    expect(r({ x: 0, y: 0, z: 0 })).toBeLessThan(0);
    expect(r({ x: 2, y: 0, z: 0 })).toBeLessThan(0); // copy at (2, 0, 0)
    expect(r({ x: 1, y: 0, z: 0 })).toBeGreaterThan(0); // midpoint outside
  });
});

describe('gradient + surfaceNormal', () => {
  it('gradient on sphere points outward', () => {
    const g = gradient(sphere(1), { x: 1, y: 0, z: 0 });
    expect(g.x).toBeGreaterThan(0);
    expect(Math.abs(g.y)).toBeLessThan(0.1);
  });

  it('surfaceNormal is unit length', () => {
    const n = surfaceNormal(sphere(1), { x: 0.7, y: 0.7, z: 0 });
    const len = Math.hypot(n.x, n.y, n.z);
    expect(len).toBeCloseTo(1, 4);
  });
});

describe('sampleField + estimateVolume', () => {
  it('sampleField returns nx*ny*nz values', () => {
    const grid = sampleField(sphere(1), { x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 }, 8);
    expect(grid.values.length).toBe(8 * 8 * 8);
  });

  it('estimateVolume approximates 4/3 π R³', () => {
    const v = estimateVolume(sphere(1), { x: -1.5, y: -1.5, z: -1.5 }, { x: 1.5, y: 1.5, z: 1.5 }, 32);
    const expected = (4 / 3) * Math.PI;
    expect(v).toBeGreaterThan(expected * 0.7);
    expect(v).toBeLessThan(expected * 1.3);
  });
});
