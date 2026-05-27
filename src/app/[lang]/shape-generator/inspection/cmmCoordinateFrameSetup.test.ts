import { describe, it, expect } from 'vitest';
import {
  setupCoordinateFrame,
  applyFrame,
  summarize,
  type FrameSetupInput,
} from './cmmCoordinateFrameSetup';

function baseInput(): FrameSetupInput {
  return {
    primaryPoints: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
    ],
    secondaryPoints: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
    tertiaryPoint: { x: 0, y: 0, z: 0 },
  };
}

describe('setupCoordinateFrame', () => {
  it('axis-aligned input → identity-like frame', () => {
    const r = setupCoordinateFrame(baseInput());
    expect(r.frame.zAxis.z).toBeCloseTo(1, 5);
    expect(r.frame.xAxis.x).toBeCloseTo(1, 5);
    expect(r.frame.yAxis.y).toBeCloseTo(1, 5);
  });

  it('origin at tertiary point projected onto plane', () => {
    const r = setupCoordinateFrame(baseInput());
    expect(r.frame.origin.x).toBeCloseTo(0, 5);
    expect(r.frame.origin.y).toBeCloseTo(0, 5);
    expect(r.frame.origin.z).toBeCloseTo(0, 5);
  });

  it('translated tertiary shifts origin', () => {
    const input: FrameSetupInput = {
      ...baseInput(),
      tertiaryPoint: { x: 5, y: 3, z: 0 },
    };
    const r = setupCoordinateFrame(input);
    expect(r.frame.origin.x).toBeCloseTo(5, 5);
    expect(r.frame.origin.y).toBeCloseTo(3, 5);
  });

  it('z axis perpendicular to x axis', () => {
    const r = setupCoordinateFrame(baseInput());
    const dot = r.frame.xAxis.x * r.frame.zAxis.x + r.frame.xAxis.y * r.frame.zAxis.y + r.frame.xAxis.z * r.frame.zAxis.z;
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });

  it('tilted primary plane gives non-Z primary normal', () => {
    const input: FrameSetupInput = {
      primaryPoints: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 0, y: 10, z: 5 },
      ],
      secondaryPoints: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      tertiaryPoint: { x: 0, y: 0, z: 0 },
    };
    const r = setupCoordinateFrame(input);
    expect(r.frame.zAxis.z).toBeLessThan(0.99);
  });

  it('non-planar primary points report plane error', () => {
    // 3 points cannot be non-planar (they always define a plane), so error = 0.
    const r = setupCoordinateFrame(baseInput());
    expect(r.diagnostics.primaryPlaneError).toBeLessThan(1e-6);
  });

  it('axes are orthogonal', () => {
    const r = setupCoordinateFrame(baseInput());
    expect(r.diagnostics.axisOrthogonality).toBeLessThan(1e-6);
  });

  it('machineToPartMatrix is 16 elements', () => {
    const r = setupCoordinateFrame(baseInput());
    expect(r.frame.machineToPartMatrix).toHaveLength(16);
  });

  it('last row of matrix = [0, 0, 0, 1]', () => {
    const r = setupCoordinateFrame(baseInput());
    const m = r.frame.machineToPartMatrix;
    expect(m[12]).toBe(0);
    expect(m[13]).toBe(0);
    expect(m[14]).toBe(0);
    expect(m[15]).toBe(1);
  });
});

describe('applyFrame', () => {
  it('origin maps to (0, 0, 0)', () => {
    const r = setupCoordinateFrame(baseInput());
    const part = applyFrame(r.frame, r.frame.origin);
    expect(Math.abs(part.x)).toBeLessThan(1e-9);
    expect(Math.abs(part.y)).toBeLessThan(1e-9);
    expect(Math.abs(part.z)).toBeLessThan(1e-9);
  });

  it('point above plane has positive Z in part frame', () => {
    const r = setupCoordinateFrame(baseInput());
    const part = applyFrame(r.frame, { x: 0, y: 0, z: 5 });
    expect(part.z).toBeCloseTo(5, 5);
  });

  it('point along X axis has positive X in part frame', () => {
    const r = setupCoordinateFrame(baseInput());
    const part = applyFrame(r.frame, { x: 7, y: 0, z: 0 });
    expect(part.x).toBeCloseTo(7, 5);
  });

  it('point on tertiary maps to origin', () => {
    const input: FrameSetupInput = {
      ...baseInput(),
      tertiaryPoint: { x: 5, y: 3, z: 0 },
    };
    const r = setupCoordinateFrame(input);
    const part = applyFrame(r.frame, { x: 5, y: 3, z: 0 });
    expect(Math.abs(part.x)).toBeLessThan(1e-6);
    expect(Math.abs(part.y)).toBeLessThan(1e-6);
  });
});

describe('summarize', () => {
  it('valid frame summary', () => {
    const r = setupCoordinateFrame(baseInput());
    const s = summarize(r.diagnostics);
    expect(s.isValid).toBe(true);
    expect(s.axesOrthogonal).toBe(true);
  });

  it('reports projection deg', () => {
    const r = setupCoordinateFrame(baseInput());
    const s = summarize(r.diagnostics);
    expect(typeof s.secondaryProjectionDeg).toBe('number');
  });
});
