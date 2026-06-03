/**
 * compositeIntent — primitive composition (W1, ADR-015).
 */
import { describe, it, expect } from 'vitest';
import {
  compositeIntentToScad,
  compositeExpectedBbox,
  type CompositePart,
} from '../compositeIntent';

const box = (w: number, h: number, d: number): CompositePart['intent'] => ({
  shapeId: 'box', params: { width: w, height: h, depth: d },
});
const cyl = (diameter: number, height: number): CompositePart['intent'] => ({
  shapeId: 'cylinder', params: { diameter, height },
});

describe('compositeIntentToScad', () => {
  it('box minus a cylinder → a difference of rendered primitives', () => {
    const r = compositeIntentToScad([
      { intent: box(40, 40, 20) },
      { intent: cyl(10, 30), op: 'subtract' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/difference\(\)/);
      // single add → no union wrapper needed.
      expect(r.scad).not.toMatch(/union\(\)/);
    }
  });

  it('two adds → a union; a translated part is wrapped in translate()', () => {
    const r = compositeIntentToScad([
      { intent: box(10, 10, 10) },
      { intent: box(10, 10, 10), op: 'add', at: [20, 0, 0] },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/union\(\)/);
      expect(r.scad).toMatch(/translate\(\[20/);
    }
  });

  it('intersect wraps the body in intersection()', () => {
    const r = compositeIntentToScad([
      { intent: box(20, 20, 20) },
      { intent: cyl(20, 40), op: 'intersect' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scad).toMatch(/intersection\(\)/);
  });

  it('empty parts → fail', () => {
    const r = compositeIntentToScad([]);
    expect(r.ok).toBe(false);
  });

  it('no add part (only subtract) → fail (nothing to anchor)', () => {
    const r = compositeIntentToScad([{ intent: cyl(5, 10), op: 'subtract' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/anchor/);
  });

  it('an unrenderable primitive → fail with the part index', () => {
    const r = compositeIntentToScad([
      { intent: { shapeId: 'not_a_shape', params: {} } as CompositePart['intent'] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/part 0/);
  });
});

describe('compositeExpectedBbox', () => {
  it('single add box → that box bbox', () => {
    const bb = compositeExpectedBbox([{ intent: box(10, 20, 30) }]);
    expect(bb).toMatchObject({ wMm: 10, hMm: 20, dMm: 30 });
  });

  it('two adds offset along X → widened envelope; subtract does not grow it', () => {
    const bb = compositeExpectedBbox([
      { intent: box(10, 10, 10) },
      { intent: box(10, 10, 10), op: 'add', at: [20, 0, 0] },
      { intent: cyl(50, 50), op: 'subtract', at: [0, 0, 0] }, // ignored for bbox
    ]);
    // x spans [-5 .. 25] = 30; y,z stay 10.
    expect(bb).toMatchObject({ wMm: 30, hMm: 10, dMm: 10 });
  });

  it('returns null when an add part bbox is unknown', () => {
    const bb = compositeExpectedBbox([
      { intent: { shapeId: 'mystery', params: {} } as CompositePart['intent'] },
    ]);
    expect(bb).toBeNull();
  });
});
