import { describe, it, expect } from 'vitest';
import {
  generatePath,
  materialRemovalRate,
  summarize,
  type HelicalBoreInput,
} from './helicalBorePath';

const base: HelicalBoreInput = {
  pilotDiameterMm: 10,
  targetDiameterMm: 20,
  toolDiameterMm: 6,
  depthMm: 30,
};

describe('generatePath', () => {
  it('produces a descending helix', () => {
    const r = generatePath(base);
    expect(r.path.length).toBeGreaterThan(10);
    expect(r.path[0]!.z).toBeCloseTo(0, 6);
    expect(r.path[r.path.length - 1]!.z).toBeCloseTo(-30, 6);
  });

  it('final helix radius = (target − tool)/2', () => {
    const r = generatePath(base);
    expect(r.finalHelixRadiusMm).toBeCloseTo(7, 6);
  });

  it('multiple revolutions for deep bore', () => {
    const r = generatePath(base);
    expect(r.revolutions).toBeGreaterThan(1);
  });

  it('tool ≥ target → warning', () => {
    const r = generatePath({ ...base, toolDiameterMm: 20 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('target ≤ pilot → warning', () => {
    const r = generatePath({ ...base, targetDiameterMm: 8 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('spring pass adds points at final depth', () => {
    const withSpring = generatePath({ ...base, springPass: true });
    const without = generatePath({ ...base, springPass: false });
    expect(withSpring.path.length).toBeGreaterThan(without.path.length);
  });

  it('radius ramps from pilot to target', () => {
    const r = generatePath(base);
    const startR = Math.hypot(r.path[0]!.x, r.path[0]!.y);
    const endR = Math.hypot(
      r.path[r.path.length - 1]!.x,
      r.path[r.path.length - 1]!.y,
    );
    expect(endR).toBeGreaterThan(startR);
  });

  it('larger ramp angle → larger pitch → fewer revolutions', () => {
    const shallow = generatePath({ ...base, rampAngleDeg: 1 });
    const steep = generatePath({ ...base, rampAngleDeg: 6 });
    expect(steep.revolutions).toBeLessThanOrEqual(shallow.revolutions);
  });

  it('total path length positive', () => {
    expect(generatePath(base).totalPathLengthMm).toBeGreaterThan(0);
  });
});

describe('materialRemovalRate', () => {
  it('positive MRR for positive feed', () => {
    expect(materialRemovalRate(base, 500)).toBeGreaterThan(0);
  });

  it('zero feed → 0', () => {
    expect(materialRemovalRate(base, 0)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports revolutions + pitch', () => {
    const r = generatePath(base);
    const s = summarize(r);
    expect(s.revolutions).toBe(r.revolutions);
    expect(s.pitchMm).toBe(r.pitchMm);
  });
});
