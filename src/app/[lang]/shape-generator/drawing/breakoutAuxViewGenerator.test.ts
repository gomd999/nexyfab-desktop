import { describe, it, expect } from 'vitest';
import {
  generateBreakout,
  generateAuxView,
  cloudPerimeter,
  checkScaleFit,
  summarize,
  type FeatureToExpose,
} from './breakoutAuxViewGenerator';

const feature: FeatureToExpose = {
  id: 'f1',
  centre: { x: 10, y: 20, z: 5 },
  extentMm: { width: 10, height: 10, depth: 8 },
  normal: { x: 0, y: 0, z: 1 },
};

describe('generateBreakout', () => {
  it('produces cloud polygon with N vertices', () => {
    const b = generateBreakout(feature, 'xy', { cloudVertices: 12, cutDepthFraction: 0.3, cloudAmplitudeMm: 1, scale: 1 });
    expect(b.cloudPolygon).toHaveLength(12);
  });

  it('cut depth scales with extent', () => {
    const b1 = generateBreakout(feature, 'xy', { cutDepthFraction: 0.5, cloudVertices: 8, cloudAmplitudeMm: 1, scale: 1 });
    expect(b1.cutDepthMm).toBeCloseTo(4, 3);
  });

  it('centre projected correctly', () => {
    const b = generateBreakout(feature, 'xy');
    expect(b.centre2d).toEqual({ x: 10, y: 20 });
  });

  it('xz projection swaps y for z', () => {
    const b = generateBreakout(feature, 'xz');
    expect(b.centre2d).toEqual({ x: 10, y: 5 });
  });

  it('feature id preserved', () => {
    const b = generateBreakout(feature, 'xy');
    expect(b.featureId).toBe('f1');
  });
});

describe('generateAuxView', () => {
  it('produces 9-element rotation matrix', () => {
    const a = generateAuxView(feature, { x: 100, y: 50 }, 'VIEW A');
    expect(a.rotation).toHaveLength(9);
  });

  it('label respected', () => {
    const a = generateAuxView(feature, { x: 0, y: 0 }, 'A-A');
    expect(a.label).toBe('A-A');
  });

  it('origin echoed', () => {
    const a = generateAuxView(feature, { x: 100, y: 50 }, 'A');
    expect(a.origin).toEqual({ x: 100, y: 50 });
  });

  it('zero-length normal → identity rotation', () => {
    const f0 = { ...feature, normal: { x: 0, y: 0, z: 0 } };
    const a = generateAuxView(f0, { x: 0, y: 0 }, 'A');
    expect(a.rotation[0]).toBe(1);
    expect(a.rotation[4]).toBe(1);
    expect(a.rotation[8]).toBe(1);
  });
});

describe('cloudPerimeter', () => {
  it('positive for non-empty cloud', () => {
    const b = generateBreakout(feature, 'xy');
    expect(cloudPerimeter(b)).toBeGreaterThan(0);
  });
});

describe('checkScaleFit', () => {
  it('fits at default scale 1', () => {
    const aux = generateAuxView(feature, { x: 0, y: 0 }, 'A');
    expect(checkScaleFit(feature, aux, 100).fits).toBe(true);
  });

  it('does not fit when scale too large', () => {
    const aux = generateAuxView(feature, { x: 0, y: 0 }, 'A', { scale: 50, cutDepthFraction: 0.3, cloudVertices: 8, cloudAmplitudeMm: 1 });
    expect(checkScaleFit(feature, aux, 100).fits).toBe(false);
  });

  it('suggested scale is positive', () => {
    const aux = generateAuxView(feature, { x: 0, y: 0 }, 'A');
    expect(checkScaleFit(feature, aux).suggested).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports cloud + aux scale', () => {
    const b = generateBreakout(feature, 'xy');
    const a = generateAuxView(feature, { x: 0, y: 0 }, 'A');
    const s = summarize(b, a);
    expect(s.breakoutCloudVertexCount).toBe(b.cloudPolygon.length);
    expect(s.auxScale).toBe(1);
  });
});
