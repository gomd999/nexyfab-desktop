import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BLOOM,
  DEFAULT_DOF,
  bloomContribution,
  circleOfConfusionMm,
  cocRadiusPx,
  sanitiseBloom,
  sanitiseDof,
} from './postProcess';

describe('bloomContribution', () => {
  it('zero below (threshold - knee)', () => {
    const out = bloomContribution(0.2, { ...DEFAULT_BLOOM, threshold: 1.0, softKnee: 0.5 });
    expect(out).toBe(0);
  });

  it('one above (threshold + knee)', () => {
    const out = bloomContribution(2.0, { ...DEFAULT_BLOOM, threshold: 1.0, softKnee: 0.5 });
    expect(out).toBe(1);
  });

  it('smoothstep between knee bounds', () => {
    const mid = bloomContribution(1.0, { ...DEFAULT_BLOOM, threshold: 1.0, softKnee: 0.5 });
    expect(mid).toBeCloseTo(0.5, 1);
  });

  it('hard cutoff when softKnee = 0', () => {
    expect(bloomContribution(0.999, { ...DEFAULT_BLOOM, threshold: 1.0, softKnee: 0 })).toBe(0);
    expect(bloomContribution(1.001, { ...DEFAULT_BLOOM, threshold: 1.0, softKnee: 0 })).toBe(1);
  });
});

describe('circleOfConfusionMm', () => {
  it('at-focus distance → CoC = 0', () => {
    expect(circleOfConfusionMm(300, DEFAULT_DOF)).toBeCloseTo(0, 5);
  });

  it('closer than focal length → no blur (pinhole)', () => {
    expect(circleOfConfusionMm(10, DEFAULT_DOF)).toBe(0);
  });

  it('farther than focus → positive CoC', () => {
    expect(circleOfConfusionMm(1000, DEFAULT_DOF)).toBeGreaterThan(0);
  });

  it('closer than focus (but past focal length) → positive CoC', () => {
    expect(circleOfConfusionMm(150, DEFAULT_DOF)).toBeGreaterThan(0);
  });

  it('smaller f-stop → more blur', () => {
    const wide = circleOfConfusionMm(1000, { ...DEFAULT_DOF, fStop: 1.4 });
    const tight = circleOfConfusionMm(1000, { ...DEFAULT_DOF, fStop: 22 });
    expect(wide).toBeGreaterThan(tight);
  });

  it('longer focal length → more blur at same distance', () => {
    const tele = circleOfConfusionMm(1000, { ...DEFAULT_DOF, focalLengthMm: 100 });
    const wide = circleOfConfusionMm(1000, { ...DEFAULT_DOF, focalLengthMm: 28 });
    expect(tele).toBeGreaterThan(wide);
  });
});

describe('cocRadiusPx', () => {
  it('clamps at maxCocPx', () => {
    const r = cocRadiusPx(100_000, 0.001, { ...DEFAULT_DOF, maxCocPx: 16 });
    expect(r).toBeLessThanOrEqual(16);
  });

  it('returns 0 at focus distance', () => {
    expect(cocRadiusPx(DEFAULT_DOF.focusDistanceMm, 0.01, DEFAULT_DOF)).toBe(0);
  });
});

describe('sanitiseBloom', () => {
  it('clamps threshold to ≥ 0', () => {
    expect(sanitiseBloom({ threshold: -2 }).threshold).toBe(0);
  });

  it('clamps intensity to [0, 4]', () => {
    expect(sanitiseBloom({ intensity: -1 }).intensity).toBe(0);
    expect(sanitiseBloom({ intensity: 10 }).intensity).toBe(4);
  });

  it('clamps iterations to [0, 8] and rounds', () => {
    expect(sanitiseBloom({ iterations: 7.5 }).iterations).toBe(8);
    expect(sanitiseBloom({ iterations: -3 }).iterations).toBe(0);
    expect(sanitiseBloom({ iterations: 12 }).iterations).toBe(8);
  });
});

describe('sanitiseDof', () => {
  it('clamps fStop to [1, 32]', () => {
    expect(sanitiseDof({ fStop: 0.5 }).fStop).toBe(1.0);
    expect(sanitiseDof({ fStop: 100 }).fStop).toBe(32);
  });

  it('clamps focal length to [1, 500]', () => {
    expect(sanitiseDof({ focalLengthMm: 0 }).focalLengthMm).toBe(1);
    expect(sanitiseDof({ focalLengthMm: 9999 }).focalLengthMm).toBe(500);
  });

  it('keeps valid inputs verbatim', () => {
    const r = sanitiseDof({ focusDistanceMm: 250, fStop: 2.8, focalLengthMm: 85, maxCocPx: 12 });
    expect(r).toEqual({ focusDistanceMm: 250, fStop: 2.8, focalLengthMm: 85, maxCocPx: 12 });
  });
});
