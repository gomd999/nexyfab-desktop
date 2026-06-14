// @vitest-environment jsdom
/**
 * drawingAnnotationFlow — VERIFICATION (not new feature) that the existing
 * dimension + GD&T authoring path actually works end-to-end, the same code the
 * production drawing page runs:
 *
 *   "Add annotation" button → DimensionAnnotationModal (form) → onAdd(IR)
 *      → sheet.dimensions / sheet.gdtCallouts → SheetRenderer draws them.
 *
 * The GD&T data layer (gdt.ts / formatFeatureControlFrame) is already covered by
 * gdt.test.ts; this fills the untested integration seam — the modal component
 * and the renderer consuming its output — where a "wired but broken" bug would
 * hide (cf. the assembly-close / CollabProvider wired-but-broken finds).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import DimensionAnnotationModal from './DimensionAnnotationModal';
import { SheetRenderer } from './SheetRenderer';
import { validateDimension, validateGdt, type Dimension, type GdtCallout } from '@/lib/drawing/dimension';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Polyhedron } from '@/lib/cad/featureMesh';

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
const geometry = new Map<string, Polyhedron>([['cube', centeredCube()]]);

function frontSheet(): Sheet {
  return {
    id: 's1', name: 'annot test', paperSize: 'A4',
    viewports: [{
      id: 'fv', sourceId: 'cube',
      projection: { kind: 'standard', view: 'front' },
      centerOnSheet: { x: 100, y: 100 }, widthOnSheet: 60, scale: 1, label: 'FRONT',
    }],
  } as Sheet;
}

describe('drawing annotation flow — author → IR → render (verification)', () => {
  it('the modal authors a valid linear Dimension and hands it to onAdd', () => {
    const onAdd = vi.fn();
    const { getByTestId } = render(
      <DimensionAnnotationModal lang="en" sheet={frontSheet()} viewportId="fv" onAdd={onAdd} onClose={() => {}} />,
    );
    fireEvent.click(getByTestId('solver-dim-kind-dimension'));
    fireEvent.change(getByTestId('solver-dim-ref-0-input'), { target: { value: 'edge-a' } });
    fireEvent.change(getByTestId('solver-dim-ref-1-input'), { target: { value: 'edge-b' } });
    fireEvent.change(getByTestId('solver-dim-value-override-input'), { target: { value: '25' } });
    fireEvent.click(getByTestId('solver-dim-submit'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const dim = onAdd.mock.calls[0][0] as Dimension;
    expect(dim.kind).toBe('linear');
    expect(dim.refs).toEqual(['edge-a', 'edge-b']);
    expect(dim.viewportId).toBe('fv');
    // The produced IR must pass the production validator (no "wired but broken").
    expect(() => validateDimension(dim)).not.toThrow();
  });

  it('the modal authors a valid GD&T flatness callout (with datums) for onAdd', () => {
    const onAdd = vi.fn();
    const { getByTestId } = render(
      <DimensionAnnotationModal lang="en" sheet={frontSheet()} viewportId="fv" onAdd={onAdd} onClose={() => {}} />,
    );
    fireEvent.click(getByTestId('solver-dim-kind-gdt'));
    fireEvent.change(getByTestId('solver-dim-gdt-target-input'), { target: { value: 'top-face' } });
    fireEvent.change(getByTestId('solver-dim-gdt-tolerance-input'), { target: { value: '0.05' } });
    fireEvent.change(getByTestId('solver-dim-gdt-datums-input'), { target: { value: 'A, B' } });
    fireEvent.click(getByTestId('solver-dim-submit'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const g = onAdd.mock.calls[0][0] as GdtCallout;
    expect(g.kind).toBe('flatness');
    expect(g.targetRef).toBe('top-face');
    expect(g.toleranceValue).toBe(0.05);
    expect(g.datums).toEqual(['A', 'B']); // comma-split + trimmed
    expect(g.viewportId).toBe('fv');
    expect(() => validateGdt(g)).not.toThrow();
  });

  it('rejects an incomplete dimension (empty refs) without calling onAdd', () => {
    const onAdd = vi.fn();
    const { getByTestId } = render(
      <DimensionAnnotationModal lang="en" sheet={frontSheet()} viewportId="fv" onAdd={onAdd} onClose={() => {}} />,
    );
    fireEvent.click(getByTestId('solver-dim-kind-dimension'));
    fireEvent.click(getByTestId('solver-dim-submit')); // refs still empty
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('SheetRenderer renders a sheet carrying a dimension + GD&T callout without throwing', () => {
    const dim: Dimension = {
      id: 'd1', viewportId: 'fv', kind: 'linear', refs: ['a', 'b'], valueOverride: 25,
    } as Dimension;
    const g: GdtCallout = {
      id: 'g1', viewportId: 'fv', kind: 'flatness', targetRef: 'top-face', toleranceValue: 0.05,
    };
    const sheet: Sheet = { ...frontSheet(), dimensions: [dim], gdtCallouts: [g] } as Sheet;
    let svg = '';
    expect(() => { svg = renderToStaticMarkup(<SheetRenderer sheet={sheet} geometry={geometry} />); }).not.toThrow();
    expect(svg.length).toBeGreaterThan(100);
    // The dimension value should appear somewhere in the drawn output.
    expect(svg).toContain('25');
  });
});
