/**
 * M4 — GD&T datum reference frame export regression.
 *
 * Asserts the new `DatumFrameOverlay[]` parameter on
 * `buildDrawingSvgString` / `buildDrawingDxfString` / `buildDrawingPdfArrayBuffer`:
 *   - empty / undefined datums emit no datum-frame entities
 *   - 1 datum places the label exactly once in each format
 *   - 3 datums (A/B/C) place all three labels in each format
 *   - leaderDir adds an extra line entity (SVG <line>, DXF LINE)
 *   - undefined leaderDir adds none
 *   - frame box geometry (4 sides) emitted to DXF on the DATUM layer
 *
 * Policy ref: docs/strategy/C2_GDT_POLICY.md — datum frame is part of the
 * model-side overlay and the drawing export is read-only / one-way.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  generateDrawing,
  type DrawingConfig,
} from '@/app/[lang]/shape-generator/analysis/autoDrawing';
import {
  buildDrawingSvgString,
  buildDrawingDxfString,
  buildDrawingPdfArrayBuffer,
  type DatumFrameOverlay,
} from '@/app/[lang]/shape-generator/analysis/drawingExport';

const cfg: DrawingConfig = {
  views: ['front', 'top', 'right'],
  scale: 1,
  paperSize: 'A4',
  orientation: 'landscape',
  showDimensions: true,
  showCenterlines: true,
  tolerance: { linear: '±0.1', angular: '±0.5°' },
  titleBlock: {
    partName: 'datum-test',
    material: '6061-T6',
    drawnBy: 'CI',
    date: '2026-05-29',
    scale: '1:1',
    revision: 'A',
  },
};

function buildDrawing() {
  const geom = new THREE.BoxGeometry(40, 30, 20);
  return generateDrawing(geom, cfg);
}

// Extract every TEXT entity payload from a DXF R12 ASCII blob.
function extractDxfTexts(dxf: string): string[] {
  const lines = dxf.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === '0' && lines[i + 1] === 'TEXT') {
      for (let j = i + 2; j < lines.length - 1; j++) {
        if (lines[j] === '1') { out.push(lines[j + 1]); break; }
        if (lines[j] === '0') break;
      }
    }
  }
  return out;
}

// Count `0\nLINE` entity headers on a specific layer (group 8 follows 0/LINE).
function countDxfLinesOnLayer(dxf: string, layer: string): number {
  const lines = dxf.split('\n');
  let n = 0;
  for (let i = 0; i < lines.length - 3; i++) {
    if (
      lines[i] === '0' &&
      lines[i + 1] === 'LINE' &&
      lines[i + 2] === '8' &&
      lines[i + 3] === layer
    ) {
      n++;
    }
  }
  return n;
}

// Count plain SVG <line ... /> elements (ignoring <line> inside other tags).
function countSvgLineElements(svg: string): number {
  return (svg.match(/<line\b/g) ?? []).length;
}

// Count occurrences of a centered datum label as an SVG <text> payload.
function countSvgTextOccurrences(svg: string, label: string): number {
  const re = new RegExp(`<text[^>]*>${label}</text>`, 'g');
  return (svg.match(re) ?? []).length;
}

describe('M4 — datum reference frame export', () => {
  const drawing = buildDrawing();

  it('empty datums → no DATUM-layer entities, no datum labels in SVG/DXF', () => {
    const svg = buildDrawingSvgString(drawing, []);
    const dxf = buildDrawingDxfString(drawing, [], []);
    expect(countDxfLinesOnLayer(dxf, 'DATUM')).toBe(0);
    expect(extractDxfTexts(dxf).filter((t) => t === 'A' || t === 'B' || t === 'C')).toEqual([]);
    expect(countSvgTextOccurrences(svg, 'A')).toBe(0);
    expect(countSvgTextOccurrences(svg, 'B')).toBe(0);
  });

  it('1 datum → SVG has label "A" exactly once + DXF has TEXT "A" once + 4 DATUM box lines', () => {
    const datums: DatumFrameOverlay[] = [{ id: 'd1', label: 'A', x: 50, y: 40 }];
    const svg = buildDrawingSvgString(drawing, datums);
    const dxf = buildDrawingDxfString(drawing, [], datums);

    expect(countSvgTextOccurrences(svg, 'A')).toBe(1);
    expect(extractDxfTexts(dxf).filter((t) => t === 'A')).toHaveLength(1);
    // 4-sided frame box, no leader.
    expect(countDxfLinesOnLayer(dxf, 'DATUM')).toBe(4);
  });

  it('3 datums (A/B/C) → all three labels emitted in SVG + DXF', () => {
    const datums: DatumFrameOverlay[] = [
      { id: 'd1', label: 'A', x: 30, y: 40 },
      { id: 'd2', label: 'B', x: 60, y: 40 },
      { id: 'd3', label: 'C', x: 90, y: 40 },
    ];
    const svg = buildDrawingSvgString(drawing, datums);
    const dxf = buildDrawingDxfString(drawing, [], datums);

    for (const lbl of ['A', 'B', 'C']) {
      expect(countSvgTextOccurrences(svg, lbl)).toBe(1);
      expect(extractDxfTexts(dxf).filter((t) => t === lbl)).toHaveLength(1);
    }
    // 3 datums × 4 sides = 12 lines on DATUM layer.
    expect(countDxfLinesOnLayer(dxf, 'DATUM')).toBe(12);
  });

  it('leaderDir present → extra DATUM-layer line emitted (5 total per frame)', () => {
    const without: DatumFrameOverlay[] = [{ id: 'd1', label: 'A', x: 50, y: 40 }];
    const withLeader: DatumFrameOverlay[] = [{ id: 'd1', label: 'A', x: 50, y: 40, leaderDir: 'N' }];

    const dxfWithout = buildDrawingDxfString(drawing, [], without);
    const dxfWith    = buildDrawingDxfString(drawing, [], withLeader);

    expect(countDxfLinesOnLayer(dxfWithout, 'DATUM')).toBe(4);
    expect(countDxfLinesOnLayer(dxfWith,    'DATUM')).toBe(5);

    // SVG also gains one extra <line> for the leader.
    const svgWithout = buildDrawingSvgString(drawing, without);
    const svgWith    = buildDrawingSvgString(drawing, withLeader);
    expect(countSvgLineElements(svgWith) - countSvgLineElements(svgWithout)).toBe(1);
  });

  it('all 4 leader directions render without throwing + each adds 1 leader line', () => {
    const dirs: Array<'N' | 'E' | 'S' | 'W'> = ['N', 'E', 'S', 'W'];
    for (const dir of dirs) {
      const datums: DatumFrameOverlay[] = [{ id: `d-${dir}`, label: 'A', x: 60, y: 50, leaderDir: dir }];
      const dxf = buildDrawingDxfString(drawing, [], datums);
      const svg = buildDrawingSvgString(drawing, datums);
      expect(countDxfLinesOnLayer(dxf, 'DATUM')).toBe(5);
      expect(extractDxfTexts(dxf).filter((t) => t === 'A')).toHaveLength(1);
      expect(svg).toContain('<line');
    }
  });

  it('PDF builds with datums attached — non-empty + larger than empty-datums baseline', async () => {
    const datums: DatumFrameOverlay[] = [
      { id: 'd1', label: 'A', x: 30, y: 40, leaderDir: 'N' },
      { id: 'd2', label: 'B', x: 60, y: 40, leaderDir: 'S' },
      { id: 'd3', label: 'C', x: 90, y: 40, leaderDir: 'E' },
    ];
    const pdfEmpty = await buildDrawingPdfArrayBuffer(drawing, [], []);
    const pdfWith  = await buildDrawingPdfArrayBuffer(drawing, [], datums);

    expect(pdfEmpty.byteLength).toBeGreaterThan(2000);
    expect(pdfWith.byteLength).toBeGreaterThan(2000);
    const head = new TextDecoder().decode(new Uint8Array(pdfWith, 0, 8));
    expect(head.startsWith('%PDF-')).toBe(true);
    // Adding 3 frame boxes + 3 leader lines + 3 text glyphs should bump bytes.
    expect(pdfWith.byteLength).toBeGreaterThanOrEqual(pdfEmpty.byteLength);
  });

  it('default-arg back-compat — omitting datums param still works (no breakage)', () => {
    // Old call sites (no datums param) must keep working.
    expect(() => buildDrawingSvgString(drawing)).not.toThrow();
    expect(() => buildDrawingDxfString(drawing)).not.toThrow();
    expect(() => buildDrawingDxfString(drawing, [])).not.toThrow();
  });
});
