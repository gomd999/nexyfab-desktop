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
