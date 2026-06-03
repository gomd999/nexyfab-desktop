// @vitest-environment jsdom
/**
 * sheetRenderer.ordinate.test.tsx — Phase 4.2 Drawing UI track.
 *
 * Covers the SheetRenderer extension that renders Sheet.ordinateChains as
 * datum + leader-line + value-label groups (OrdinateChainLayer). Additive:
 * sheets without ordinate chains must render identically (no regression).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import type { OrdinateDimensionChain } from '@/lib/drawing/ordinateDimension';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';

function frontVp(): Viewport {
  return {
    id: 'front', sourceId: 'p1',
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: 150, y: 150 }, widthOnSheet: 100, scale: 1, label: 'FRONT',
  };
}

function baseSheet(): Sheet {
  return { id: 's-ord', name: 'Ordinate demo', paperSize: 'A3', viewports: [frontVp()] };
}

const chain: OrdinateDimensionChain = {
  id: 'ord-1',
  origin: { x: 20, y: 20 },
  axis: 'x',
  points: [
    { id: 'P1', x: 40, y: 20 },
    { id: 'P2', x: 80, y: 20 },
  ],
};

describe('SheetRenderer ordinate chains (Phase 4.2)', () => {
  it('sheet with no ordinate chains renders no ordinate nodes', () => {
    const { container } = render(<SheetRenderer sheet={baseSheet()} />);
    expect(container.querySelectorAll('[data-testid^="sheet-renderer-ordinate-"]').length).toBe(0);
  });

  it('renders one group per chain carrying its id', () => {
    const sheet: Sheet = { ...baseSheet(), ordinateChains: [chain] };
    const { getByTestId, container } = render(<SheetRenderer sheet={sheet} />);
    expect(getByTestId('sheet-renderer-ordinate-ord-1')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="sheet-renderer-ordinate-"]').length).toBe(1);
  });

  it('emits a leader group per point with the formatted value text', () => {
    const sheet: Sheet = { ...baseSheet(), ordinateChains: [chain] };
    const { container } = render(<SheetRenderer sheet={sheet} />);
    const group = container.querySelector('[data-testid="sheet-renderer-ordinate-ord-1"]')!;
    const leaders = group.querySelectorAll('[data-ordinate-point]');
    expect(leaders.length).toBe(2); // axis = x → one per point
    // P1 is 20mm right of the datum at x=20 → "20.00 mm".
    expect(group.textContent ?? '').toMatch(/20\.00 mm/);
    expect(group.textContent ?? '').toMatch(/60\.00 mm/); // P2 at x=80
  });

  it('axis = both emits two leaders per point (x + y)', () => {
    const both: OrdinateDimensionChain = { ...chain, id: 'ord-2', axis: 'both' };
    const sheet: Sheet = { ...baseSheet(), ordinateChains: [both] };
    const { container } = render(<SheetRenderer sheet={sheet} />);
    const group = container.querySelector('[data-testid="sheet-renderer-ordinate-ord-2"]')!;
    expect(group.querySelectorAll('[data-ordinate-axis="x"]').length).toBe(2);
    expect(group.querySelectorAll('[data-ordinate-axis="y"]').length).toBe(2);
  });

  it('a malformed chain is skipped, not crashed (renderer still mounts)', () => {
    const bad = { ...chain, id: 'ord-bad', points: [{ id: '', x: 0, y: 0 }] };
    const sheet: Sheet = { ...baseSheet(), ordinateChains: [bad] };
    const { getByTestId, container } = render(<SheetRenderer sheet={sheet} />);
    expect(getByTestId('sheet-renderer-root')).toBeInTheDocument();
    // The bad chain produced no group.
    expect(container.querySelectorAll('[data-ordinate-point]').length).toBe(0);
  });
});
