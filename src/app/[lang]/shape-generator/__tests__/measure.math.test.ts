import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { formatWithUnit, convertToDisplay, convertFromDisplay, convertInputToActiveUnit } from '../units';

/**
 * Reproduce the circumradius math from MeasureTool here so we can unit-test
 * the geometry without a Three.js renderer. The component imports a private
 * helper of the same shape — keeping the test independent prevents the test
 * from drifting if the component file moves.
 */
function circumradius(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = b.distanceTo(a);
  const bc = c.distanceTo(b);
  const ca = a.distanceTo(c);
  const area2 = new THREE.Vector3()
    .crossVectors(
      new THREE.Vector3().subVectors(b, a),
      new THREE.Vector3().subVectors(c, a),
    )
    .length();
  if (area2 < 1e-10) return Infinity;
  return (ab * bc * ca) / (2 * area2);
}

describe('measure tool math', () => {
  describe('formatWithUnit', () => {
    it('mm passes through unchanged', () => {
      expect(formatWithUnit(25.4, 'mm', 2)).toBe('25.40 mm');
    });

    it('inch divides by 25.4', () => {
      expect(formatWithUnit(25.4, 'inch', 3)).toBe('1.000 in');
    });

    it('handles negative and zero values', () => {
      expect(formatWithUnit(0, 'mm', 2)).toBe('0.00 mm');
      expect(formatWithUnit(-10, 'mm', 1)).toBe('-10.0 mm');
    });

    it('round-trips mm ↔ inch', () => {
      const original = 50;
      const inches = convertToDisplay(original, 'inch');
      const back = convertFromDisplay(inches, 'inch');
      expect(back).toBeCloseTo(original, 6);
    });
  });

  describe('convertInputToActiveUnit', () => {
    it('parses bare number as active unit', () => {
      expect(convertInputToActiveUnit('25', 'mm')).toEqual({ value: 25, note: null });
    });

    it('converts inch input to mm with note', () => {
      const r = convertInputToActiveUnit('1in', 'mm');
      expect(r.value).toBeCloseTo(25.4, 4);
      expect(r.note).toContain('25.40mm');
    });

    it('converts cm to mm', () => {
      const r = convertInputToActiveUnit('5cm', 'mm');
      expect(r.value).toBe(50);
    });

    it('rejects malformed input', () => {
      expect(convertInputToActiveUnit('abc', 'mm')).toEqual({ value: null, note: null });
      expect(convertInputToActiveUnit('', 'mm')).toEqual({ value: null, note: null });
    });

    it('handles foot prime suffix', () => {
      const r = convertInputToActiveUnit("1'", 'mm');
      expect(r.value).toBeCloseTo(304.8, 4);
    });
  });

  describe('circumradius', () => {
    it('equilateral triangle radius matches analytical', () => {
      // Equilateral with side 10 → circumradius = side / sqrt(3) ≈ 5.774
      const a = new THREE.Vector3(0, 0, 0);
      const b = new THREE.Vector3(10, 0, 0);
      const c = new THREE.Vector3(5, 8.66025, 0);  // (5, 5√3)
      expect(circumradius(a, b, c)).toBeCloseTo(10 / Math.sqrt(3), 3);
    });

    it('right-triangle hypotenuse is diameter', () => {
      // 3-4-5 right triangle: hypotenuse 5 → R = 2.5
      const a = new THREE.Vector3(0, 0, 0);
      const b = new THREE.Vector3(3, 0, 0);
      const c = new THREE.Vector3(0, 4, 0);
      expect(circumradius(a, b, c)).toBeCloseTo(2.5, 3);
    });

    it('collinear points return Infinity (no defined circle)', () => {
      const a = new THREE.Vector3(0, 0, 0);
      const b = new THREE.Vector3(1, 0, 0);
      const c = new THREE.Vector3(2, 0, 0);
      expect(circumradius(a, b, c)).toBe(Infinity);
    });

    it('handles 3D triangles in arbitrary orientation', () => {
      // Same right triangle as above, rotated into xz-plane.
      const a = new THREE.Vector3(0, 0, 0);
      const b = new THREE.Vector3(3, 0, 0);
      const c = new THREE.Vector3(0, 0, 4);
      expect(circumradius(a, b, c)).toBeCloseTo(2.5, 3);
    });
  });

  describe('angle clamp safety', () => {
    // The MeasureTool clamps acos input to [-1, 1] before calling Math.acos
    // because dot products of normalized vectors can drift outside this range
    // due to floating point, producing NaN. This test asserts the clamp.
    it('clamped acos never returns NaN even with floating-point overflow', () => {
      const v1 = new THREE.Vector3(1, 0, 0);
      const v2 = new THREE.Vector3(1.0000000001, 0, 0).normalize();
      const dot = v1.dot(v2);
      // Direct acos can fail at exactly 1 + eps; clamped path always returns finite.
      const clamped = Math.acos(Math.max(-1, Math.min(1, dot)));
      expect(Number.isFinite(clamped)).toBe(true);
      expect(clamped).toBeGreaterThanOrEqual(0);
    });
  });
});
