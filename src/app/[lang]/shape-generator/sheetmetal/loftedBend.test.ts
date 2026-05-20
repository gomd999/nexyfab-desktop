import { describe, it, expect } from 'vitest';
import { loftedBend, sweptBend, type Profile } from './loftedBend';

const square: Profile = { points: [[0, 0], [10, 0], [10, 10], [0, 10]] };
const bigger: Profile = { points: [[0, 0], [20, 0], [20, 20], [0, 20]] };

describe('loftedBend', () => {
  it('produces (samples + 1) cross-sections', () => {
    const r = loftedBend({
      material: 'aluminum-6061',
      thicknessMm: 1,
      startProfile: square,
      endProfile: bigger,
      lengthMm: 50,
      samples: 4,
    });
    expect(r.sections).toHaveLength(5);
  });

  it('first and last sections match input profiles', () => {
    const r = loftedBend({
      material: 'aluminum-6061',
      thicknessMm: 1,
      startProfile: square,
      endProfile: bigger,
      lengthMm: 50,
    });
    expect(r.sections[0]).toEqual(square);
    expect(r.sections[r.sections.length - 1]).toEqual(bigger);
  });

  it('flat area is positive and reflects loft size', () => {
    const r = loftedBend({
      material: 'aluminum-6061',
      thicknessMm: 1,
      startProfile: square,
      endProfile: bigger,
      lengthMm: 50,
    });
    expect(r.flatArea).toBeGreaterThan(0);
  });

  it('developed length = input length for straight loft', () => {
    const r = loftedBend({
      material: 'aluminum-6061',
      thicknessMm: 1,
      startProfile: square,
      endProfile: bigger,
      lengthMm: 75,
    });
    expect(r.developedLengthMm).toBe(75);
  });
});

describe('sweptBend', () => {
  it('handles empty path safely', () => {
    const r = sweptBend({
      material: 'aluminum-6061',
      thicknessMm: 1,
      profile: square,
      path: [],
    });
    expect(r.pathLengthMm).toBe(0);
    expect(r.segments).toEqual([]);
  });

  it('straight path has zero bend segments', () => {
    const r = sweptBend({
      material: 'aluminum-6061',
      thicknessMm: 1,
      profile: square,
      path: [[0, 0, 0], [10, 0, 0], [20, 0, 0]],
    });
    expect(r.segments).toHaveLength(0);
    expect(r.pathLengthMm).toBeCloseTo(20, 2);
  });

  it('right-angle path detects a 90° bend', () => {
    const r = sweptBend({
      material: 'aluminum-6061',
      thicknessMm: 1,
      profile: square,
      path: [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
    });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.angleRad).toBeCloseTo(Math.PI / 2, 2);
  });

  it('developed length includes bend allowance', () => {
    const r = sweptBend({
      material: 'aluminum-6061',
      thicknessMm: 1,
      profile: square,
      path: [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
    });
    expect(r.developedLengthMm).toBeGreaterThan(r.pathLengthMm);
  });
});
