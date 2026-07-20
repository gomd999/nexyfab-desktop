// @vitest-environment jsdom
/**
 * sheetRenderer.detailBroken.test.tsx — W4-C renderer paths.
 *
 *   - Detail viewport draws REAL magnified line work (source view clipped to
 *     the detail circle) and the source viewport gets the detail circle
 *     marker mapped through the same fit transform as its line work.
 *   - Broken viewport draws the collapsed line work + two zigzag break lines.
 *   - Without geometry both fall back to the existing stubs (no fabricated
 *     content).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { featureToPolyhedron, type Polyhedron } from '@/lib/cad/featureMesh';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';

function cubePoly(): Polyhedron {
  const feature: ExtrudeFeature = {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ],
    depth: 50,
    direction: 'one_sided',
    mode: 'add',
  };
  const poly = featureToPolyhedron(feature);
  if (!poly) throw new Error('cube mesh failed');
  return poly;
}

function frontVp(): Viewport {
  return {
    id: 'front',
    sourceId: 'p1',
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: 150, y: 150 },
    widthOnSheet: 100,
    scale: 1,
    label: 'FRONT',
  };
}

// Detail circle over the cube's LEFT edge (x=0 in front view-plane mm) so
// the clipped region actually contains line work.
function detailVp(): Viewport {
  return {
    id: 'det-1',
    sourceId: 'p1',
    projection: {
      kind: 'detail',
      sourceViewportId: 'front',
      center: { x: 0, y: 25 },
      radius: 10,
      scaleFactor: 2,
    },
    centerOnSheet: { x: 300, y: 80 },
    widthOnSheet: 60,
    scale: 1,
    label: 'DETAIL B',
  };
}

function brokenVp(): Viewport {
  return {
    id: 'brk-1',
    sourceId: 'p1',
    projection: {
      kind: 'broken',
      view: 'front',
      axis: 'x',
      breakStart: 15,
      breakEnd: 35,
    },
    centerOnSheet: { x: 150, y: 60 },
    widthOnSheet: 100,
    scale: 1,
    label: 'BROKEN 1',
  };
}

function sheetWith(vps: Viewport[]): Sheet {
  return { id: 's-db', name: 'detail+broken', paperSize: 'A3', viewports: vps };
}

const geo = () => new Map([['p1', cubePoly()]]);

describe('SheetRenderer detail + broken views (W4-C)', () => {
  it('detail viewport draws real clipped line work when geometry is supplied', () => {
    const { container } = render(
      <SheetRenderer sheet={sheetWith([frontVp(), detailVp()])} geometry={geo()} />,
    );
    const g = container.querySelector('[data-testid="sheet-renderer-detail-geometry-det-1"]');
    expect(g).not.toBeNull();
    expect(Number(g?.getAttribute('data-visible'))).toBeGreaterThan(0);
    expect(g?.querySelectorAll('line').length).toBeGreaterThan(0);
  });

  it('source viewport carries the detail circle marker with the detail letter', () => {
    const { container } = render(
      <SheetRenderer sheet={sheetWith([frontVp(), detailVp()])} geometry={geo()} />,
    );
    // Detail viewport is index 1 → letter B.
    const marker = container.querySelector('[data-testid="sheet-renderer-detail-marker-front-B"]');
    expect(marker).not.toBeNull();
    expect(marker?.querySelector('circle')).not.toBeNull();
    expect(marker?.querySelector('text')?.textContent).toBe('B');
  });

  it('broken viewport draws collapsed line work + two zigzag break lines', () => {
    const { container } = render(
      <SheetRenderer sheet={sheetWith([frontVp(), brokenVp()])} geometry={geo()} />,
    );
    const g = container.querySelector('[data-testid="sheet-renderer-broken-geometry-brk-1"]');
    expect(g).not.toBeNull();
    expect(Number(g?.getAttribute('data-visible'))).toBeGreaterThan(0);
    // band 20 − default gap 4 → shift 16
    expect(g?.getAttribute('data-break-shift')).toBe('16');
    expect(g?.querySelector('[data-testid="sheet-renderer-break-line-brk-1-near"]')).not.toBeNull();
    expect(g?.querySelector('[data-testid="sheet-renderer-break-line-brk-1-far"]')).not.toBeNull();
  });

  it('without geometry both viewports keep the existing stubs (no fabricated content)', () => {
    const { container } = render(
      <SheetRenderer sheet={sheetWith([frontVp(), detailVp(), brokenVp()])} />,
    );
    expect(container.querySelector('[data-testid^="sheet-renderer-detail-geometry-"]')).toBeNull();
    expect(container.querySelector('[data-testid^="sheet-renderer-broken-geometry-"]')).toBeNull();
    // Detail stub (letter bubble) still renders.
    expect(container.querySelector('[data-testid="sheet-renderer-detail-circle-det-1"]')).not.toBeNull();
    // Viewport kinds are tagged for both.
    expect(container.querySelector('g[data-vp-kind="broken"]')).not.toBeNull();
  });
});
