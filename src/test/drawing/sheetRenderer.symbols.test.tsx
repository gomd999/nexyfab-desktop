// @vitest-environment jsdom
/**
 * sheetRenderer.symbols.test.tsx — Phase 4.2.
 *
 * Surface-finish (ISO 1302) + weld (AWS/ISO) callouts rendered on the sheet,
 * anchored to their target viewport. Additive: sheets without symbols render
 * none (no regression).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import type { SurfaceFinishSymbol } from '@/lib/drawing/surfaceFinishSymbol';
import type { WeldSymbol } from '@/lib/drawing/weldSymbol';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';

function vp(id: string): Viewport {
  return {
    id, sourceId: 'p1',
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: 150, y: 150 }, widthOnSheet: 100, scale: 1, label: 'FRONT',
  };
}

function baseSheet(): Sheet {
  return { id: 's-sym', name: 'Symbols demo', paperSize: 'A3', viewports: [vp('front')] };
}

const finish: SurfaceFinishSymbol = {
  id: 'sf1', viewportId: 'front', targetRef: 'face-1',
  kind: 'machining_required', raMax: 3.2, productionMethod: 'milled',
};

const weld: WeldSymbol = {
  id: 'w1', viewportId: 'front', targetRef: 'edge-1',
  weldType: 'fillet', side: 'arrow', size: 6, length: 40, pitch: 80,
};

describe('SheetRenderer surface-finish + weld callouts (Phase 4.2)', () => {
  it('no symbols → no callout nodes', () => {
    const { container } = render(<SheetRenderer sheet={baseSheet()} />);
    expect(container.querySelectorAll('[data-symbol-kind]').length).toBe(0);
  });

  it('renders a surface-finish callout with the formatted Ra text', () => {
    const sheet: Sheet = { ...baseSheet(), surfaceFinishSymbols: [finish] };
    const { container } = render(<SheetRenderer sheet={sheet} />);
    const el = container.querySelector('[data-testid="sheet-renderer-surface-finish-sf1"]')!;
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-symbol-kind')).toBe('surface-finish');
    expect(el.getAttribute('data-symbol-target')).toBe('front');
    expect(el.textContent ?? '').toMatch(/3\.2/);
  });

  it('renders a weld callout with the formatted weld text', () => {
    const sheet: Sheet = { ...baseSheet(), weldSymbols: [weld] };
    const { container } = render(<SheetRenderer sheet={sheet} />);
    const el = container.querySelector('[data-testid="sheet-renderer-weld-w1"]')!;
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-symbol-kind')).toBe('weld');
    expect(el.textContent ?? '').toMatch(/fillet/i);
    expect(el.textContent ?? '').toMatch(/40-80/); // length-pitch
  });

  it('a symbol targeting an unknown viewport is silently skipped', () => {
    const sheet: Sheet = {
      ...baseSheet(),
      surfaceFinishSymbols: [{ ...finish, id: 'sfX', viewportId: 'ghost' }],
    };
    const { container } = render(<SheetRenderer sheet={sheet} />);
    expect(container.querySelector('[data-testid="sheet-renderer-surface-finish-sfX"]')).toBeNull();
  });

  it('multiple callouts on one viewport stack at distinct y positions', () => {
    const sheet: Sheet = {
      ...baseSheet(),
      surfaceFinishSymbols: [finish, { ...finish, id: 'sf2', raMax: 1.6 }],
    };
    const { container } = render(<SheetRenderer sheet={sheet} />);
    const a = container.querySelector('[data-testid="sheet-renderer-surface-finish-sf1"]')!;
    const b = container.querySelector('[data-testid="sheet-renderer-surface-finish-sf2"]')!;
    expect(a.getAttribute('y')).not.toBe(b.getAttribute('y'));
  });
});
