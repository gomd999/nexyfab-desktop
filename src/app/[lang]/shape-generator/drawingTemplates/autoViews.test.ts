import { describe, it, expect } from 'vitest';
import {
  layoutThreeView,
  addIsoView,
  layoutSectionView,
  layoutDetailView,
  type Bbox3,
} from './autoViews';

const bbox: Bbox3 = { width: 100, depth: 60, height: 40 };

describe('layoutThreeView', () => {
  it('third-angle: places front + top + right', () => {
    const r = layoutThreeView(bbox, 'A3', 'third');
    const kinds = r.views.map(v => v.kind).sort();
    expect(kinds).toEqual(['front', 'right', 'top']);
  });

  it('first-angle: places front + top + left', () => {
    const r = layoutThreeView(bbox, 'A3', 'first');
    const kinds = r.views.map(v => v.kind).sort();
    expect(kinds).toEqual(['front', 'left', 'top']);
  });

  it('third-angle top is above front', () => {
    const r = layoutThreeView(bbox, 'A3', 'third');
    const top = r.views.find(v => v.kind === 'top')!;
    const front = r.views.find(v => v.kind === 'front')!;
    expect(top.y).toBeGreaterThan(front.y);
  });

  it('first-angle top is below front', () => {
    const r = layoutThreeView(bbox, 'A3', 'first');
    const top = r.views.find(v => v.kind === 'top')!;
    const front = r.views.find(v => v.kind === 'front')!;
    expect(top.y).toBeLessThan(front.y);
  });

  it('scale chosen to fit sheet', () => {
    const r = layoutThreeView(bbox, 'A4', 'third');
    expect(r.scale).toBeGreaterThan(0);
    expect(r.scale).toBeLessThanOrEqual(10);
  });

  it('huge part on small sheet — scale shrinks', () => {
    const r = layoutThreeView({ width: 5000, depth: 5000, height: 5000 }, 'A4');
    expect(r.scale).toBeLessThan(0.1);
  });

  it('content bbox encloses all views', () => {
    const r = layoutThreeView(bbox, 'A3');
    for (const v of r.views) {
      expect(v.x).toBeGreaterThanOrEqual(r.contentBbox.minX);
      expect(v.x + v.widthMm).toBeLessThanOrEqual(r.contentBbox.maxX);
      expect(v.y).toBeGreaterThanOrEqual(r.contentBbox.minY);
      expect(v.y + v.heightMm).toBeLessThanOrEqual(r.contentBbox.maxY);
    }
  });

  it('front view width = bbox.width × scale', () => {
    const r = layoutThreeView(bbox, 'A3');
    const front = r.views.find(v => v.kind === 'front')!;
    expect(front.widthMm).toBeCloseTo(bbox.width * r.scale, 5);
  });
});

describe('addIsoView', () => {
  it('adds a 4th view of kind iso', () => {
    const base = layoutThreeView(bbox, 'A3');
    const r = addIsoView(base, bbox, 'A3');
    expect(r.views).toHaveLength(4);
    expect(r.views[3]!.kind).toBe('iso');
  });

  it('preserves scale of base layout', () => {
    const base = layoutThreeView(bbox, 'A3');
    const r = addIsoView(base, bbox, 'A3');
    expect(r.scale).toBe(base.scale);
  });
});

describe('layoutSectionView', () => {
  it('adds a section view with label', () => {
    const base = layoutThreeView(bbox, 'A3');
    const r = layoutSectionView(bbox, base, {
      label: 'A',
      cutNormal: [0, 0, 1],
      cutOffset: 20,
      parentView: 'front',
    }, 'A3');
    const sec = r.views.find(v => v.kind === 'section');
    expect(sec).toBeDefined();
    expect(sec!.label).toContain('A-A');
  });

  it('scaleMultiplier amplifies section view scale', () => {
    const base = layoutThreeView(bbox, 'A3');
    const r = layoutSectionView(bbox, base, {
      label: 'B',
      cutNormal: [0, 1, 0],
      cutOffset: 30,
      parentView: 'front',
      scaleMultiplier: 2,
    }, 'A3');
    const sec = r.views.find(v => v.kind === 'section')!;
    expect(sec.scale).toBe(base.scale * 2);
  });
});

describe('layoutDetailView', () => {
  it('detail view scaled by multiplier', () => {
    const base = layoutThreeView(bbox, 'A3');
    const r = layoutDetailView(base, {
      label: 'C',
      parentBox: { x: 50, y: 50, widthMm: 20, heightMm: 15 },
      scaleMultiplier: 3,
    }, 'A3');
    const detail = r.views.find(v => v.kind === 'detail')!;
    expect(detail.widthMm).toBe(20 * 3);
    expect(detail.heightMm).toBe(15 * 3);
    expect(detail.label).toContain('Detail C');
  });
});
