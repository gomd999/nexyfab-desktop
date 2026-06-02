// @vitest-environment jsdom
/**
 * sheetRenderer.test.tsx — Phase 4.4.1 Drawing UI track.
 *
 * Covers (per task brief):
 *   - Renders SVG with viewBox matching paper dimensions.
 *   - Renders sheet border rect.
 *   - Renders 1 rect per viewport.
 *   - Renders viewport labels.
 *   - Section view shows cutting-plane arrows.
 *   - Detail view shows detail circle.
 *   - Empty sheet (no viewports) just shows border + title block.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  paperDimensions,
  standardThreeViewSheet,
  type Sheet,
  type Viewport,
} from '@/lib/drawing/sheet';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';

// ─── fixtures ────────────────────────────────────────────────────────────

function emptyA4Sheet(): Sheet {
  return {
    id: 'empty', name: 'Empty A4', paperSize: 'A4', viewports: [],
  };
}

function sheetWithSection(): Sheet {
  const front: Viewport = {
    id: 'front',
    sourceId: 'p1',
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: 150, y: 150 },
    widthOnSheet: 100,
    scale: 1,
    label: 'FRONT',
  };
  const section: Viewport = {
    id: 'sec-A',
    sourceId: 'p1',
    projection: { kind: 'section', cuttingPlaneId: 'A' },
    centerOnSheet: { x: 300, y: 150 },
    widthOnSheet: 80,
    scale: 1,
    label: 'SECTION A-A',
  };
  return {
    id: 's-sec', name: 'Section demo', paperSize: 'A3',
    viewports: [front, section],
  };
}

function sheetWithDetail(): Sheet {
  const front: Viewport = {
    id: 'front',
    sourceId: 'p1',
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: 150, y: 200 },
    widthOnSheet: 100,
    scale: 1,
    label: 'FRONT',
  };
  const detail: Viewport = {
    id: 'det-B',
    sourceId: 'p1',
    projection: {
      kind: 'detail',
      sourceViewportId: 'front',
      center: { x: 0, y: 0 },
      radius: 5,
      scaleFactor: 2,
    },
    centerOnSheet: { x: 300, y: 100 },
    widthOnSheet: 60,
    scale: 2,
    label: 'DETAIL B',
  };
  return {
    id: 's-det', name: 'Detail demo', paperSize: 'A3',
    viewports: [front, detail],
  };
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('SheetRenderer', () => {
  it('renders an SVG with viewBox matching paper dimensions (mm space)', () => {
    const sheet = standardThreeViewSheet({
      id: 's1', name: 'Std', sourceId: 'p1', paperSize: 'A3', scale: 1,
    });
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const root = getByTestId('sheet-renderer-root') as unknown as SVGSVGElement;
    expect(root.tagName.toLowerCase()).toBe('svg');
    const dim = paperDimensions('A3');
    expect(root.getAttribute('viewBox')).toBe(`0 0 ${dim.width} ${dim.height}`);
  });

  it('honors the scale prop for SVG width/height in pixels', () => {
    const sheet = emptyA4Sheet();
    const { getByTestId } = render(<SheetRenderer sheet={sheet} scale={3} />);
    const root = getByTestId('sheet-renderer-root');
    const dim = paperDimensions('A4');
    expect(root.getAttribute('width')).toBe(`${dim.width * 3}`);
    expect(root.getAttribute('height')).toBe(`${dim.height * 3}`);
  });

  it('renders the sheet border rectangle', () => {
    const sheet = emptyA4Sheet();
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const border = getByTestId('sheet-renderer-sheet-border');
    expect(border.tagName.toLowerCase()).toBe('rect');
    expect(border.getAttribute('stroke')).toBe('#444');
  });

  it('renders exactly one viewport border rect per viewport', () => {
    const sheet = standardThreeViewSheet({
      id: 's2', name: 'Std', sourceId: 'p1', paperSize: 'A3', scale: 1,
    });
    const { container } = render(<SheetRenderer sheet={sheet} />);
    const vpBorders = container.querySelectorAll(
      '[data-testid^="sheet-renderer-viewport-border-"]',
    );
    expect(vpBorders.length).toBe(sheet.viewports.length);
    // Sanity: every viewport border is a <rect>.
    vpBorders.forEach((el) => {
      expect(el.tagName.toLowerCase()).toBe('rect');
    });
  });

  it('renders a label text element per labeled viewport', () => {
    const sheet = standardThreeViewSheet({
      id: 's3', name: 'Std', sourceId: 'p1', paperSize: 'A3', scale: 1,
    });
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    for (const vp of sheet.viewports) {
      const label = getByTestId(`sheet-renderer-viewport-label-${vp.id}`);
      expect(label.tagName.toLowerCase()).toBe('text');
      expect(label.textContent).toBe(vp.label);
    }
  });

  it('omits the label element when a viewport has no label', () => {
    const noLabel: Viewport = {
      id: 'nl',
      sourceId: 'p1',
      projection: { kind: 'standard', view: 'front' },
      centerOnSheet: { x: 100, y: 100 },
      widthOnSheet: 80,
      scale: 1,
    };
    const sheet: Sheet = {
      id: 'nl', name: 'No label', paperSize: 'A4', viewports: [noLabel],
    };
    const { queryByTestId } = render(<SheetRenderer sheet={sheet} />);
    expect(queryByTestId('sheet-renderer-viewport-label-nl')).toBeNull();
  });

  it('section view renders the cutting-plane arrows group (full / default)', () => {
    const sheet = sheetWithSection();
    const { getByTestId, queryByTestId } = render(<SheetRenderer sheet={sheet} />);
    const arrows = getByTestId('sheet-renderer-section-arrows-sec-A');
    expect(arrows).not.toBeNull();
    // Arrows group contains the dashed cut line + 2 polygon arrowheads.
    expect(arrows.querySelectorAll('line').length).toBeGreaterThanOrEqual(1);
    expect(arrows.querySelectorAll('polygon').length).toBe(2);
    // Default (no sectionType) is tagged as 'full'.
    expect(arrows.getAttribute('data-section-type')).toBe('full');
    // Non-section viewport must NOT have a section-arrows group.
    expect(queryByTestId('sheet-renderer-section-arrows-front')).toBeNull();
  });

  it('half-section view renders only ONE arrowhead', () => {
    const section: Viewport = {
      id: 'sec-H',
      sourceId: 'p1',
      projection: {
        kind: 'section',
        cuttingPlaneId: 'B',
        sectionType: 'half',
        side: 'near',
      },
      centerOnSheet: { x: 200, y: 150 },
      widthOnSheet: 80,
      scale: 1,
      label: 'HALF B-B',
    };
    const sheet: Sheet = {
      id: 's-half', name: 'half', paperSize: 'A3', viewports: [section],
    };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const arrows = getByTestId('sheet-renderer-section-arrows-sec-H');
    expect(arrows.getAttribute('data-section-type')).toBe('half');
    // 'half' draws the dashed line + exactly ONE arrow polygon.
    expect(arrows.querySelectorAll('line').length).toBeGreaterThanOrEqual(1);
    expect(arrows.querySelectorAll('polygon').length).toBe(1);
  });

  it('offset section view renders a polyline of N+1 path points (→ N segments)', () => {
    const path = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 5 },
    ];
    const section: Viewport = {
      id: 'sec-O',
      sourceId: 'p1',
      projection: {
        kind: 'section',
        cuttingPlaneId: 'C',
        sectionType: 'offset',
        cuttingPath: path,
      },
      centerOnSheet: { x: 200, y: 150 },
      widthOnSheet: 80,
      scale: 1,
      label: 'OFFSET C-C',
    };
    const sheet: Sheet = {
      id: 's-off', name: 'offset', paperSize: 'A3', viewports: [section],
    };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const arrows = getByTestId('sheet-renderer-section-arrows-sec-O');
    expect(arrows.getAttribute('data-section-type')).toBe('offset');
    const polyline = getByTestId('sheet-renderer-section-polyline-sec-O');
    expect(polyline.tagName.toLowerCase()).toBe('polyline');
    const points = (polyline.getAttribute('points') ?? '').trim().split(/\s+/);
    // N+1 points in the rendered polyline.
    expect(points.length).toBe(path.length);
    // Two endpoint arrowheads.
    expect(getByTestId('sheet-renderer-section-arrow-start-sec-O')).not.toBeNull();
    expect(getByTestId('sheet-renderer-section-arrow-end-sec-O')).not.toBeNull();
  });

  it('aligned section renders a polyline same as offset (Phase 1 visual parity)', () => {
    const path = [
      { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 15, y: 5 },
    ];
    const section: Viewport = {
      id: 'sec-A',
      sourceId: 'p1',
      projection: {
        kind: 'section',
        cuttingPlaneId: 'D',
        sectionType: 'aligned',
        cuttingPath: path,
      },
      centerOnSheet: { x: 200, y: 150 },
      widthOnSheet: 80,
      scale: 1,
      label: 'ALIGNED D-D',
    };
    const sheet: Sheet = {
      id: 's-aln', name: 'aligned', paperSize: 'A3', viewports: [section],
    };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const arrows = getByTestId('sheet-renderer-section-arrows-sec-A');
    expect(arrows.getAttribute('data-section-type')).toBe('aligned');
    const polyline = getByTestId('sheet-renderer-section-polyline-sec-A');
    expect(polyline.tagName.toLowerCase()).toBe('polyline');
    const points = (polyline.getAttribute('points') ?? '').trim().split(/\s+/);
    expect(points.length).toBe(path.length);
  });

  it('detail view renders the detail-circle marker with a letter label', () => {
    const sheet = sheetWithDetail();
    const { getByTestId, queryByTestId } = render(<SheetRenderer sheet={sheet} />);
    const detail = getByTestId('sheet-renderer-detail-circle-det-B');
    expect(detail).not.toBeNull();
    expect(detail.querySelector('circle')).not.toBeNull();
    const letterText = detail.querySelector('text');
    expect(letterText).not.toBeNull();
    // Second viewport (index 1) → letter 'B'.
    expect(letterText?.textContent).toBe('B');
    // Non-detail viewport must NOT have a detail-circle group.
    expect(queryByTestId('sheet-renderer-detail-circle-front')).toBeNull();
  });

  it('empty sheet (no viewports) still renders border + title block', () => {
    const sheet = emptyA4Sheet();
    const { getByTestId, container } = render(<SheetRenderer sheet={sheet} />);
    expect(getByTestId('sheet-renderer-sheet-border')).not.toBeNull();
    expect(getByTestId('sheet-renderer-title-block')).not.toBeNull();
    // No viewport groups at all.
    const vpGroups = container.querySelectorAll('[data-testid^="sheet-renderer-viewport-"]');
    expect(vpGroups.length).toBe(0);
  });

  it('title block sits in the bottom-right corner inside the sheet border', () => {
    const sheet = emptyA4Sheet();
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const tb = getByTestId('sheet-renderer-title-block');
    const rect = tb.querySelector('rect');
    expect(rect).not.toBeNull();
    const dim = paperDimensions('A4');
    const x = Number(rect?.getAttribute('x'));
    const y = Number(rect?.getAttribute('y'));
    const w = Number(rect?.getAttribute('width'));
    const h = Number(rect?.getAttribute('height'));
    expect(w).toBe(60);
    expect(h).toBe(40);
    // Inset 5mm from each edge.
    expect(x).toBeCloseTo(dim.width - 60 - 5, 5);
    expect(y).toBeCloseTo(dim.height - 40 - 5, 5);
    // The text says TITLE BLOCK.
    expect(tb.querySelector('text')?.textContent).toBe('TITLE BLOCK');
  });
});
