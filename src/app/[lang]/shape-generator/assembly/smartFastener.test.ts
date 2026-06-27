/**
 * suggestFasteners — pairs coaxial through-holes across parts and proposes
 * bolt stacks. Coverage-gap closure for the assembly subsystem.
 */
import { describe, it, expect } from 'vitest';
import { suggestFasteners } from './smartFastener';

 
const hole = (partId: string, z: number, diameter = 6): any => ({ partId, center: [0, 0, z], axis: [0, 0, 1], diameter, length: 5 });

describe('suggestFasteners', () => {
  it('returns no suggestions for zero/one hole', () => {
    expect(suggestFasteners([])).toEqual([]);
    expect(suggestFasteners([hole('A', 0)])).toEqual([]);
  });
  it('pairs two coaxial same-diameter holes on different parts', () => {
    expect(suggestFasteners([hole('A', 0), hole('B', 8)]).length).toBeGreaterThanOrEqual(1);
  });
  it('does not pair holes of mismatched diameter', () => {
    expect(suggestFasteners([hole('A', 0, 6), hole('B', 8, 12)]).length).toBe(0);
  });
});
