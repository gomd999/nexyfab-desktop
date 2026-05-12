/**
 * Drawing standards compliance (Q6).
 *
 * Validates that ISO 128 / ASME Y14 rules in `drawingStandards.ts` flag
 * the right structural issues. Geometric correctness of dimensions is
 * out of scope — we only assert structural validity here.
 */

import { describe, it, expect } from 'vitest';
import {
  ISO_LINE_SPEC,
  ASME_LINE_SPEC,
  validateDrawingCompliance,
  ISO_216_PAPER_MM,
} from '../drawingStandards';
import type { DrawingResult, ViewResult } from '../autoDrawing';

function viewWith(lines: ViewResult['lines']): ViewResult {
  return {
    projection: 'front',
    lines,
    texts: [],
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
  };
}

function emptyDrawing(): DrawingResult {
  return {
    views: [
      viewWith([{ x1: 0, y1: 0, x2: 50, y2: 0, type: 'visible' }]),
    ],
    titleBlock: {
      partName: 'Test',
      material: 'Aluminum',
      drawnBy: 'NexyFab',
      date: '2026-05-08',
      scale: '1:1',
      revision: 'A',
    },
    paperWidth: 297,
    paperHeight: 210,
  };
}

describe('drawingStandards line specs', () => {
  it('ISO thick:thin ratio is 2:1 (ISO 128 §5)', () => {
    expect(ISO_LINE_SPEC.visible.width / ISO_LINE_SPEC.hidden.width).toBe(2);
    expect(ISO_LINE_SPEC.visible.width / ISO_LINE_SPEC.center.width).toBe(2);
    expect(ISO_LINE_SPEC.visible.width / ISO_LINE_SPEC.dimension.width).toBe(2);
  });

  it('ASME thick:thin ratio is 2:1', () => {
    expect(ASME_LINE_SPEC.visible.width / ASME_LINE_SPEC.hidden.width).toBe(2);
  });

  it('all standard lines are black for print compliance', () => {
    for (const style of Object.values(ISO_LINE_SPEC)) {
      expect(style.color).toBe('#000000');
    }
    for (const style of Object.values(ASME_LINE_SPEC)) {
      expect(style.color).toBe('#000000');
    }
  });

  it('hidden line dasharray exists (ISO 128 §10)', () => {
    expect(ISO_LINE_SPEC.hidden.dasharray).toBeDefined();
    expect(ASME_LINE_SPEC.hidden.dasharray).toBeDefined();
  });

  it('center line is long-dash dotted', () => {
    // ISO 128 calls for "long dash dotted" — encoded as `6 2 1 2`
    // (long dash + gap + dot + gap).
    expect(ISO_LINE_SPEC.center.dasharray).toBe('6 2 1 2');
  });

  it('ISO 216 paper sizes match the standard', () => {
    expect(ISO_216_PAPER_MM.A4).toEqual({ w: 297, h: 210 });
    expect(ISO_216_PAPER_MM.A3).toEqual({ w: 420, h: 297 });
    expect(ISO_216_PAPER_MM.A2).toEqual({ w: 594, h: 420 });
  });
});

describe('validateDrawingCompliance', () => {
  it('a complete drawing on A4 with title block & one visible line is compliant', () => {
    const report = validateDrawingCompliance(emptyDrawing());
    expect(report.compliant).toBe(true);
    expect(report.issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('non-standard paper size triggers warning, not error', () => {
    const draw = { ...emptyDrawing(), paperWidth: 333, paperHeight: 222 };
    const report = validateDrawingCompliance(draw);
    expect(report.compliant).toBe(true); // still compliant — paper is a warning
    expect(report.issues.some(i => i.rule === 'ISO 216' && i.severity === 'warning')).toBe(true);
  });

  it('no views is an error', () => {
    const draw = { ...emptyDrawing(), views: [] };
    const report = validateDrawingCompliance(draw);
    expect(report.compliant).toBe(false);
    expect(report.issues.some(i => i.severity === 'error' && /no projected views/i.test(i.message))).toBe(true);
  });

  it('missing partName is an error', () => {
    const draw = emptyDrawing();
    draw.titleBlock.partName = '';
    const report = validateDrawingCompliance(draw);
    expect(report.compliant).toBe(false);
    expect(report.issues.some(i => /title block missing part name/i.test(i.message))).toBe(true);
  });

  it('drawing with only hidden lines (no visible) is non-compliant', () => {
    const draw: DrawingResult = {
      ...emptyDrawing(),
      views: [viewWith([{ x1: 0, y1: 0, x2: 50, y2: 0, type: 'hidden' }])],
    };
    const report = validateDrawingCompliance(draw);
    expect(report.compliant).toBe(false);
    expect(report.issues.some(i => /no visible/i.test(i.message))).toBe(true);
  });

  it('non-finite line coordinates are flagged as error', () => {
    const draw: DrawingResult = {
      ...emptyDrawing(),
      views: [viewWith([
        { x1: 0, y1: 0, x2: 50, y2: 0, type: 'visible' },
        { x1: NaN, y1: 0, x2: 10, y2: 10, type: 'visible' },
      ])],
    };
    const report = validateDrawingCompliance(draw);
    expect(report.compliant).toBe(false);
    expect(report.issues.some(i => /non-finite/i.test(i.message))).toBe(true);
  });

  it('zero-length lines are warnings, not errors', () => {
    const draw: DrawingResult = {
      ...emptyDrawing(),
      views: [viewWith([
        { x1: 0, y1: 0, x2: 50, y2: 0, type: 'visible' },
        { x1: 5, y1: 5, x2: 5, y2: 5, type: 'hidden' }, // zero-length
      ])],
    };
    const report = validateDrawingCompliance(draw);
    expect(report.compliant).toBe(true); // warnings don't break compliance
    expect(report.issues.some(i => /zero-length/i.test(i.message))).toBe(true);
  });

  it('ASME standard returns same compliance for a clean drawing', () => {
    const report = validateDrawingCompliance(emptyDrawing(), 'ASME');
    expect(report.standard).toBe('ASME');
    expect(report.compliant).toBe(true);
  });
});
