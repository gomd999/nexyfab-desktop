/** @vitest-environment jsdom */
/**
 * SketchSnapIndicator — Phase 1.4 sketch UX tests (ADR-013).
 *
 * Validates:
 *   - null snap → component renders nothing
 *   - one marker per snap kind (grid / point / line_endpoint /
 *     line_midpoint / circle_center / intersection)
 *   - per-kind data-testid contract `snap-indicator-{kind}` so the host
 *     editor can drive visual regression assertions
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import SketchSnapIndicator from '@/app/[lang]/shape-generator/sketch/SketchSnapIndicator';
import type { SnapTarget } from '@/lib/sketch/sketchSnap';

function mount(snap: SnapTarget | null): void {
  render(
    <svg data-testid="host-svg" width={200} height={200}>
      <SketchSnapIndicator snap={snap} />
    </svg>,
  );
}

const at = (kind: SnapTarget['kind'], x = 50, y = 50): SnapTarget => ({
  pos: { x, y },
  kind,
  distance: 0,
});

describe('SketchSnapIndicator', () => {
  it('renders nothing when snap is null', () => {
    mount(null);
    expect(screen.queryByTestId('snap-indicator')).toBeNull();
  });

  it('grid kind → renders + crosshair (snap-indicator-grid)', () => {
    mount(at('grid', 10, 10));
    expect(screen.getByTestId('snap-indicator')).toBeInTheDocument();
    const marker = screen.getByTestId('snap-indicator-grid');
    expect(marker).toBeInTheDocument();
    // Crosshair = two <line> children.
    expect(marker.querySelectorAll('line').length).toBe(2);
  });

  it('point kind → renders circle ring (snap-indicator-point)', () => {
    mount(at('point'));
    const marker = screen.getByTestId('snap-indicator-point');
    expect(marker).toBeInTheDocument();
    expect(marker.querySelector('circle')).toBeTruthy();
  });

  it('line_endpoint kind → renders square (snap-indicator-line_endpoint)', () => {
    mount(at('line_endpoint'));
    const marker = screen.getByTestId('snap-indicator-line_endpoint');
    expect(marker).toBeInTheDocument();
    expect(marker.querySelector('rect')).toBeTruthy();
  });

  it('line_midpoint kind → renders triangle (snap-indicator-line_midpoint)', () => {
    mount(at('line_midpoint'));
    const marker = screen.getByTestId('snap-indicator-line_midpoint');
    expect(marker).toBeInTheDocument();
    const poly = marker.querySelector('polygon');
    expect(poly).toBeTruthy();
    // Triangle = 3 points (3 comma-separated coordinate pairs).
    expect(poly!.getAttribute('points')!.split(' ').length).toBe(3);
  });

  it('circle_center kind → renders diamond polygon + dot', () => {
    mount(at('circle_center'));
    const marker = screen.getByTestId('snap-indicator-circle_center');
    expect(marker).toBeInTheDocument();
    const poly = marker.querySelector('polygon');
    expect(poly).toBeTruthy();
    expect(poly!.getAttribute('points')!.split(' ').length).toBe(4); // 4 vertices
    expect(marker.querySelector('circle')).toBeTruthy();
  });

  it('intersection kind → renders × cross (snap-indicator-intersection)', () => {
    mount(at('intersection'));
    const marker = screen.getByTestId('snap-indicator-intersection');
    expect(marker).toBeInTheDocument();
    expect(marker.querySelectorAll('line').length).toBe(2);
  });

  it('root group has pointerEvents=none so canvas hit-testing still works', () => {
    mount(at('point'));
    const root = screen.getByTestId('snap-indicator');
    expect(root.getAttribute('pointer-events')).toBe('none');
  });

  it('marker is positioned at the snap pos (grid example)', () => {
    mount(at('grid', 42, 17));
    const marker = screen.getByTestId('snap-indicator-grid');
    const lines = marker.querySelectorAll('line');
    // Horizontal arm: y1 == y2 == 17, spans x = pos.x ± r.
    const horiz = lines[0]!;
    expect(horiz.getAttribute('y1')).toBe('17');
    expect(horiz.getAttribute('y2')).toBe('17');
  });

  it('switching from one kind to another swaps the marker', () => {
    const { rerender } = render(
      <svg data-testid="host-svg" width={200} height={200}>
        <SketchSnapIndicator snap={at('grid')} />
      </svg>,
    );
    expect(screen.queryByTestId('snap-indicator-grid')).toBeInTheDocument();
    rerender(
      <svg data-testid="host-svg" width={200} height={200}>
        <SketchSnapIndicator snap={at('intersection')} />
      </svg>,
    );
    expect(screen.queryByTestId('snap-indicator-grid')).toBeNull();
    expect(screen.queryByTestId('snap-indicator-intersection')).toBeInTheDocument();
  });

  it('null after rendering a marker → unmounts', () => {
    const { rerender } = render(
      <svg data-testid="host-svg" width={200} height={200}>
        <SketchSnapIndicator snap={at('point')} />
      </svg>,
    );
    expect(screen.queryByTestId('snap-indicator')).toBeInTheDocument();
    rerender(
      <svg data-testid="host-svg" width={200} height={200}>
        <SketchSnapIndicator snap={null} />
      </svg>,
    );
    expect(screen.queryByTestId('snap-indicator')).toBeNull();
  });

  // ─── Phase 2 kind coverage (arc_* / *_perpendicular) ────────────────────
  // Phase 2 kinds were originally handled by the default branch (rendering
  // nothing). They now render a generic ring + dot marker so the host can
  // visually distinguish them via the testid + dedicated color. Tests below
  // assert: each kind mounts the wrapper group + per-kind testid, and the
  // perpendicular variants render a dashed ring (so users can see "this is
  // a foot, not a vertex" at a glance).
  for (const kind of [
    'arc_endpoint',
    'arc_center',
    'arc_quadrant',
    'arc_midpoint',
    'arc_nearest',
    'line_perpendicular',
    'circle_perpendicular',
  ] as const) {
    it(`${kind} kind → mounts wrapper + per-kind testid`, () => {
      mount(at(kind, 30, 40));
      expect(screen.getByTestId('snap-indicator')).toBeInTheDocument();
      const marker = screen.getByTestId(`snap-indicator-${kind}`);
      expect(marker).toBeInTheDocument();
      // Generic Phase 2 marker = ring + centre dot.
      expect(marker.querySelectorAll('circle').length).toBe(2);
    });
  }

  it('line_perpendicular renders dashed ring (signals "foot, not vertex")', () => {
    mount(at('line_perpendicular', 30, 40));
    const ring = screen
      .getByTestId('snap-indicator-line_perpendicular')
      .querySelectorAll('circle')[0]!;
    expect(ring.getAttribute('stroke-dasharray')).toBe('2 2');
  });

  it('circle_perpendicular renders dashed ring (signals "foot, not vertex")', () => {
    mount(at('circle_perpendicular', 30, 40));
    const ring = screen
      .getByTestId('snap-indicator-circle_perpendicular')
      .querySelectorAll('circle')[0]!;
    expect(ring.getAttribute('stroke-dasharray')).toBe('2 2');
  });

  it('arc_endpoint ring is NOT dashed (vertex, not foot)', () => {
    mount(at('arc_endpoint', 30, 40));
    const ring = screen
      .getByTestId('snap-indicator-arc_endpoint')
      .querySelectorAll('circle')[0]!;
    expect(ring.getAttribute('stroke-dasharray')).toBeNull();
  });
});
