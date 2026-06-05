/**
 * weldedJoint — fillet/butt weld strength, verified: the 0.707·h effective throat;
 * the fillet shear stress F/(0.707·h·L) and its inverse scaling with leg size and
 * length; the butt-weld stress F/(t·L); and the combined primary+secondary stress of
 * an eccentric weld group (√(p²+s²) at 90°, p+s at 0°).
 */
import { describe, it, expect } from 'vitest';
import { filletThroat, filletThroatArea, filletShearStress, buttWeldStress, combinedWeldStress } from './weldedJoint';

describe('weldedJoint — weld strength (verified)', () => {
  it('the fillet throat is 0.707·h and its area is 0.707·h·L', () => {
    expect(filletThroat(0.006)).toBeCloseTo(0.7071 * 0.006, 6);
    expect(filletThroatArea(0.006, 0.1)).toBeCloseTo(filletThroat(0.006) * 0.1, 12);
  });

  it('the fillet shear stress is F/(0.707·h·L)', () => {
    expect(filletShearStress(10000, 0.006, 0.1)).toBeCloseTo(10000 / (Math.SQRT1_2 * 0.006 * 0.1), 3);
  });

  it('stress scales inversely with leg size and weld length', () => {
    const base = filletShearStress(10000, 0.006, 0.1);
    expect(filletShearStress(10000, 0.012, 0.1) / base).toBeCloseTo(0.5, 6); // double leg ⇒ half
    expect(filletShearStress(10000, 0.006, 0.2) / base).toBeCloseTo(0.5, 6); // double length ⇒ half
    expect(filletShearStress(20000, 0.006, 0.1) / base).toBeCloseTo(2, 6);   // double load ⇒ double
  });

  it('the butt-weld stress is F/(t·L)', () => {
    expect(buttWeldStress(10000, 0.01, 0.1)).toBeCloseTo(10000 / (0.01 * 0.1), 6);
  });

  it('the eccentric weld combines primary and secondary shear', () => {
    expect(combinedWeldStress(30, 40, 0)).toBeCloseTo(50, 9);    // perpendicular ⇒ √(p²+s²)
    expect(combinedWeldStress(30, 40, 1)).toBeCloseTo(70, 9);    // aligned ⇒ p+s
    expect(combinedWeldStress(30, 40, -1)).toBeCloseTo(10, 9);   // opposed ⇒ |p−s|
  });
});
