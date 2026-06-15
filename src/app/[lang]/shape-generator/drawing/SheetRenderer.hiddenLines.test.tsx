import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SheetRenderer } from './SheetRenderer';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Polyhedron } from '@/lib/cad/featureMesh';

// 20mm cube centered at the origin — a front view has back-face edges that
// HLR demotes to hidden, so data-hidden > 0 when hidden lines are shown.
function centeredCube(): Polyhedron {
  return {
    vertices: [
      { x: -10, y: -10, z: -10 }, { x: 10, y: -10, z: -10 }, { x: 10, y: 10, z: -10 }, { x: -10, y: 10, z: -10 },
      { x: -10, y: -10, z: 10 }, { x: 10, y: -10, z: 10 }, { x: 10, y: 10, z: 10 }, { x: -10, y: 10, z: 10 },
    ],
    faces: [
      { vertices: [0, 1, 2, 3], normal: { x: 0, y: 0, z: -1 } },
      { vertices: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } },
      { vertices: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 } },
      { vertices: [2, 3, 7, 6], normal: { x: 0, y: 1, z: 0 } },
      { vertices: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 } },
      { vertices: [0, 3, 7, 4], normal: { x: -1, y: 0, z: 0 } },
    ],
  };
}

function frontSheet(): Sheet {
  return {
    id: 's1',
    name: 'hidden-line test',
    paperSize: 'A4',
    viewports: [{
      id: 'fv',
      sourceId: 'cube',
      projection: { kind: 'standard', view: 'front' },
      centerOnSheet: { x: 100, y: 100 },
      widthOnSheet: 60,
      scale: 1,
      label: 'FRONT',
    }],
  };
}

function hiddenCount(svg: string): number {
  const m = svg.match(/data-hidden="(\d+)"/);
  return m ? Number(m[1]) : -1;
}

describe('SheetRenderer — hidden-line visibility toggle', () => {
  const geometry = new Map<string, Polyhedron>([['cube', centeredCube()]]);

  it('draws hidden (dashed) edges by default — back-compat', () => {
    const svg = renderToStaticMarkup(<SheetRenderer sheet={frontSheet()} geometry={geometry} />);
    expect(hiddenCount(svg)).toBeGreaterThan(0);
  });

  it('suppresses hidden edges when showHiddenLines={false}', () => {
    const svg = renderToStaticMarkup(
      <SheetRenderer sheet={frontSheet()} geometry={geometry} showHiddenLines={false} />,
    );
    // data-hidden reflects 0 rendered hidden lines, and no dashed stroke present.
    expect(hiddenCount(svg)).toBe(0);
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('keeps visible (solid) edges regardless of the toggle', () => {
    const off = renderToStaticMarkup(
      <SheetRenderer sheet={frontSheet()} geometry={geometry} showHiddenLines={false} />,
    );
    const onVis = renderToStaticMarkup(<SheetRenderer sheet={frontSheet()} geometry={geometry} />);
    const visOf = (s: string) => Number(s.match(/data-visible="(\d+)"/)?.[1] ?? -1);
    expect(visOf(off)).toBeGreaterThan(0);
    expect(visOf(off)).toBe(visOf(onVis));
  });
});
