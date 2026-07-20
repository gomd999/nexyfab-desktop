// @vitest-environment jsdom
/**
 * sheetRenderer.measure.test.tsx — W4-A dimension render wiring.
 *
 * SheetRenderer + `topologies` prop: dimension labels must show the REAL
 * measureDimension() value (never a fabricated number), keep the `<kind>`
 * placeholder on explicit measurement failure with the reason exposed via
 * data-dim-measured, and preserve full back-compat when no topology is
 * supplied. Also exercises FACE refs end-to-end through the renderer
 * (Wave 3 정직 기록 #2 — face 앵커 실측).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import type { Dimension } from '@/lib/drawing/dimension';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { buildExtrudeTopo } from '@/lib/cad/topoNaming';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';

// ─── fixtures ────────────────────────────────────────────────────────────

/** 50 mm cube — same profile as the drawing page's sample-cube. */
function cubeFeature(): ExtrudeFeature {
  const s = 50;
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: s, y: 0 },
      { x: s, y: s },
      { x: 0, y: s },
    ],
    depth: s,
    direction: 'one_sided',
    mode: 'add',
  };
}

/** 16-gon prism, r=25 (the sample-cylinder approximation): caps are true circles. */
function cylinderFeature(): ExtrudeFeature {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 16; i += 1) {
    const theta = (2 * Math.PI * i) / 16;
    pts.push({ x: 25 * Math.cos(theta), y: 25 * Math.sin(theta) });
  }
  return { kind: 'extrude', loop: pts, depth: 60, direction: 'one_sided', mode: 'add' };
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

function topVp(): Viewport {
  return {
    id: 'top',
    sourceId: 'p1',
    projection: { kind: 'standard', view: 'top' },
    centerOnSheet: { x: 300, y: 150 },
    widthOnSheet: 100,
    scale: 1,
    label: 'TOP',
  };
}

function sheetWith(dims: Dimension[]): Sheet {
  return {
    id: 's-measure', name: 'Measure wiring', paperSize: 'A3',
    viewports: [frontVp(), topVp()],
    dimensions: dims,
  };
}

const cubeTopo = () => new Map([['p1', buildExtrudeTopo(cubeFeature())]]);
const cylTopo = () => new Map([['p1', buildExtrudeTopo(cylinderFeature())]]);

function dimNode(container: HTMLElement): Element {
  const node = container.querySelector('[data-testid="sheet-renderer-dim-0"]');
  expect(node).not.toBeNull();
  return node as Element;
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('SheetRenderer dimension measurement wiring (W4-A)', () => {
  it('linear between two FACE refs shows the measured 50 (face anchors, front view)', () => {
    const d: Dimension = {
      id: 'd1', viewportId: 'front', kind: 'linear',
      refs: ['f.side.3', 'f.side.1'], // x=0 plane ↔ x=50 plane — edge-on in front view
    };
    const { container } = render(
      <SheetRenderer sheet={sheetWith([d])} topologies={cubeTopo()} />,
    );
    const node = dimNode(container);
    expect(node.getAttribute('data-dim-measured')).toBe('ok');
    expect(node.getAttribute('data-dim-value')).toBe('50');
    expect(node.querySelector('text')?.textContent).toBe('50');
  });

  it('diametric on the circular cap face shows ⌀50 (top view)', () => {
    const d: Dimension = {
      id: 'd2', viewportId: 'top', kind: 'diametric', refs: ['f.cap.top'],
    };
    const { container } = render(
      <SheetRenderer sheet={sheetWith([d])} topologies={cylTopo()} />,
    );
    const node = dimNode(container);
    expect(node.getAttribute('data-dim-measured')).toBe('ok');
    expect(node.querySelector('text')?.textContent).toBe('⌀50');
  });

  it('angular between a bottom edge and a vertical edge shows 90°', () => {
    const d: Dimension = {
      id: 'd3', viewportId: 'front', kind: 'angular',
      refs: ['e.bottom.0-1', 'e.vert.1'],
    };
    const { container } = render(
      <SheetRenderer sheet={sheetWith([d])} topologies={cubeTopo()} />,
    );
    const node = dimNode(container);
    expect(node.getAttribute('data-dim-measured')).toBe('ok');
    expect(node.querySelector('text')?.textContent).toBe('90°');
  });

  it('valueOverride still wins over a successful measurement (IR contract)', () => {
    const d: Dimension = {
      id: 'd4', viewportId: 'front', kind: 'linear',
      refs: ['f.side.3', 'f.side.1'], valueOverride: 20,
    };
    const { container } = render(
      <SheetRenderer sheet={sheetWith([d])} topologies={cubeTopo()} />,
    );
    expect(dimNode(container).querySelector('text')?.textContent).toBe('20');
  });

  it('unresolved ref keeps the placeholder + exposes the explicit failure reason', () => {
    const d: Dimension = {
      id: 'd5', viewportId: 'front', kind: 'linear',
      refs: ['ghost.a', 'ghost.b'],
    };
    const { container } = render(
      <SheetRenderer sheet={sheetWith([d])} topologies={cubeTopo()} />,
    );
    const node = dimNode(container);
    expect(node.getAttribute('data-dim-measured')).toBe('unresolved-ref');
    expect(node.getAttribute('data-dim-value')).toBeNull();
    expect(node.querySelector('text')?.textContent).toBe('<linear>');
    // The diagnosis rides along as an SVG tooltip, never as a printed number.
    expect(node.querySelector('title')?.textContent).toContain('ghost.a');
  });

  it('no topologies prop → untouched placeholder path (back-compat)', () => {
    const d: Dimension = {
      id: 'd6', viewportId: 'front', kind: 'linear',
      refs: ['f.side.3', 'f.side.1'],
    };
    const { container } = render(<SheetRenderer sheet={sheetWith([d])} />);
    const node = dimNode(container);
    expect(node.getAttribute('data-dim-measured')).toBe('none');
    expect(node.querySelector('text')?.textContent).toBe('<linear>');
  });
});
