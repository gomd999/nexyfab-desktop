import { describe, it, expect } from 'vitest';
import {
  buildFrame,
  transformToPartFrame,
  validateFrame,
  summarize,
} from './coordinateDatumFrameBuilder';

const primary = {
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
    { x: 0, y: 100, z: 0 },
  ],
};

const secondary = {
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 0 },
  ],
};

const tertiary = { point: { x: 0, y: 0, z: 0 } };

describe('buildFrame', () => {
  it('produces unit-length axes', () => {
    const r = buildFrame(primary, secondary, tertiary);
    expect(Math.hypot(r.xAxis.x, r.xAxis.y, r.xAxis.z)).toBeCloseTo(1, 3);
    expect(Math.hypot(r.yAxis.x, r.yAxis.y, r.yAxis.z)).toBeCloseTo(1, 3);
    expect(Math.hypot(r.zAxis.x, r.zAxis.y, r.zAxis.z)).toBeCloseTo(1, 3);
  });

  it('flat primary → small flatness', () => {
    const r = buildFrame(primary, secondary, tertiary);
    expect(r.primaryFlatnessMm).toBeLessThan(0.01);
  });

  it('warns when insufficient primary points', () => {
    const r = buildFrame({ points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }, secondary, tertiary);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('warns when insufficient secondary points', () => {
    const r = buildFrame(primary, { points: [{ x: 0, y: 0, z: 0 }] }, tertiary);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('Z axis points away from data centroid (positive)', () => {
    const r = buildFrame(primary, secondary, tertiary);
    expect(r.zAxis.z).toBeGreaterThan(0);
  });

  it('axes orthogonal', () => {
    const r = buildFrame(primary, secondary, tertiary);
    const xy = r.xAxis.x * r.yAxis.x + r.xAxis.y * r.yAxis.y + r.xAxis.z * r.yAxis.z;
    expect(Math.abs(xy)).toBeLessThan(0.01);
  });

  it('non-flat primary → larger flatness', () => {
    const bumpy = {
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 0, z: 0 },
        { x: 0, y: 100, z: 0 },
        { x: 100, y: 100, z: 1 }, // off-plane bump
      ],
    };
    const r = buildFrame(bumpy, secondary, tertiary);
    expect(r.primaryFlatnessMm).toBeGreaterThan(0.1);
  });
});

describe('transformToPartFrame', () => {
  it('origin transforms to (0, 0, 0)', () => {
    const frame = buildFrame(primary, secondary, tertiary);
    const r = transformToPartFrame(frame.origin, frame);
    expect(r.x).toBeCloseTo(0, 3);
    expect(r.y).toBeCloseTo(0, 3);
    expect(r.z).toBeCloseTo(0, 3);
  });

  it('point along X axis transforms to (d, 0, 0)', () => {
    const frame = buildFrame(primary, secondary, tertiary);
    const xpt = {
      x: frame.origin.x + frame.xAxis.x * 5,
      y: frame.origin.y + frame.xAxis.y * 5,
      z: frame.origin.z + frame.xAxis.z * 5,
    };
    const r = transformToPartFrame(xpt, frame);
    expect(r.x).toBeCloseTo(5, 3);
    expect(r.y).toBeCloseTo(0, 3);
  });
});

describe('validateFrame', () => {
  it('clean frame passes', () => {
    const frame = buildFrame(primary, secondary, tertiary);
    const v = validateFrame(frame);
    expect(v.flatnessOk).toBe(true);
    expect(v.axesOrthogonal).toBe(true);
  });

  it('tight tolerance fails on rough primary', () => {
    const bumpy = {
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 0, z: 0 },
        { x: 0, y: 100, z: 0 },
        { x: 100, y: 100, z: 1 }, // off-plane bump
      ],
    };
    const frame = buildFrame(bumpy, secondary, tertiary);
    const v = validateFrame(frame, 0.01, 0.5);
    expect(v.flatnessOk).toBe(false);
  });
});

describe('summarize', () => {
  it('reports flatness + squareness', () => {
    const frame = buildFrame(primary, secondary, tertiary);
    const s = summarize(frame);
    expect(s.primaryFlatnessMm).toBe(frame.primaryFlatnessMm);
  });
});
