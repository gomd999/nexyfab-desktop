/**
 * M4: PDF + DXF export from `DrawingResult` — same path as UI download (no browser save).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateDrawing } from '@/app/[lang]/shape-generator/analysis/autoDrawing';
import {
  buildDrawingDxfString,
  buildDrawingPdfArrayBuffer,
  DRAWING_TITLE_REVISION_LABEL,
} from '@/app/[lang]/shape-generator/analysis/drawingExport';

const sampleConfig = {
  views: ['front'] as const,
  scale: 1,
  paperSize: 'A4' as const,
  orientation: 'portrait' as const,
  showDimensions: false,
  showCenterlines: false,
  tolerance: { linear: '±0.1', angular: "±0°30'" },
  roughness: [{ ra: 3.2, nx: 0, ny: 1 }],
  titleBlock: {
    partName: 'ExportSmokePart',
    material: 'Al6061',
    drawnBy: 'vitest',
    date: '2026-04-30',
    scale: '1:1',
    revision: 'A',
  },
};

describe('M4 drawing export smoke', () => {
  it('buildDrawingDxfString yields R12 DXF with entities and title block', () => {
    const geom = new THREE.BoxGeometry(10, 20, 30);
    const drawing = generateDrawing(geom, { ...sampleConfig, views: ['front'] });
    const dxf = buildDrawingDxfString(drawing);

    expect(dxf).toContain('AC1009');
    expect(dxf).toContain('0\nLINE\n');
    expect(dxf).toContain('ExportSmokePart');
    expect(dxf).toContain(`${DRAWING_TITLE_REVISION_LABEL}: A`);
    expect(dxf).toMatch(/0\nEOF\n$/);
    expect(dxf.length).toBeGreaterThan(500);
  });

  it('emits the LTYPE table with a DASHED linetype for hidden lines', () => {
    const geom = new THREE.BoxGeometry(10, 20, 30);
    const drawing = generateDrawing(geom, { ...sampleConfig, views: ['front'] });
    const dxf = buildDrawingDxfString(drawing);
    expect(dxf).toContain('0\nTABLE\n2\nLTYPE\n');
    expect(dxf).toContain('0\nLTYPE\n2\nDASHED\n');
    // HIDDEN layer references the DASHED linetype (code 6).
    expect(dxf).toMatch(/0\nLAYER\n2\nHIDDEN\n[\s\S]*?6\nDASHED\n/);
  });

  it('collapses a cylinder view into true CIRCLE/ARC entities (not faceted LINEs)', () => {
    // A cylinder viewed down its axis projects to a circle; tessellation gives a
    // 32-chord fan that detectCirclesAndArcs should collapse to a CIRCLE.
    const geom = new THREE.CylinderGeometry(15, 15, 40, 48);
    // 'top' looks down the cylinder's Y axis → circular outline.
    const drawing = generateDrawing(geom, { ...sampleConfig, views: ['top'] });
    const dxf = buildDrawingDxfString(drawing);
    expect(dxf).toMatch(/0\n(CIRCLE|ARC)\n/);
  });

  it('buildDrawingPdfArrayBuffer yields a non-trivial PDF header', async () => {
    const geom = new THREE.BoxGeometry(10, 20, 30);
    const drawing = generateDrawing(geom, { ...sampleConfig, views: ['front'] });
    const buf = await buildDrawingPdfArrayBuffer(drawing);
    expect(buf.byteLength).toBeGreaterThan(2000);

    const head = new Uint8Array(buf.slice(0, 5));
    const ascii = String.fromCharCode(...head);
    expect(ascii).toBe('%PDF-');
  });
});
