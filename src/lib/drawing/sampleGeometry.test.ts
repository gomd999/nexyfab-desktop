/**
 * sampleGeometry.test — verifies the drawing-page sample-part → STEP
 * geometry mapping. The drawing page's STEP+PMI export button depends
 * on these contracts staying stable, so the test pins both the shape
 * (kind, vertex count) and the dimensional intent (50 mm cube edge,
 * 25 mm cylinder radius, 30 mm pentagon side, depths).
 */

import { describe, it, expect } from 'vitest';
import { sampleGeometryForSourceId } from './sampleGeometry';

describe('sampleGeometryForSourceId', () => {
  it('sample-cube → extrude with a 4-vertex 50 mm × 50 mm square loop, depth 50', () => {
    const g = sampleGeometryForSourceId('sample-cube');
    expect(g.kind).toBe('extrude');
    if (g.kind !== 'extrude') throw new Error('unreachable');
    expect(g.feature.kind).toBe('extrude');
    expect(g.feature.loop.length).toBe(4);
    expect(g.feature.depth).toBe(50);
    // Square axis-aligned bbox at exactly 50 mm on each side.
    const xs = g.feature.loop.map((p) => p.x);
    const ys = g.feature.loop.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(50);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(50);
  });

  it('sample-cylinder → polygon with 16 vertices at radius 25, depth 60', () => {
    const g = sampleGeometryForSourceId('sample-cylinder');
    expect(g.kind).toBe('polygon');
    if (g.kind !== 'polygon') throw new Error('unreachable');
    expect(g.feature.loop.length).toBe(16);
    expect(g.feature.depth).toBe(60);
    // Every vertex must lie on the radius-25 circle.
    for (const pt of g.feature.loop) {
      const r = Math.hypot(pt.x, pt.y);
      expect(r).toBeCloseTo(25, 6);
    }
  });

  it('sample-pentagon → polygon with 5 vertices and ~30 mm side length, depth 40', () => {
    const g = sampleGeometryForSourceId('sample-pentagon');
    expect(g.kind).toBe('polygon');
    if (g.kind !== 'polygon') throw new Error('unreachable');
    expect(g.feature.loop.length).toBe(5);
    expect(g.feature.depth).toBe(40);
    // Measure side 0→1; all sides equal for a regular polygon so one
    // sample is sufficient.
    const a = g.feature.loop[0]!;
    const b = g.feature.loop[1]!;
    const side = Math.hypot(b.x - a.x, b.y - a.y);
    expect(side).toBeCloseTo(30, 6);
  });

  it('sample-step-001 → fallback box geometry (4-vertex 50 mm square)', () => {
    const g = sampleGeometryForSourceId('sample-step-001');
    expect(g.kind).toBe('extrude');
    if (g.kind !== 'extrude') throw new Error('unreachable');
    expect(g.feature.loop.length).toBe(4);
    expect(g.feature.depth).toBe(50);
  });

  it('unknown sourceId → default cube geometry', () => {
    const g = sampleGeometryForSourceId('some-totally-unknown-id');
    expect(g.kind).toBe('extrude');
    if (g.kind !== 'extrude') throw new Error('unreachable');
    expect(g.feature.loop.length).toBe(4);
    expect(g.feature.depth).toBe(50);
  });

  it('all sample loops have positive (CCW) signed area so the polygon writer accepts them directly', () => {
    const ids = ['sample-cube', 'sample-cylinder', 'sample-pentagon', 'sample-step-001'] as const;
    for (const id of ids) {
      const g = sampleGeometryForSourceId(id);
      if (g.kind === 'assembly') throw new Error('unexpected assembly kind');
      const loop = g.feature.loop;
      let area = 0;
      for (let i = 0; i < loop.length; i += 1) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        area += a.x * b.y - b.x * a.y;
      }
      expect(area).toBeGreaterThan(0);
    }
  });

  it('every sample geometry uses one-sided +Z extrusion in add mode', () => {
    const ids = ['sample-cube', 'sample-cylinder', 'sample-pentagon', 'sample-step-001'] as const;
    for (const id of ids) {
      const g = sampleGeometryForSourceId(id);
      if (g.kind === 'assembly') throw new Error('unexpected assembly kind');
      expect(g.feature.direction).toBe('one_sided');
      expect(g.feature.mode).toBe('add');
    }
  });

  it('cylinder vertices are evenly distributed on the circle (constant angular step)', () => {
    const g = sampleGeometryForSourceId('sample-cylinder');
    if (g.kind === 'assembly') throw new Error('unreachable');
    const loop = g.feature.loop;
    const expectedStep = (2 * Math.PI) / 16;
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const angA = Math.atan2(a.y, a.x);
      const angB = Math.atan2(b.y, b.x);
      let delta = angB - angA;
      if (delta < 0) delta += 2 * Math.PI;
      expect(delta).toBeCloseTo(expectedStep, 6);
    }
  });
});
