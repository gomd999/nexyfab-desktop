// @vitest-environment jsdom
/**
 * sheetRenderer.bom.test.tsx — SolidWorks-parity Phase 3.
 *
 * Acceptance: a 5-part assembly drawing sheet with BOM + balloons exported
 * to PDF. The sheet IR comes from buildAssemblyBomSheet, SheetRenderer
 * draws the BOM table + balloons from the IR, and the REAL
 * exportSheetsToPdf bundles the rendered SVG into a PDF (jspdf injected
 * via the `loadJsPdf` test seam — no module mock needed).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';
import {
  buildAssemblyBomSheet,
  type BomPartInput,
} from '@/lib/drawing/assemblyBomSheet';
import { exportSheetsToPdf } from '@/lib/drawing/pdfExport';
import { paperDimensions, type Sheet } from '@/lib/drawing/sheet';

// ─── fixture: 5-part assembly (4 distinct parts, Bracket ×2) ──────────────

function cubePart(
  id: string,
  name: string,
  pos: { x: number; y: number; z: number },
  material?: string,
): BomPartInput {
  return {
    id,
    name,
    material,
    bbox: {
      min: { x: pos.x - 15, y: pos.y - 15, z: pos.z },
      max: { x: pos.x + 15, y: pos.y + 15, z: pos.z + 30 },
    },
  };
}

function fivePartSheet(): Sheet {
  return buildAssemblyBomSheet({
    id: 'asm-bom-accept',
    name: 'BOM — acceptance',
    sourceId: 'asm-accept',
    paperSize: 'A3',
    parts: [
      cubePart('base_1', 'Base', { x: 0, y: 0, z: 0 }, 'AL6061'),
      cubePart('bracket_1', 'Bracket', { x: 50, y: 0, z: 0 }),
      cubePart('bracket_2', 'Bracket', { x: -50, y: 0, z: 0 }),
      cubePart('shaft_1', 'Shaft', { x: 0, y: 0, z: 40 }),
      cubePart('cap_1', 'Cap', { x: 0, y: 0, z: 80 }),
    ],
  });
}

// ─── canvas shims (jsdom has no real 2D context / toDataURL) ──────────────

beforeEach(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.toDataURL = function toDataURL(): string {
      return 'data:image/png;base64,iVBORw0KGgo=';
    };
    HTMLCanvasElement.prototype.getContext = function getContext(): unknown {
      return {
        fillStyle: '',
        fillRect: () => undefined,
        drawImage: () => undefined,
      };
    } as never;
  }
});

// ─── renderer assertions ───────────────────────────────────────────────────

describe('SheetRenderer — BOM table + balloons (SolidWorks-parity Phase 3)', () => {
  it('a sheet without bom/balloons renders neither layer (back-compat)', () => {
    const bare: Sheet = {
      id: 's-bare',
      name: 'bare',
      paperSize: 'A3',
      viewports: [{
        id: 'front', sourceId: 'p1',
        projection: { kind: 'standard', view: 'front' },
        centerOnSheet: { x: 150, y: 150 }, widthOnSheet: 100, scale: 1,
      }],
    };
    const { container } = render(<SheetRenderer sheet={bare} />);
    expect(container.querySelector('[data-testid="sheet-renderer-bom-table"]')).toBeNull();
    expect(container.querySelector('[data-testid="sheet-renderer-balloons"]')).toBeNull();
  });

  it('renders the BOM table with a header + 4 deduped rows', () => {
    const { container } = render(<SheetRenderer sheet={fivePartSheet()} />);
    const table = container.querySelector('[data-testid="sheet-renderer-bom-table"]')!;
    expect(table).not.toBeNull();
    expect(table.getAttribute('data-rows')).toBe('4');
    expect(table.querySelectorAll('[data-bom-row]').length).toBe(5); // header + 4
    const text = table.textContent ?? '';
    expect(text).toMatch(/PART/);
    expect(text).toMatch(/QTY/);
    expect(text).toMatch(/MATERIAL/);
    expect(text).toMatch(/Bracket/);
    expect(text).toMatch(/AL6061/);
  });

  it('renders 5 balloons — one per part instance — with item numbers', () => {
    const { container } = render(<SheetRenderer sheet={fivePartSheet()} />);
    const layer = container.querySelector('[data-testid="sheet-renderer-balloons"]')!;
    expect(layer).not.toBeNull();
    expect(layer.getAttribute('data-count')).toBe('5');
    for (const id of ['base_1', 'bracket_1', 'bracket_2', 'shaft_1', 'cap_1']) {
      expect(
        container.querySelector(`[data-testid="sheet-renderer-balloon-balloon-${id}"]`),
      ).not.toBeNull();
    }
    // Both Bracket balloons reference the same BOM item number.
    const b1 = container.querySelector('[data-testid="sheet-renderer-balloon-balloon-bracket_1"]')!;
    const b2 = container.querySelector('[data-testid="sheet-renderer-balloon-balloon-bracket_2"]')!;
    expect(b1.getAttribute('data-balloon-item')).toBe(b2.getAttribute('data-balloon-item'));
  });

  it('balloon circles in the rendered SVG do not overlap', () => {
    const { container } = render(<SheetRenderer sheet={fivePartSheet()} />);
    const groups = Array.from(
      container.querySelectorAll('[data-testid^="sheet-renderer-balloon-balloon-"]'),
    );
    // Second <circle> in each balloon group is the balloon body (first is
    // the anchor dot).
    const circles = groups.map((g) => {
      const c = g.querySelectorAll('circle')[1]!;
      return {
        x: Number(c.getAttribute('cx')),
        y: Number(c.getAttribute('cy')),
        r: Number(c.getAttribute('r')),
      };
    });
    expect(circles).toHaveLength(5);
    for (let i = 0; i < circles.length; i += 1) {
      for (let j = i + 1; j < circles.length; j += 1) {
        const d = Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y);
        expect(d).toBeGreaterThanOrEqual(circles[i].r + circles[j].r);
      }
    }
  });

  it('each balloon has a leader line ending at its anchor dot', () => {
    const { container } = render(<SheetRenderer sheet={fivePartSheet()} />);
    const groups = Array.from(
      container.querySelectorAll('[data-testid^="sheet-renderer-balloon-balloon-"]'),
    );
    for (const g of groups) {
      const line = g.querySelector('line')!;
      const dot = g.querySelectorAll('circle')[0]!;
      expect(line).not.toBeNull();
      expect(Number(line.getAttribute('x2'))).toBeCloseTo(Number(dot.getAttribute('cx')), 6);
      expect(Number(line.getAttribute('y2'))).toBeCloseTo(Number(dot.getAttribute('cy')), 6);
    }
  });
});

// ─── acceptance: 5-part sheet → PDF ────────────────────────────────────────

interface CtorCall { format?: number[]; unit?: string; orientation?: string }

describe('5-part assembly BOM sheet → PDF (acceptance)', () => {
  it('exportSheetsToPdf bundles the rendered BOM sheet into an application/pdf blob', async () => {
    const sheet = fivePartSheet();
    const { container } = render(<SheetRenderer sheet={sheet} />);
    const svg = container.querySelector(
      'svg[data-testid="sheet-renderer-root"]',
    ) as SVGElement;
    expect(svg).not.toBeNull();
    // The exported SVG carries the BOM + balloons (IR-driven, so PDF/PNG
    // inherit them with zero export-path changes).
    expect(svg.querySelector('[data-testid="sheet-renderer-bom-table"]')).not.toBeNull();
    expect(
      svg.querySelector('[data-testid="sheet-renderer-balloons"]')?.getAttribute('data-count'),
    ).toBe('5');

    const ctorCalls: CtorCall[] = [];
    const addImageCalls: unknown[][] = [];
    class MockJsPdf {
      constructor(opts: CtorCall) { ctorCalls.push(opts); }
      addImage(...args: unknown[]): this { addImageCalls.push(args); return this; }
      addPage(): this { return this; }
      getNumberOfPages(): number { return 1; }
      output(type: string): Blob | ArrayBuffer | string {
        if (type === 'blob') return new Blob(['%PDF-1.4'], { type: 'application/pdf' });
        if (type === 'arraybuffer') return new ArrayBuffer(8);
        return '';
      }
    }

    const blob = await exportSheetsToPdf([sheet], [svg], {
      loadJsPdf: async () => MockJsPdf as never,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    // One A3 landscape page carrying the rasterised sheet.
    const a3 = paperDimensions('A3');
    expect(ctorCalls).toHaveLength(1);
    expect(ctorCalls[0].format).toEqual([a3.width, a3.height]);
    expect(ctorCalls[0].unit).toBe('mm');
    expect(addImageCalls).toHaveLength(1);
  });
});
