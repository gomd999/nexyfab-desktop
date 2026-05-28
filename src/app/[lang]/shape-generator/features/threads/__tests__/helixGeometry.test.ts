/**
 * helixGeometry.test.ts — Wave 2 Phase 2 Track D7 (W7).
 *
 * Verifies the pure-math helix path sampler that backs the geometric thread
 * sweep. No Three.js dependency.
 */

import { describe, it, expect } from 'vitest';
import {
  buildHelixPath,
  buildHelixPathForThread,
  helixTurnsForLength,
  helixFrameAt,
  DEFAULT_SAMPLES_PER_TURN,
  DEFAULT_MAX_SAMPLES,
  type HelixSpec,
} from '../helixGeometry';

const RH_SPEC: HelixSpec = {
  axis: [0, 0, 1],
  radius: 4,
  pitch: 1.25,
  turns: 4,
  startOffset: 0,
  direction: 'right_hand',
};

describe('buildHelixPath — basic path sampling', () => {
  it('returns at least samplesPerTurn × turns + 1 points (natural count)', () => {
    const pts = buildHelixPath(RH_SPEC);
    // 16 samplesPerTurn × 4 turns + 1 = 65
    expect(pts.length).toBe(16 * 4 + 1);
  });

  it('first sample sits at (radius, 0, startOffset) for right-hand', () => {
    const pts = buildHelixPath(RH_SPEC);
    expect(pts[0]![0]).toBeCloseTo(4, 6);
    expect(pts[0]![1]).toBeCloseTo(0, 6);
    expect(pts[0]![2]).toBeCloseTo(0, 6);
  });

  it('last sample has z = pitch × turns (4 turns × 1.25 = 5 mm)', () => {
    const pts = buildHelixPath(RH_SPEC);
    expect(pts.at(-1)![2]).toBeCloseTo(5, 6);
  });

  it('honours startOffset (z shifted by the offset)', () => {
    const pts = buildHelixPath({ ...RH_SPEC, startOffset: 7 });
    expect(pts[0]![2]).toBeCloseTo(7, 6);
    expect(pts.at(-1)![2]).toBeCloseTo(7 + 5, 6);
  });

  it('every point lies on the radius (x² + y² = r²)', () => {
    const pts = buildHelixPath(RH_SPEC);
    for (const [x, y] of pts) {
      expect(Math.hypot(x, y)).toBeCloseTo(4, 6);
    }
  });
});

describe('buildHelixPath — left-hand flip', () => {
  it('LH inverts the y-component (sin sign flipped)', () => {
    const rh = buildHelixPath({ ...RH_SPEC, turns: 1 });
    const lh = buildHelixPath({ ...RH_SPEC, turns: 1, direction: 'left_hand' });
    // Pick a non-trivial sample (1/4 turn from start)
    const quarter = Math.floor(rh.length / 4);
    expect(rh[quarter]![1]).toBeCloseTo(-lh[quarter]![1], 6);
  });

  it('LH z-progression is the same as RH (handedness does not flip axial direction)', () => {
    const rh = buildHelixPath({ ...RH_SPEC, turns: 1 });
    const lh = buildHelixPath({ ...RH_SPEC, turns: 1, direction: 'left_hand' });
    for (let i = 0; i < rh.length; i++) {
      expect(rh[i]![2]).toBeCloseTo(lh[i]![2], 6);
    }
  });

  it('LH first/last x is identical to RH (cosine is even, so x unchanged)', () => {
    const rh = buildHelixPath({ ...RH_SPEC, turns: 1 });
    const lh = buildHelixPath({ ...RH_SPEC, turns: 1, direction: 'left_hand' });
    expect(rh[0]![0]).toBeCloseTo(lh[0]![0], 6);
    expect(rh.at(-1)![0]).toBeCloseTo(lh.at(-1)![0], 6);
  });
});

describe('buildHelixPath — pitch & turns', () => {
  it('total z = pitch × turns regardless of samplesPerTurn', () => {
    const pts8 = buildHelixPath(RH_SPEC, { samplesPerTurn: 8 });
    const pts32 = buildHelixPath(RH_SPEC, { samplesPerTurn: 32 });
    expect(pts8.at(-1)![2]).toBeCloseTo(5, 6);
    expect(pts32.at(-1)![2]).toBeCloseTo(5, 6);
  });

  it('larger pitch produces taller helix', () => {
    const tight = buildHelixPath({ ...RH_SPEC, pitch: 0.5 });
    const loose = buildHelixPath({ ...RH_SPEC, pitch: 2.0 });
    expect(loose.at(-1)![2]).toBeGreaterThan(tight.at(-1)![2]);
  });

  it('fractional turns produce a partial helix (1.5 turns → 1.5 × pitch height)', () => {
    const pts = buildHelixPath({ ...RH_SPEC, turns: 1.5 });
    expect(pts.at(-1)![2]).toBeCloseTo(1.5 * 1.25, 6);
  });
});

describe('buildHelixPath — sampling caps & options', () => {
  it('caps total sample count at maxSamples', () => {
    // 100 turns × 32 samplesPerTurn = 3201 natural → capped at 256
    const pts = buildHelixPath({ ...RH_SPEC, turns: 100 }, { samplesPerTurn: 32 });
    expect(pts.length).toBeLessThanOrEqual(DEFAULT_MAX_SAMPLES);
  });

  it('respects samplesPerTurn override (32 → 32 × turns + 1)', () => {
    const pts = buildHelixPath({ ...RH_SPEC, turns: 2 }, { samplesPerTurn: 32 });
    expect(pts.length).toBe(32 * 2 + 1);
  });

  it('default samplesPerTurn is the published constant (16)', () => {
    expect(DEFAULT_SAMPLES_PER_TURN).toBe(16);
  });
});

describe('buildHelixPath — validation', () => {
  it('throws on non-positive radius', () => {
    expect(() => buildHelixPath({ ...RH_SPEC, radius: 0 })).toThrow();
    expect(() => buildHelixPath({ ...RH_SPEC, radius: -1 })).toThrow();
  });

  it('throws on non-positive pitch', () => {
    expect(() => buildHelixPath({ ...RH_SPEC, pitch: 0 })).toThrow();
  });

  it('throws on non-positive turns', () => {
    expect(() => buildHelixPath({ ...RH_SPEC, turns: 0 })).toThrow();
  });

  it('rejects non-+Z axis (D7 worker-dependent feature)', () => {
    expect(() => buildHelixPath({ ...RH_SPEC, axis: [1, 0, 0] })).toThrow(/\+Z axis/);
  });
});

describe('helixTurnsForLength', () => {
  it('M8 × 1.25 over 20 mm → 16 turns', () => {
    expect(helixTurnsForLength(20, 1.25)).toBe(16);
  });

  it('zero length returns 0 turns', () => {
    expect(helixTurnsForLength(0, 1.0)).toBe(0);
  });

  it('throws on non-positive pitch', () => {
    expect(() => helixTurnsForLength(20, 0)).toThrow();
  });
});

describe('buildHelixPathForThread (convenience)', () => {
  it('M8 × 1.25 × 20 mm produces the same path as buildHelixPath with turns=16', () => {
    const ref = buildHelixPath({
      axis: [0, 0, 1],
      radius: 3.5,
      pitch: 1.25,
      turns: 16,
      startOffset: 0,
      direction: 'right_hand',
    });
    const conv = buildHelixPathForThread({
      radius: 3.5,
      pitch: 1.25,
      lengthMm: 20,
    });
    expect(conv.length).toBe(ref.length);
    expect(conv.at(-1)![2]).toBeCloseTo(ref.at(-1)![2], 6);
  });
});

describe('helixFrameAt', () => {
  it('produces unit tangent', () => {
    const f = helixFrameAt(RH_SPEC, 0.25);
    expect(Math.hypot(...f.tangent)).toBeCloseTo(1, 6);
  });

  it('normal points radially inward (toward axis)', () => {
    const f = helixFrameAt(RH_SPEC, 0);
    // At t=0 the point is (radius, 0, 0), so the inward normal is (-1, 0, 0).
    expect(f.normal[0]).toBeCloseTo(-1, 6);
    expect(f.normal[1]).toBeCloseTo(0, 6);
    expect(f.normal[2]).toBeCloseTo(0, 6);
  });

  it('binormal is unit length', () => {
    const f = helixFrameAt(RH_SPEC, 0.5);
    expect(Math.hypot(...f.binormal)).toBeCloseTo(1, 6);
  });

  it('rejects t outside [0,1]', () => {
    expect(() => helixFrameAt(RH_SPEC, -0.1)).toThrow();
    expect(() => helixFrameAt(RH_SPEC, 1.1)).toThrow();
  });
});
