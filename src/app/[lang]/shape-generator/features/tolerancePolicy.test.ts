/**
 * tolerancePolicy — pins the one geometric-tolerance policy (F3). The welding
 * tolerance in particular is load-bearing: a miss here mis-classifies solids as
 * open, so its behaviour (within-tol → same key, beyond-tol → different key) is
 * locked.
 */
import { describe, it, expect } from 'vitest';
import {
  WELD_TOL_MM,
  weldBucket,
  weldKey,
  ZERO_LENGTH_EPS,
  AXIS_EPS,
} from './tolerancePolicy';

describe('tolerancePolicy (F3 geometric tolerances)', () => {
  it('exposes a sane, ordered set of tolerances', () => {
    expect(WELD_TOL_MM).toBe(1e-5);
    expect(ZERO_LENGTH_EPS).toBe(1e-9);
    expect(AXIS_EPS).toBe(1e-6);
    // zero-length is the tightest; welding the loosest.
    expect(ZERO_LENGTH_EPS).toBeLessThan(AXIS_EPS);
    expect(AXIS_EPS).toBeLessThan(WELD_TOL_MM);
  });

  describe('vertex welding', () => {
    it('two points within WELD_TOL_MM share a key (weld together)', () => {
      const a = weldKey(10, 20, 30);
      const b = weldKey(10 + WELD_TOL_MM * 0.4, 20 - WELD_TOL_MM * 0.4, 30);
      expect(b).toBe(a);
    });

    it('two points clearly beyond WELD_TOL_MM get different keys (stay distinct)', () => {
      const a = weldKey(10, 20, 30);
      const b = weldKey(10 + WELD_TOL_MM * 10, 20, 30);
      expect(b).not.toBe(a);
    });

    it('weldBucket quantises to integer buckets of WELD_TOL_MM', () => {
      expect(weldBucket(0)).toBe(0);
      expect(weldBucket(WELD_TOL_MM)).toBe(1);
      expect(weldBucket(-WELD_TOL_MM)).toBe(-1);
      // float noise below half a bucket rounds away
      expect(weldBucket(WELD_TOL_MM * 0.49)).toBe(0);
    });

    it('is symmetric around the bucket boundary (no sign bias near zero)', () => {
      expect(weldKey(0, 0, 0)).toBe(weldKey(WELD_TOL_MM * 0.3, -WELD_TOL_MM * 0.3, 0));
    });
  });
});
