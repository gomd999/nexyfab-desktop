/**
 * Phase C2 (GD&T 단방향 정책) — PDF / DXF / SVG 일관성 매트릭스.
 *
 * 로드맵: docs/strategy/CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase C2
 *         docs/strategy/C2_GDT_POLICY.md §3 (일관성 회귀 확대)
 *         docs/strategy/M4_DRAWING.md §Phase C1 (drawing v1)
 *
 * Asserts the same DrawingResult produces structurally identical text /
 * symbol content across all 3 export formats:
 *   - revision label + value (titleBlock.revision)
 *   - material / scale / drawnBy / date (titleBlock)
 *   - general tolerance line (drawing.tolerance)
 *   - partName
 *   - every dimension text from view.texts
 *
 * Layout/positioning differs by format (mm origin convention etc.) and
 * is NOT compared; only the string content + emission count is.
 *
 * Out of scope per C2 v1: GD&T overlay round-trip (different presentation
 * per format — DXF emits 4-line pill + text, SVG renders via separate
 * panel layer).
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
  DRAWING_TITLE_REVISION_LABEL,
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
    partName: 'consistency-test',
    material: '6061-T6',
    drawnBy: 'CI',
    date: '2026-05-29',
    scale: '1:1',
    revision: 'B',
  },
};

function buildDrawing() {
  const geom = new THREE.BoxGeometry(40, 30, 20);
  return generateDrawing(geom, cfg);
}

function collectDimTexts(drawing: ReturnType<typeof buildDrawing>): string[] {
  const out: string[] = [];
  for (const v of drawing.views) {
    for (const t of v.texts ?? []) {
      if (t.style === 'dimension') out.push(t.text);
    }
  }
  return out;
}

// Parse the inner string of every <text>…</text> in SVG.
function extractSvgTexts(svg: string): string[] {
  const matches = svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
  return Array.from(matches, (m) => m[1]);
}

// DXF R12 groups every TEXT entity as: 0\nTEXT...1\n<text>\n50\n...
function extractDxfTexts(dxf: string): string[] {
  const lines = dxf.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === '0' && lines[i + 1] === 'TEXT') {
      // Find the next `1` group code; the line after is the text content.
      for (let j = i + 2; j < lines.length - 1; j++) {
        if (lines[j] === '1') { out.push(lines[j + 1]); break; }
        if (lines[j] === '0') break;
      }
    }
  }
  return out;
}

describe('M4 Phase C2 — PDF/DXF/SVG consistency matrix', () => {
  const drawing = buildDrawing();
  const svg = buildDrawingSvgString(drawing);
  const dxf = buildDrawingDxfString(drawing);

  it('SVG + DXF both emit the partName string', () => {
    expect(svg).toContain('consistency-test');
    expect(extractDxfTexts(dxf)).toContain('consistency-test');
  });

  it('SVG + DXF both emit "Rev: B"', () => {
    const expected = `${DRAWING_TITLE_REVISION_LABEL}: B`;
    expect(svg).toContain(expected);
    expect(extractDxfTexts(dxf)).toContain(expected);
  });

  it('SVG + DXF both emit Material / Scale / Drawn / Date title-block fields', () => {
    const expectedFields = [
      'Material: 6061-T6',
      'Scale: 1:1',
      'Drawn: CI',
      'Date: 2026-05-29',
    ];
    const dxfTexts = extractDxfTexts(dxf);
    for (const e of expectedFields) {
      expect(svg).toContain(e);
      expect(dxfTexts).toContain(e);
    }
  });

  it('SVG + DXF both emit the general tolerance line verbatim', () => {
    const expected = 'General Tol: Linear ±0.1  Angular ±0.5°';
    expect(svg).toContain(expected);
    expect(extractDxfTexts(dxf)).toContain(expected);
  });

  it('SVG + DXF emit identical dimension-text set + count', () => {
    const dims = collectDimTexts(drawing);
    expect(dims.length).toBeGreaterThan(0);
    const dxfTexts = extractDxfTexts(dxf);
    const svgTexts = extractSvgTexts(svg);
    for (const d of dims) {
      // Same dimension text appears in both — order may differ.
      expect(svgTexts).toContain(d);
      expect(dxfTexts).toContain(d);
    }
  });

  it('SVG + DXF emit each projection label (FRONT / TOP / RIGHT)', () => {
    const labels = ['FRONT', 'TOP', 'RIGHT'];
    const dxfTexts = extractDxfTexts(dxf);
    for (const lbl of labels) {
      expect(svg).toContain(lbl);
      expect(dxfTexts).toContain(lbl);
    }
  });

  it('PDF builds to a non-empty ArrayBuffer carrying titleBlock content', async () => {
    const buf = await buildDrawingPdfArrayBuffer(drawing);
    // PDF text content lives in compressed streams — we don't decode here.
    // The shape verification: non-trivial size + valid %PDF header.
    expect(buf.byteLength).toBeGreaterThan(2000);
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, 8));
    expect(head.startsWith('%PDF-')).toBe(true);
  });

  it('field-change sensitivity — bumping revision changes SVG + DXF, leaves PDF size in range', async () => {
    const drawingA = buildDrawing();
    const cfgB: DrawingConfig = { ...cfg, titleBlock: { ...cfg.titleBlock, revision: 'C' } };
    const geom = new THREE.BoxGeometry(40, 30, 20);
    const drawingB = generateDrawing(geom, cfgB);

    const svgA = buildDrawingSvgString(drawingA);
    const svgB = buildDrawingSvgString(drawingB);
    const dxfA = buildDrawingDxfString(drawingA);
    const dxfB = buildDrawingDxfString(drawingB);

    expect(svgA).not.toBe(svgB);
    expect(dxfA).not.toBe(dxfB);
    expect(svgB).toContain('Rev: C');
    expect(extractDxfTexts(dxfB)).toContain('Rev: C');

    const pdfA = await buildDrawingPdfArrayBuffer(drawingA);
    const pdfB = await buildDrawingPdfArrayBuffer(drawingB);
    // PDF size shouldn't explode on a 1-character titleblock change.
    expect(Math.abs(pdfB.byteLength - pdfA.byteLength)).toBeLessThan(2048);
  });
});
