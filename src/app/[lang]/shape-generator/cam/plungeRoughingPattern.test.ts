import { describe, it, expect } from 'vitest';
import {
  generatePattern,
  travelDistance,
  summarize,
  type Polygon,
} from './plungeRoughingPattern';

const pocket: Polygon = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 30 },
  { x: 0, y: 30 },
];

describe('generatePattern', () => {
  it('produces plunge points inside pocket', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, depthMm: 10 });
    expect(r.plungeCount).toBeGreaterThan(0);
  });

  it('stepover = toolDiameter × (1 − overlap)', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 10, overlapFraction: 0.3, depthMm: 10 });
    expect(r.stepoverMm).toBeCloseTo(7, 6);
  });

  it('more overlap → smaller stepover → more plunges', () => {
    const low = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, overlapFraction: 0.1, depthMm: 10 });
    const high = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, overlapFraction: 0.6, depthMm: 10 });
    expect(high.plungeCount).toBeGreaterThan(low.plungeCount);
  });

  it('peck depth splits plunge into pecks', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, depthMm: 10, peckDepthMm: 2 });
    expect(r.plunges[0]!.pecks).toBe(5);
  });

  it('no peck depth → single peck', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, depthMm: 10 });
    expect(r.plunges[0]!.pecks).toBe(1);
  });

  it('serpentine ordering (orders are sequential)', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, depthMm: 10 });
    const orders = r.plunges.map(p => p.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('degenerate polygon → warning', () => {
    const r = generatePattern({ pocketPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }], toolDiameterMm: 6, depthMm: 10 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('coverage percent between 0 and 100', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, depthMm: 10 });
    expect(r.coveragePercent).toBeGreaterThan(0);
    expect(r.coveragePercent).toBeLessThanOrEqual(100);
  });

  it('zero depth → warning', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, depthMm: 0 });
    expect(r.warnings.some(w => w.toLowerCase().includes('depth'))).toBe(true);
  });
});

describe('travelDistance', () => {
  it('positive travel for non-empty pattern', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, depthMm: 10 });
    expect(travelDistance(r, 10)).toBeGreaterThan(0);
  });

  it('deeper plunges → more travel', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, depthMm: 10 });
    expect(travelDistance(r, 20)).toBeGreaterThan(travelDistance(r, 5));
  });
});

describe('summarize', () => {
  it('reports plunge count + stepover', () => {
    const r = generatePattern({ pocketPolygon: pocket, toolDiameterMm: 6, depthMm: 10 });
    const s = summarize(r);
    expect(s.plungeCount).toBe(r.plungeCount);
    expect(s.stepoverMm).toBe(r.stepoverMm);
  });
});
