// @vitest-environment jsdom
/**
 * sheetRenderer.projection.test.tsx — Phase 4.1.2.
 *
 * Real projected HLR geometry inside standard-view viewports (replacing the
 * placeholder boxes) when a per-sourceId polyhedron is supplied. Back-compat:
 * with no geometry prop, viewports render only the placeholder box.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';
import { extrudePolyhedron, type Polyhedron } from '@/lib/cad/featureMesh';

function vp(id: string, view: 'front' | 'top', sourceId = 'p1'): Viewport {
  return {
    id, sourceId,
    projection: { kind: 'standard', view },
    centerOnSheet: { x: 150, y: 150 }, widthOnSheet: 100, scale: 1, label: id.toUpperCase(),
  };
}

function sheet(): Sheet {
  return { id: 's-proj', name: 'Projection demo', paperSize: 'A3', viewports: [vp('front', 'front'), vp('top', 'top')] };
}

function cube(): Polyhedron {
  return extrudePolyhedron({
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    depth: 10, direction: 'one_sided', mode: 'add',
  });
}

describe('SheetRenderer projected geometry (Phase 4.1.2)', () => {
  it('with no geometry prop, no projected-geometry group is drawn (placeholder only)', () => {
    const { container } = render(<SheetRenderer sheet={sheet()} />);
    expect(container.querySelectorAll('[data-testid^="sheet-renderer-vp-geometry-"]').length).toBe(0);
    // Placeholder viewport borders still present.
    expect(container.querySelector('[data-testid="sheet-renderer-viewport-border-front"]')).not.toBeNull();
  });

  it('draws real projected edges for a viewport whose sourceId has geometry', () => {
    const geometry = new Map<string, Polyhedron>([['p1', cube()]]);
    const { container } = render(<SheetRenderer sheet={sheet()} geometry={geometry} />);
    const front = container.querySelector('[data-testid="sheet-renderer-vp-geometry-front"]')!;
    expect(front).not.toBeNull();
    // The cube front view has 4 visible outline edges; lines are drawn.
    expect(Number(front.getAttribute('data-visible'))).toBeGreaterThanOrEqual(4);
    expect(front.querySelectorAll('line').length).toBeGreaterThanOrEqual(4);
    // Both viewports (front + top) get geometry since both reference p1.
    expect(container.querySelector('[data-testid="sheet-renderer-vp-geometry-top"]')).not.toBeNull();
  });

  it('a viewport whose sourceId is absent from the map keeps the placeholder', () => {
    const geometry = new Map<string, Polyhedron>([['other-part', cube()]]);
    const { container } = render(<SheetRenderer sheet={sheet()} geometry={geometry} />);
    expect(container.querySelectorAll('[data-testid^="sheet-renderer-vp-geometry-"]').length).toBe(0);
  });

  it('hidden edges are drawn dashed (strokeDasharray set)', () => {
    const geometry = new Map<string, Polyhedron>([['p1', cube()]]);
    const { container } = render(<SheetRenderer sheet={sheet()} geometry={geometry} />);
    const front = container.querySelector('[data-testid="sheet-renderer-vp-geometry-front"]')!;
    const dashed = Array.from(front.querySelectorAll('line')).filter((l) => l.getAttribute('stroke-dasharray'));
    expect(dashed.length).toBeGreaterThan(0);
  });
});
