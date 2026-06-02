/**
 * sheet — sheet/viewport IR + standard 3-view builder tests.
 */
import { describe, it, expect } from 'vitest';
import {
  paperDimensions,
  validateSheet,
  standardThreeViewSheet,
  effectiveSectionType,
  SheetValidationError,
  type Sheet,
  type Viewport,
  type SectionProjection,
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

// ─── section view variants (Phase 4.1.2) ─────────────────────────────────

function sectionVp(id: string, projection: SectionProjection): Viewport {
  return {
    id,
    sourceId: 'src',
    projection,
    centerOnSheet: { x: 150, y: 150 },
    widthOnSheet: 100,
    scale: 1,
  };
}

describe('SectionProjection variants', () => {
  it('treats a section projection WITHOUT sectionType as "full" (backward-compat)', () => {
    const proj: SectionProjection = { kind: 'section', cuttingPlaneId: 'A' };
    expect(effectiveSectionType(proj)).toBe('full');
    const sheet: Sheet = {
      id: 's', name: 'S', paperSize: 'A3', viewports: [sectionVp('s1', proj)],
    };
    expect(() => validateSheet(sheet)).not.toThrow();
  });

  it('validates an explicit "full" section', () => {
    const proj: SectionProjection = {
      kind: 'section', cuttingPlaneId: 'A', sectionType: 'full',
    };
    const sheet: Sheet = {
      id: 's', name: 'S', paperSize: 'A3', viewports: [sectionVp('s1', proj)],
    };
    expect(() => validateSheet(sheet)).not.toThrow();
  });

  it('validates a "half" section (with explicit side)', () => {
    const proj: SectionProjection = {
      kind: 'section', cuttingPlaneId: 'B', sectionType: 'half', side: 'far',
    };
    const sheet: Sheet = {
      id: 's', name: 'S', paperSize: 'A3', viewports: [sectionVp('h1', proj)],
    };
    expect(() => validateSheet(sheet)).not.toThrow();
  });

  it('validates an "offset" section with cuttingPath length ≥ 2', () => {
    const proj: SectionProjection = {
      kind: 'section', cuttingPlaneId: 'C', sectionType: 'offset',
      cuttingPath: [
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 5 },
      ],
    };
    const sheet: Sheet = {
      id: 's', name: 'S', paperSize: 'A3', viewports: [sectionVp('o1', proj)],
    };
    expect(() => validateSheet(sheet)).not.toThrow();
  });

  it('rejects "offset" section with cuttingPath length < 2', () => {
    const proj: SectionProjection = {
      kind: 'section', cuttingPlaneId: 'C', sectionType: 'offset',
      cuttingPath: [{ x: 0, y: 0 }],
    };
    const sheet: Sheet = {
      id: 's', name: 'S', paperSize: 'A3', viewports: [sectionVp('o1', proj)],
    };
    expect(() => validateSheet(sheet)).toThrow(/cuttingPath/);
  });

  it('rejects "offset" section with no cuttingPath at all', () => {
    const proj: SectionProjection = {
      kind: 'section', cuttingPlaneId: 'C', sectionType: 'offset',
    };
    const sheet: Sheet = {
      id: 's', name: 'S', paperSize: 'A3', viewports: [sectionVp('o1', proj)],
    };
    expect(() => validateSheet(sheet)).toThrow(SheetValidationError);
  });

  it('validates an "aligned" section with non-zero segments', () => {
    const proj: SectionProjection = {
      kind: 'section', cuttingPlaneId: 'D', sectionType: 'aligned',
      cuttingPath: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }],
    };
    const sheet: Sheet = {
      id: 's', name: 'S', paperSize: 'A3', viewports: [sectionVp('a1', proj)],
    };
    expect(() => validateSheet(sheet)).not.toThrow();
  });

  it('rejects "aligned" section with a zero-length segment', () => {
    const proj: SectionProjection = {
      kind: 'section', cuttingPlaneId: 'D', sectionType: 'aligned',
      cuttingPath: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }],
    };
    const sheet: Sheet = {
      id: 's', name: 'S', paperSize: 'A3', viewports: [sectionVp('a1', proj)],
    };
    expect(() => validateSheet(sheet)).toThrow(/zero length/);
  });

  it('rejects any section with empty cuttingPlaneId', () => {
    const proj: SectionProjection = {
      kind: 'section', cuttingPlaneId: '', sectionType: 'full',
    };
    const sheet: Sheet = {
      id: 's', name: 'S', paperSize: 'A3', viewports: [sectionVp('s1', proj)],
    };
    expect(() => validateSheet(sheet)).toThrow(/cuttingPlaneId/);
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
