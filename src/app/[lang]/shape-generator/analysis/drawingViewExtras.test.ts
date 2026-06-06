/**
 * drawingViewExtras — closed-form checks for the detail-view magnification and
 * the 45° section hatch. Pure SVG-geometry helpers feeding AutoDrawingPanel;
 * previously untested.
 */
import { describe, it, expect } from 'vitest';
import { buildDetailView, buildSectionView } from './drawingViewExtras';
import type { DrawingLine } from './autoDrawing';

describe('buildDetailView', () => {
  it('magnifies geometry about the focal centre and fills the box', () => {
    // 20 mm horizontal line through the focal centre (50,50), radius 10, mag 3.
    const src: DrawingLine[] = [{ x1: 40, y1: 50, x2: 60, y2: 50, type: 'visible' }];
    const d = buildDetailView(src, {
      centerX: 50, centerY: 50, radius: 10, magnification: 3, placeX: 100, placeY: 100, label: 'A',
    });
    const l = d.lines[0]!;
    expect(Math.hypot(l.x2 - l.x1, l.y2 - l.y1)).toBeCloseTo(60, 6); // 20 × 3
    // Endpoints land on the box's left/right edges (box width = 2·r·mag = 60).
    expect(l.x1).toBeCloseTo(100, 6);
    expect(l.x2).toBeCloseTo(160, 6);
    expect(d.bounds.w).toBeCloseTo(60, 6);
    expect(d.bounds.h).toBeCloseTo(60, 6);
    expect(d.caption).toBe('Detail A — Scale 3:1');
  });

  it('keeps the focal centre at the box centre', () => {
    const src: DrawingLine[] = [{ x1: 50, y1: 50, x2: 50, y2: 50, type: 'visible' }];
    const d = buildDetailView(src, {
      centerX: 50, centerY: 50, radius: 5, magnification: 2, placeX: 0, placeY: 0, label: 'B',
    });
    const l = d.lines[0]!;
    expect(l.x1).toBeCloseTo(10, 6); // box centre = placeX + r·mag = 10
    expect(l.y1).toBeCloseTo(10, 6);
  });

  it('drops lines wholly outside the focal region', () => {
    const src: DrawingLine[] = [{ x1: 200, y1: 200, x2: 210, y2: 200, type: 'visible' }];
    const d = buildDetailView(src, {
      centerX: 50, centerY: 50, radius: 10, magnification: 2, placeX: 0, placeY: 0, label: 'A',
    });
    expect(d.lines).toHaveLength(0);
  });
});

describe('buildSectionView', () => {
  it('emits 45° hatch lines clipped inside the section box', () => {
    const s = buildSectionView({
      x1: 0, y1: 0, x2: 10, y2: 0, placeX: 0, placeY: 0, width: 8, height: 8, label: 'B', hatchSpacing: 2,
    });
    expect(s.hatch.length).toBeGreaterThan(0);
    for (const h of s.hatch) {
      // slope exactly 1 (45°).
      expect((h.y2 - h.y1) / (h.x2 - h.x1)).toBeCloseTo(1, 6);
      // inside the box.
      expect(h.x1).toBeGreaterThanOrEqual(-1e-6);
      expect(h.x2).toBeLessThanOrEqual(8 + 1e-6);
      expect(h.y1).toBeGreaterThanOrEqual(-1e-6);
      expect(h.y2).toBeLessThanOrEqual(8 + 1e-6);
    }
    expect(s.caption).toBe('Section B-B');
    expect(s.bounds).toEqual({ x: 0, y: 0, w: 8, h: 8 });
  });

  it('denser spacing produces more hatch lines', () => {
    const base = { x1: 0, y1: 0, x2: 10, y2: 0, placeX: 0, placeY: 0, width: 10, height: 10, label: 'A' };
    const coarse = buildSectionView({ ...base, hatchSpacing: 3 });
    const fine = buildSectionView({ ...base, hatchSpacing: 1 });
    expect(fine.hatch.length).toBeGreaterThan(coarse.hatch.length);
  });
});
