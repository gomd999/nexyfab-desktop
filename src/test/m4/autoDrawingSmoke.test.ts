/**
 * M4 v0: 2D 도면 생성 파이프 최소 회귀 — `generateDrawing`이 뷰·지오메트리를 생산하는지.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeDrawingGeometryFingerprint, generateDrawing } from '@/app/[lang]/shape-generator/analysis/autoDrawing';

describe('M4 auto drawing smoke', () => {
  it('generateDrawing returns one front view with line geometry for a box', () => {
    const geom = new THREE.BoxGeometry(10, 20, 30);
    const result = generateDrawing(geom, {
      views: ['front'],
      scale: 1,
      paperSize: 'A4',
      orientation: 'portrait',
      showDimensions: false,
      showCenterlines: false,
      tolerance: { linear: '±0.1', angular: "±0°30'" },
      roughness: [{ ra: 3.2, nx: 0, ny: 1 }],
      titleBlock: {
        partName: 'SmokePart',
        material: 'Al6061',
        drawnBy: 'vitest',
        date: '2026-04-30',
        scale: '1:1',
        revision: 'A',
      },
    });

    expect(result.views.length).toBe(1);
    expect(result.views[0].projection).toBe('front');
    expect(result.views[0].lines.length).toBeGreaterThan(0);
    expect(result.paperWidth).toBeGreaterThan(0);
    expect(result.paperHeight).toBeGreaterThan(0);
    expect(result.titleBlock.partName).toBe('SmokePart');
  });

  it('generateDrawing returns front+top+right with lines in each view', () => {
    const geom = new THREE.BoxGeometry(8, 12, 16);
    const result = generateDrawing(geom, {
      views: ['front', 'top', 'right'],
      scale: 1,
      paperSize: 'A3',
      orientation: 'landscape',
      showDimensions: false,
      showCenterlines: false,
      tolerance: { linear: '±0.1', angular: "±0°30'" },
      roughness: [],
      titleBlock: {
        partName: 'MultiView',
        material: 'Steel',
        drawnBy: 'vitest',
        date: '2026-04-30',
        scale: '1:2',
        revision: 'B',
      },
    });
    expect(result.views.length).toBe(3);
    const proj = result.views.map(v => v.projection).join(',');
    expect(proj).toBe('front,top,right');
    for (const v of result.views) {
      expect(v.lines.length).toBeGreaterThan(0);
    }
  });

  it('computeDrawingGeometryFingerprint is stable for identical geometry', () => {
    const a = new THREE.BoxGeometry(5, 6, 7);
    const b = new THREE.BoxGeometry(5, 6, 7);
    expect(computeDrawingGeometryFingerprint(a)).toBe(computeDrawingGeometryFingerprint(b));
    const c = new THREE.BoxGeometry(5, 6, 8);
    expect(computeDrawingGeometryFingerprint(a)).not.toBe(computeDrawingGeometryFingerprint(c));
  });
});
