import { describe, expect, it } from 'vitest';
import { PLATE_HOLE_A5 } from './fixtures';

describe('A5 plate-with-hole reference bases', () => {
  it('keeps Kirsch gross-section and Howland net-section definitions separate', () => {
    expect(PLATE_HOLE_A5.grossNominalMPa()).toBeCloseTo(104.1666667, 6);
    expect(PLATE_HOLE_A5.netNominalMPa()).toBe(125);
    expect(PLATE_HOLE_A5.howlandKtNet()).toBeCloseTo(2.5729167, 6);

    // Infinite-plate Kirsch peak expressed on the net-section basis is 2.5,
    // not 3.0. This guards the exact basis mismatch that overstated live error.
    const kirschNet = 3 * PLATE_HOLE_A5.grossNominalMPa() / PLATE_HOLE_A5.netNominalMPa();
    expect(kirschNet).toBe(2.5);
  });
});
