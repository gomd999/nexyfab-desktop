import { describe, it, expect } from 'vitest';
import {
  generatePath,
  recommendFeed,
  summarize,
  type EdgeLoop,
} from './chamferDeburrPath';

const square: EdgeLoop = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 40 },
  { x: 0, y: 40 },
];

describe('generatePath', () => {
  it('produces path points at negative Z', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 1 });
    expect(r.path.length).toBe(square.length);
    expect(r.path.every(p => p.z < 0)).toBe(true);
  });

  it('45° tool → depth = chamfer width', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 2, toolHalfAngleDeg: 45 });
    expect(r.depthMm).toBeCloseTo(2, 6);
  });

  it('30° tool → depth > chamfer width', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 2, toolHalfAngleDeg: 30 });
    expect(r.depthMm).toBeGreaterThan(2);
  });

  it('lateral offset = width + tip offset', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 1, toolTipOffsetMm: 0.3 });
    expect(r.lateralOffsetMm).toBeCloseTo(1.3, 6);
  });

  it('contact length positive', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 1 });
    expect(r.contactLengthMm).toBeGreaterThan(0);
  });

  it('cycle time = contact / feed', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 1, feedMmPerMin: 600 });
    expect(r.cycleTimeMin).toBeCloseTo(r.contactLengthMm / 600, 6);
  });

  it('no feed → null cycle time', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 1 });
    expect(r.cycleTimeMin).toBeNull();
  });

  it('too few points → warning', () => {
    const r = generatePath({ edgeLoop: [{ x: 0, y: 0 }], chamferWidthMm: 1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero chamfer → warning', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('offset moves points inward for closed loop', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 2, toolTipOffsetMm: 0 });
    // First vertex (0,0) should move toward interior (positive x and y).
    expect(r.path[0]!.x).toBeGreaterThan(0);
    expect(r.path[0]!.y).toBeGreaterThan(0);
  });
});

describe('recommendFeed', () => {
  it('smaller chamfer → higher feed', () => {
    expect(recommendFeed(0.5)).toBeGreaterThan(recommendFeed(3));
  });

  it('harder material → lower feed', () => {
    expect(recommendFeed(1, 2)).toBeLessThan(recommendFeed(1, 1));
  });

  it('feed never below 50', () => {
    expect(recommendFeed(100, 10)).toBeGreaterThanOrEqual(50);
  });
});

describe('summarize', () => {
  it('reports point count + depth', () => {
    const r = generatePath({ edgeLoop: square, closed: true, chamferWidthMm: 1 });
    const s = summarize(r);
    expect(s.pointCount).toBe(r.path.length);
    expect(s.depthMm).toBe(r.depthMm);
  });
});
