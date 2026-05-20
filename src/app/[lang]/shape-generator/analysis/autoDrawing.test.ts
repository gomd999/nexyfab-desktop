import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  projectGeometry,
  computeDrawingGeometryFingerprint,
  type ProjectionView,
} from './autoDrawing';
import { buildDrawingSvgString } from './drawingExport';

function makeBox(w = 60, h = 40, d = 20): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  g.computeBoundingBox();
  return g;
}

describe('projectGeometry · view-direction sanity', () => {
  // For a centred box, the front projection should produce 2D extents
  // matching the box width × height (X × Y in world). Other views map
  // different axes — we sanity-check the bbox of the produced lines.
  function projectedBBox(view: ProjectionView, box = makeBox(60, 40, 20)) {
    const lines = projectGeometry(box, view, 1);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of lines) {
      minX = Math.min(minX, l.x1, l.x2);
      maxX = Math.max(maxX, l.x1, l.x2);
      minY = Math.min(minY, l.y1, l.y2);
      maxY = Math.max(maxY, l.y1, l.y2);
    }
    return { w: maxX - minX, h: maxY - minY };
  }

  it('front view shows world X × Y (60 × 40 box → 60 wide, 40 tall)', () => {
    const r = projectedBBox('front');
    expect(r.w).toBeCloseTo(60, 0);
    expect(r.h).toBeCloseTo(40, 0);
  });

  it('top view shows world X × Z (60 × 40 × 20 → 60 wide, 20 tall)', () => {
    const r = projectedBBox('top');
    expect(r.w).toBeCloseTo(60, 0);
    expect(r.h).toBeCloseTo(20, 0);
  });

  it('right view shows world Z × Y (60 × 40 × 20 → 20 wide, 40 tall)', () => {
    const r = projectedBBox('right');
    expect(r.w).toBeCloseTo(20, 0);
    expect(r.h).toBeCloseTo(40, 0);
  });

  it('produces non-empty output for all 7 view types', () => {
    const box = makeBox();
    const views: ProjectionView[] = ['front', 'top', 'right', 'left', 'back', 'bottom', 'iso'];
    for (const v of views) {
      const lines = projectGeometry(box, v, 1);
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  it('scale multiplier scales line coordinates linearly', () => {
    const box = makeBox(60, 40, 20);
    const at1 = projectGeometry(box, 'front', 1);
    const at2 = projectGeometry(box, 'front', 2);
    // Same number of lines, every coordinate doubled.
    expect(at2.length).toBe(at1.length);
    for (let i = 0; i < at1.length; i++) {
      expect(at2[i].x1).toBeCloseTo(at1[i].x1 * 2, 3);
      expect(at2[i].y1).toBeCloseTo(at1[i].y1 * 2, 3);
    }
  });

  it('returns empty for geometry without a position attribute', () => {
    const empty = new THREE.BufferGeometry();
    expect(projectGeometry(empty, 'front', 1)).toEqual([]);
  });
});

describe('computeDrawingGeometryFingerprint', () => {
  it('is stable for the same geometry across calls', () => {
    const a = makeBox(50, 30, 20);
    const f1 = computeDrawingGeometryFingerprint(a);
    const f2 = computeDrawingGeometryFingerprint(a);
    expect(f1).toBe(f2);
  });

  it('differs when the geometry size changes', () => {
    const a = makeBox(50, 30, 20);
    const b = makeBox(80, 30, 20);
    expect(computeDrawingGeometryFingerprint(a))
      .not.toBe(computeDrawingGeometryFingerprint(b));
  });

  it('returns the empty marker for an empty geometry', () => {
    const empty = new THREE.BufferGeometry();
    expect(computeDrawingGeometryFingerprint(empty)).toBe('g:empty');
  });
});

describe('buildDrawingSvgString', () => {
  it('emits a valid SVG document with viewBox + paper rectangle', () => {
    const drawing = {
      views: [],
      titleBlock: { partName: 'P', material: 'M', drawnBy: 'D', date: '2026-05-17', scale: '1:1', revision: 'A' },
      paperWidth: 297,
      paperHeight: 210,
    };
    const svg = buildDrawingSvgString(drawing);
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toContain('viewBox="0 0 297 210"');
    expect(svg).toContain('width="297mm"');
    expect(svg).toContain('<rect');
  });

  it('escapes XML special characters in view labels', () => {
    const drawing = {
      views: [{
        projection: 'front' as const,
        lines: [],
        texts: [{ x: 0, y: 0, text: 'A & B <ok>', fontSize: 3, anchor: 'middle' as const, style: 'note' as const }],
        position: { x: 50, y: 50 },
        width: 50,
        height: 50,
      }],
      titleBlock: { partName: '', material: '', drawnBy: '', date: '', scale: '', revision: '' },
      paperWidth: 297,
      paperHeight: 210,
    };
    const svg = buildDrawingSvgString(drawing);
    expect(svg).toContain('A &amp; B &lt;ok&gt;');
    expect(svg).not.toContain('A & B <ok>');
  });
});
