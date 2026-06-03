// @vitest-environment jsdom
/**
 * sheetRenderer.holeTable.test.tsx — Phase 4.3.
 * Hole schedule grid rendered in the sheet corner from Sheet.holes.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import type { HoleSpec } from '@/lib/drawing/holeTable';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';

function vp(): Viewport {
  return {
    id: 'front', sourceId: 'p1',
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: 150, y: 150 }, widthOnSheet: 100, scale: 1, label: 'FRONT',
  };
}
function baseSheet(): Sheet {
  return { id: 's-ht', name: 'Hole table demo', paperSize: 'A3', viewports: [vp()] };
}

const holes: HoleSpec[] = [
  { id: 'h1', x: 10, y: 10, diameter: 5 },
  { id: 'h2', x: 30, y: 10, diameter: 5 },        // identical ⌀ → grouped with h1
  { id: 'h3', x: 50, y: 20, diameter: 8, depth: 6 },
];

describe('SheetRenderer hole table (Phase 4.3)', () => {
  it('no holes → no hole table', () => {
    const { container } = render(<SheetRenderer sheet={baseSheet()} />);
    expect(container.querySelector('[data-testid="sheet-renderer-hole-table"]')).toBeNull();
  });

  it('renders a grouped hole table with a header + grouped rows', () => {
    const sheet: Sheet = { ...baseSheet(), holes };
    const { container } = render(<SheetRenderer sheet={sheet} />);
    const table = container.querySelector('[data-testid="sheet-renderer-hole-table"]')!;
    expect(table).not.toBeNull();
    // 2 grouped rows (⌀5 ×2, ⌀8 ×1) → data-rows = 2.
    expect(table.getAttribute('data-rows')).toBe('2');
    // header row + 2 body rows.
    expect(table.querySelectorAll('[data-hole-row]').length).toBe(3);
    expect(table.querySelector('[data-hole-row="header"]')).not.toBeNull();
    // THRU label for the through holes, blind depth for h3.
    const text = table.textContent ?? '';
    expect(text).toMatch(/THRU/);
    expect(text).toMatch(/TAG/);
  });

  it('a malformed hole list is skipped, not crashed', () => {
    const sheet: Sheet = { ...baseSheet(), holes: [{ id: '', x: 0, y: 0, diameter: 5 }] };
    const { getByTestId, container } = render(<SheetRenderer sheet={sheet} />);
    expect(getByTestId('sheet-renderer-root')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="sheet-renderer-hole-table"]')).toBeNull();
  });
});
