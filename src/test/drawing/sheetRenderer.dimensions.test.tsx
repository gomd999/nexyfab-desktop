// @vitest-environment jsdom
/**
 * sheetRenderer.dimensions.test.tsx — Phase 4.2 Drawing UI track.
 *
 * Covers the SheetRenderer extension that renders Sheet.dimensions and
 * Sheet.gdtCallouts on top of viewport boxes. Phase 1 limitation: the
 * dimension is rendered as a placeholder horizontal call across the
 * target viewport (no real geometry projection yet).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';

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

function baseSheet(): Sheet {
  return {
    id: 's-ann', name: 'Annotations demo', paperSize: 'A3',
    viewports: [frontVp(), topVp()],
  };
}

const linDim: Dimension = {
  id: 'd1', viewportId: 'front', kind: 'linear', refs: ['e1', 'e2'],
  valueOverride: 20, tolerance: { kind: 'bilateral', upper: 0.1, lower: 0.1 },
};

const radialDim: Dimension = {
  id: 'd2', viewportId: 'top', kind: 'radial', refs: ['c1'],
  valueOverride: 5, prefix: 'R',
};

const flatCallout: GdtCallout = {
  id: 'g1', viewportId: 'front', kind: 'flatness', targetRef: 'f1', toleranceValue: 0.05,
};

const posCallout: GdtCallout = {
  id: 'g2', viewportId: 'top', kind: 'position', targetRef: 'f2',
  toleranceValue: 0.1, datums: ['A', 'B'], materialCondition: 'M',
};

describe('SheetRenderer dimensions + GD&T (Phase 4.2)', () => {
  it('sheet with no dimensions/gd&t renders without any dim or gdt nodes', () => {
    const { container } = render(<SheetRenderer sheet={baseSheet()} />);
    expect(container.querySelectorAll('[data-testid^="sheet-renderer-dim-"]').length).toBe(0);
    expect(container.querySelectorAll('[data-testid^="sheet-renderer-gdt-"]').length).toBe(0);
  });

  it('renders one group per dimension with the expected testid', () => {
    const sheet: Sheet = { ...baseSheet(), dimensions: [linDim, radialDim] };
    const { getByTestId, container } = render(<SheetRenderer sheet={sheet} />);
    expect(getByTestId('sheet-renderer-dim-0')).not.toBeNull();
    expect(getByTestId('sheet-renderer-dim-1')).not.toBeNull();
    const dims = container.querySelectorAll('[data-testid^="sheet-renderer-dim-"]');
    expect(dims.length).toBe(2);
  });

  it('dimension group carries data-dim-id / data-dim-kind / data-dim-viewport', () => {
    const sheet: Sheet = { ...baseSheet(), dimensions: [linDim] };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const dim = getByTestId('sheet-renderer-dim-0');
    expect(dim.getAttribute('data-dim-id')).toBe('d1');
    expect(dim.getAttribute('data-dim-kind')).toBe('linear');
    expect(dim.getAttribute('data-dim-viewport')).toBe('front');
  });

  it('dimension renders a dim line + 2 arrowhead polygons + 2 witness lines', () => {
    const sheet: Sheet = { ...baseSheet(), dimensions: [linDim] };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const dim = getByTestId('sheet-renderer-dim-0');
    expect(dim.querySelectorAll('line').length).toBeGreaterThanOrEqual(3);
    expect(dim.querySelectorAll('polygon').length).toBe(2);
  });

  it('dimension renders its formatted label (override + tolerance)', () => {
    const sheet: Sheet = { ...baseSheet(), dimensions: [linDim] };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const text = getByTestId('sheet-renderer-dim-0').querySelector('text');
    expect(text?.textContent).toContain('20');
    expect(text?.textContent).toContain('0.1');
  });

  it('dimension references unknown viewport: silently skipped (defensive)', () => {
    const ghost: Dimension = { ...linDim, viewportId: 'ghost' };
    // Skip validation to test renderer's defensive code path.
    const sheet = {
      ...baseSheet(),
      dimensions: [ghost],
    } as Sheet;
    const { container } = render(<SheetRenderer sheet={sheet} />);
    expect(container.querySelectorAll('[data-testid^="sheet-renderer-dim-"]').length).toBe(0);
  });

  it('renders one group per GD&T callout with the expected testid', () => {
    const sheet: Sheet = { ...baseSheet(), gdtCallouts: [flatCallout, posCallout] };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    expect(getByTestId('sheet-renderer-gdt-0')).not.toBeNull();
    expect(getByTestId('sheet-renderer-gdt-1')).not.toBeNull();
  });

  it('GD&T group carries data-gdt-id / data-gdt-kind / data-gdt-viewport', () => {
    const sheet: Sheet = { ...baseSheet(), gdtCallouts: [posCallout] };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const gdt = getByTestId('sheet-renderer-gdt-0');
    expect(gdt.getAttribute('data-gdt-id')).toBe('g2');
    expect(gdt.getAttribute('data-gdt-kind')).toBe('position');
    expect(gdt.getAttribute('data-gdt-viewport')).toBe('top');
  });

  it('GD&T renders a bordered rect + a text element with formatGdt() content', () => {
    const sheet: Sheet = { ...baseSheet(), gdtCallouts: [posCallout] };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    const gdt = getByTestId('sheet-renderer-gdt-0');
    expect(gdt.querySelector('rect')).not.toBeNull();
    const text = gdt.querySelector('text');
    expect(text).not.toBeNull();
    // formatGdt: '[POS|0.1(M)|A|B]'
    expect(text?.textContent).toBe('[POS|0.1(M)|A|B]');
  });

  it('GD&T references unknown viewport: silently skipped (defensive)', () => {
    const ghost: GdtCallout = { ...flatCallout, viewportId: 'ghost' };
    const sheet = {
      ...baseSheet(),
      gdtCallouts: [ghost],
    } as Sheet;
    const { container } = render(<SheetRenderer sheet={sheet} />);
    expect(container.querySelectorAll('[data-testid^="sheet-renderer-gdt-"]').length).toBe(0);
  });

  it('dimensions and gd&t co-exist with regular viewports + section/detail adornments', () => {
    const sheet: Sheet = {
      ...baseSheet(),
      dimensions: [linDim],
      gdtCallouts: [flatCallout],
    };
    const { getByTestId } = render(<SheetRenderer sheet={sheet} />);
    expect(getByTestId('sheet-renderer-viewport-border-front')).not.toBeNull();
    expect(getByTestId('sheet-renderer-dim-0')).not.toBeNull();
    expect(getByTestId('sheet-renderer-gdt-0')).not.toBeNull();
  });
});
