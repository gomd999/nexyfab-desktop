/**
 * sheet — sheet/viewport IR + standard 3-view builder tests.
 */
import { describe, it, expect } from 'vitest';
import {
  paperDimensions,
  validateSheet,
  standardThreeViewSheet,
  SheetValidationError,
  type Sheet,
  type Viewport,
} from './sheet';

describe('paperDimensions', () => {
  it('returns standard A-series sizes in landscape mm', () => {
    expect(paperDimensions('A0')).toEqual({ width: 1189, height: 841 });
    expect(paperDimensions('A4')).toEqual({ width: 297, height: 210 });
  });

  it('custom requires explicit dimensions', () => {
    expect(() => paperDimensions('custom')).toThrow(/custom dimensions/);
    expect(paperDimensions('custom', { width: 500, height: 300 })).toEqual({ width: 500, height: 300 });
  });

  it('rejects non-positive custom dimensions', () => {
    expect(() => paperDimensions('custom', { width: 0, height: 100 })).toThrow(/positive/);
  });
});

// ─── validateSheet ───────────────────────────────────────────────────────

function vp(id: string, x: number, y: number, viewName: 'front' | 'top' = 'front'): Viewport {
  return {
    id,
    sourceId: 'src',
    projection: { kind: 'standard', view: viewName },
    centerOnSheet: { x, y },
    widthOnSheet: 100,
    scale: 1,
  };
}

describe('validateSheet', () => {
  it('accepts a valid sheet', () => {
    const sheet: Sheet = {
      id: 's1', name: 'Sheet', paperSize: 'A3',
      viewports: [vp('v1', 100, 100), vp('v2', 200, 200, 'top')],
    };
    expect(() => validateSheet(sheet)).not.toThrow();
  });

  it('rejects empty sheet id', () => {
    const sheet: Sheet = { id: '', name: 'X', paperSize: 'A3', viewports: [] };
    expect(() => validateSheet(sheet)).toThrow(/sheet id/);
  });

  it('rejects duplicate viewport ids', () => {
    const sheet: Sheet = {
      id: 's1', name: 'S', paperSize: 'A3',
      viewports: [vp('v1', 50, 50), vp('v1', 100, 100)],
    };
    expect(() => validateSheet(sheet)).toThrow(/duplicate viewport/);
  });

  it('rejects viewport with non-positive scale', () => {
    const sheet: Sheet = {
      id: 's1', name: 'S', paperSize: 'A3',
      viewports: [{ ...vp('v1', 50, 50), scale: 0 }],
    };
    expect(() => validateSheet(sheet)).toThrow(/scale/);
  });

  it('rejects viewport center outside paper bounds', () => {
    const sheet: Sheet = {
      id: 's1', name: 'S', paperSize: 'A4',
      viewports: [vp('v1', 500, 500)], // A4 is 297×210
    };
    expect(() => validateSheet(sheet)).toThrow(SheetValidationError);
  });

  it('detail projection rejects missing sourceViewportId', () => {
    const sheet: Sheet = {
      id: 's1', name: 'S', paperSize: 'A3',
      viewports: [
        {
          id: 'detail1', sourceId: 'src',
          projection: { kind: 'detail', sourceViewportId: 'ghost', center: { x: 0, y: 0 }, radius: 5, scaleFactor: 2 },
          centerOnSheet: { x: 50, y: 50 }, widthOnSheet: 80, scale: 2,
        },
      ],
    };
    expect(() => validateSheet(sheet)).toThrow(/sourceViewportId.*not found/);
  });
});

// ─── standardThreeViewSheet ──────────────────────────────────────────────

describe('standardThreeViewSheet', () => {
  it('builds 4 viewports (front + top + right + iso) on A3', () => {
    const sheet = standardThreeViewSheet({
      id: 's1', name: '3-view', sourceId: 'part_a',
      paperSize: 'A3', scale: 0.5,
    });
    expect(sheet.viewports.length).toBe(4);
    const ids = sheet.viewports.map((v) => v.id);
    expect(ids).toEqual(['front', 'top', 'right', 'iso']);
  });

  it('all viewports use the same source and scale', () => {
    const sheet = standardThreeViewSheet({
      id: 's1', name: '3v', sourceId: 'assy_x',
      paperSize: 'A2', scale: 0.25,
    });
    for (const vp of sheet.viewports) {
      expect(vp.sourceId).toBe('assy_x');
      expect(vp.scale).toBe(0.25);
    }
  });

  it('output passes validateSheet', () => {
    const sheet = standardThreeViewSheet({
      id: 's1', name: '3v', sourceId: 'src',
      paperSize: 'A4', scale: 1,
    });
    expect(() => validateSheet(sheet)).not.toThrow();
  });
});
