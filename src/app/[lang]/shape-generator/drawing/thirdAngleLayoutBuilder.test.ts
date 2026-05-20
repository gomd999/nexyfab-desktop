import { describe, it, expect } from 'vitest';
import {
  buildLayout,
  validateLayout,
  summarize,
  type BBox3D,
} from './thirdAngleLayoutBuilder';

function smallPart(): BBox3D {
  return { widthMm: 100, depthMm: 50, heightMm: 30 };
}

describe('buildLayout', () => {
  it('produces 3 views minimum (front/top/right)', () => {
    const r = buildLayout(smallPart(), { includeIsometric: false });
    expect(r.views).toHaveLength(3);
  });

  it('isometric view added when requested', () => {
    const r = buildLayout(smallPart(), { includeIsometric: true });
    expect(r.views.some(v => v.view === 'iso')).toBe(true);
  });

  it('third-angle: top above front', () => {
    const r = buildLayout(smallPart(), { projection: 'third-angle', includeIsometric: false });
    const front = r.views.find(v => v.view === 'front')!;
    const top = r.views.find(v => v.view === 'top')!;
    expect(top.origin.y).toBeGreaterThan(front.origin.y);
  });

  it('third-angle: right to the right of front', () => {
    const r = buildLayout(smallPart(), { projection: 'third-angle', includeIsometric: false });
    const front = r.views.find(v => v.view === 'front')!;
    const right = r.views.find(v => v.view === 'right')!;
    expect(right.origin.x).toBeGreaterThan(front.origin.x);
  });

  it('first-angle: top below front', () => {
    const r = buildLayout(smallPart(), { projection: 'first-angle', includeIsometric: false });
    const front = r.views.find(v => v.view === 'front')!;
    const top = r.views.find(v => v.view === 'top')!;
    expect(top.origin.y).toBeLessThan(front.origin.y);
  });

  it('all views share same scale', () => {
    const r = buildLayout(smallPart());
    for (const v of r.views) {
      expect(v.scale).toBe(r.scale);
    }
  });

  it('scale chosen from standard ladder', () => {
    const r = buildLayout(smallPart());
    const standard = [1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
    expect(standard).toContain(r.scale);
  });

  it('huge part picks smaller scale', () => {
    const big: BBox3D = { widthMm: 5000, depthMm: 3000, heightMm: 2000 };
    const r = buildLayout(big);
    expect(r.scale).toBeLessThan(0.5);
  });

  it('view widths reflect bbox × scale', () => {
    const r = buildLayout(smallPart());
    const front = r.views.find(v => v.view === 'front')!;
    expect(front.widthMm).toBeCloseTo(100 * r.scale, 5);
    expect(front.heightMm).toBeCloseTo(30 * r.scale, 5);
  });
});

describe('validateLayout', () => {
  it('valid layout passes', () => {
    const r = buildLayout(smallPart());
    const v = validateLayout(r);
    expect(v.isValid).toBe(true);
  });

  it('detects overflowing view', () => {
    const r = buildLayout(smallPart());
    // Force a view out of bounds.
    r.views[0]!.origin = { x: 999, y: 999 };
    r.views[0]!.widthMm = 1000;
    const v = validateLayout(r);
    expect(v.isValid).toBe(false);
  });
});

describe('summarize', () => {
  it('reports view count + scale', () => {
    const r = buildLayout(smallPart());
    const s = summarize(r);
    expect(s.viewCount).toBe(r.views.length);
    expect(s.scale).toBe(r.scale);
  });

  it('coverage fraction in [0, 1]', () => {
    const r = buildLayout(smallPart());
    const s = summarize(r);
    expect(s.sheetCoverageFraction).toBeGreaterThan(0);
    expect(s.sheetCoverageFraction).toBeLessThanOrEqual(1);
  });
});
