/**
 * compositeIntent — primitive composition (W1, ADR-015).
 */
import { describe, it, expect } from 'vitest';
import {
  compositeIntentToScad,
  compositeExpectedBbox,
  verifyCompositeAgainstSpec,
  type CompositePart,
} from '../compositeIntent';
import type { MeasuredBbox } from '../specVerification';

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

describe('verifyCompositeAgainstSpec (W2.1)', () => {
  const bbox = (w: number, h: number, d: number): MeasuredBbox => ({
    min: [-w / 2, -h / 2, -d / 2],
    max: [w / 2, h / 2, d / 2],
  });

  it('pure union: passes when the measured bbox matches the envelope', () => {
    const parts: CompositePart[] = [{ intent: box(10, 10, 10) }, { intent: box(10, 10, 10), at: [20, 0, 0] }];
    // envelope = x[-5..25] = 30 wide, 10 tall, 10 deep
    const r = verifyCompositeAgainstSpec(parts, { min: [-5, -5, -5], max: [25, 5, 5] });
    expect(r.verifiable).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.expected).toMatchObject({ wMm: 30, hMm: 10, dMm: 10 });
  });

  it('pure union: flags a measured axis that is too SMALL (two-sided)', () => {
    const parts: CompositePart[] = [{ intent: box(10, 10, 10) }, { intent: box(10, 10, 10), at: [20, 0, 0] }];
    const r = verifyCompositeAgainstSpec(parts, { min: [0, -5, -5], max: [20, 5, 5] }); // w=20, expected 30
    expect(r.ok).toBe(false);
    expect(r.mismatches.map((m) => m.axis)).toContain('width');
  });

  it('with subtract: a SMALLER measured bbox is legitimate shrink, not a mismatch', () => {
    const parts: CompositePart[] = [{ intent: box(10, 10, 10) }, { intent: cyl(6, 20), op: 'subtract' }];
    const r = verifyCompositeAgainstSpec(parts, bbox(8, 10, 10)); // width shrank below envelope 10
    expect(r.verifiable).toBe(true);
    expect(r.ok).toBe(true);          // envelope is conservative → no false positive
    expect(r.mismatches).toHaveLength(0);
  });

  it('with subtract: a measured bbox that EXCEEDS the envelope is a real error', () => {
    const parts: CompositePart[] = [{ intent: box(10, 10, 10) }, { intent: cyl(6, 20), op: 'subtract' }];
    const r = verifyCompositeAgainstSpec(parts, bbox(14, 10, 10)); // 14 > 10 envelope → too big
    expect(r.ok).toBe(false);
    expect(r.mismatches.map((m) => m.axis)).toContain('width');
  });

  it('skips (verifiable=false) when an add part bbox is unknown', () => {
    const parts: CompositePart[] = [
      { intent: { shapeId: 'mystery', params: {} } as CompositePart['intent'] },
    ];
    const r = verifyCompositeAgainstSpec(parts, bbox(10, 10, 10));
    expect(r.verifiable).toBe(false);
    expect(r.ok).toBe(true); // skipped, not failed
  });
});
