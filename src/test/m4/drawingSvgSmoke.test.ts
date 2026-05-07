/**
 * M4: headless SVG export — `buildDrawingSvgString` (CI + diff-friendly archives).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateDrawing } from '@/app/[lang]/shape-generator/analysis/autoDrawing';
import {
  buildDrawingSvgString,
  DRAWING_TITLE_REVISION_LABEL,
} from '@/app/[lang]/shape-generator/analysis/drawingExport';

const sampleConfig = {
  views: ['front', 'top'] as ('front' | 'top')[],
  scale: 1,
  paperSize: 'A4' as const,
  orientation: 'portrait' as const,
  showDimensions: true,
  showCenterlines: true,
  tolerance: { linear: '±0.1', angular: "±0°30'" },
  roughness: [{ ra: 3.2, nx: 0, ny: 1 }],
  titleBlock: {
    partName: 'SvgSmokePart',
    material: 'Al6061',
    drawnBy: 'vitest',
    date: '2026-04-30',
    scale: '1:1',
    revision: 'C',
  },
};

describe('M4 drawing SVG smoke', () => {
  it('buildDrawingSvgString yields valid XML with views, title block, and escaped tolerance', () => {
    const geom = new THREE.BoxGeometry(12, 18, 24);
    const drawing = generateDrawing(geom, sampleConfig);
    const svg = buildDrawingSvgString(drawing);

    expect(svg.startsWith('<?xml version="1.0"')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<svg ');
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('FRONT');
    expect(svg).toContain('TOP');
    expect(svg).toContain('SvgSmokePart');
    expect(svg).toContain(`${DRAWING_TITLE_REVISION_LABEL}: C`);
    expect(svg).toContain('General Tol');
    expect(svg).toContain('Linear');
    expect((svg.match(/<line /g) ?? []).length).toBeGreaterThan(4);
  });
});
