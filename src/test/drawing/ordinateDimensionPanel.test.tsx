/** @vitest-environment jsdom */
/**
 * OrdinateDimensionPanel — Phase 4.2 UI tests for the standalone ordinate
 * (baseline / CMM-style) dimensioning panel + its drawing-page toggle.
 *
 * The panel is engine-pure (ordinateDimension.ts), so it mounts in jsdom
 * with no canvas. The math is covered by ordinateDimension.test.ts.
 *
 * Coverage:
 *   1. empty state + add/delete points
 *   2. live computed values (x / both axes, precision, unit)
 *   3. validation errors (duplicate id, empty id)
 *   4. SVG preview built from buildOrdinateRenderHints
 *   5. 6-lang title localisation + RTL on Arabic
 *   6. DrawingPageContent — toggle mounts/unmounts the panel section
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import OrdinateDimensionPanel, {
  type DrawingLang,
} from '@/app/[lang]/shape-generator/drawing/OrdinateDimensionPanel';
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';

afterEach(cleanup);

function mountPanel(
  lang: DrawingLang = 'en',
  initialPoints?: ReadonlyArray<{ id: string; x: number; y: number }>,
): void {
  render(<OrdinateDimensionPanel lang={lang} initialPoints={initialPoints} />);
}

describe('OrdinateDimensionPanel — basics', () => {
  it('mounts empty with the empty hint', () => {
    mountPanel();
    expect(screen.getByTestId('drawing-ordinate-panel')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-ordinate-empty')).toBeInTheDocument();
  });

  it('Add appends a point row and drops the empty hint', () => {
    mountPanel();
    fireEvent.click(screen.getByTestId('drawing-ordinate-add-point'));
    expect(screen.queryByTestId('drawing-ordinate-empty')).toBeNull();
    expect(document.querySelectorAll('[data-testid^="drawing-ordinate-point-row-"]')).toHaveLength(1);
  });

  it('Delete removes the row', () => {
    mountPanel('en', [{ id: 'P1', x: 10, y: 0 }]);
    const row = document.querySelector('[data-testid^="drawing-ordinate-point-row-"]')!;
    const key = row.getAttribute('data-testid')!.replace('drawing-ordinate-point-row-', '');
    fireEvent.click(screen.getByTestId(`drawing-ordinate-point-del-${key}`));
    expect(screen.getByTestId('drawing-ordinate-empty')).toBeInTheDocument();
  });
});

describe('OrdinateDimensionPanel — computed values', () => {
  it('shows signed x distance from the origin (default axis = x)', () => {
    mountPanel('en', [{ id: 'P1', x: 30, y: 5 }]);
    // origin defaults to (0,0), precision 2, unit mm.
    expect(screen.getByTestId('drawing-ordinate-value-P1-x').textContent ?? '').toMatch(/30\.00 mm/);
    expect(screen.queryByTestId('drawing-ordinate-value-P1-y')).toBeNull(); // axis=x only
  });

  it('subtracts a non-zero origin and honours axis=both', () => {
    mountPanel('en', [{ id: 'P1', x: 30, y: 20 }]);
    fireEvent.change(screen.getByTestId('drawing-ordinate-origin-x'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('drawing-ordinate-axis'), { target: { value: 'both' } });
    expect(screen.getByTestId('drawing-ordinate-value-P1-x').textContent ?? '').toMatch(/20\.00 mm/);
    expect(screen.getByTestId('drawing-ordinate-value-P1-y').textContent ?? '').toMatch(/20\.00 mm/);
  });

  it('honours precision and unit', () => {
    mountPanel('en', [{ id: 'P1', x: 25.4, y: 0 }]);
    fireEvent.change(screen.getByTestId('drawing-ordinate-precision'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('drawing-ordinate-unit'), { target: { value: 'in' } });
    expect(screen.getByTestId('drawing-ordinate-value-P1-x').textContent ?? '').toMatch(/25\.4 in/);
  });

  it('renders an SVG preview when the chain is valid', () => {
    mountPanel('en', [{ id: 'P1', x: 10, y: 0 }, { id: 'P2', x: 40, y: 0 }]);
    expect(screen.getByTestId('drawing-ordinate-preview')).toBeInTheDocument();
  });
});

describe('OrdinateDimensionPanel — validation', () => {
  it('flags duplicate point ids', () => {
    mountPanel('en', [{ id: 'P1', x: 10, y: 0 }, { id: 'P1', x: 20, y: 0 }]);
    expect(screen.getByTestId('drawing-ordinate-errors').textContent ?? '').toMatch(/duplicate/i);
    expect(screen.queryByTestId('drawing-ordinate-preview')).toBeNull();
  });

  it('flags an empty point id', () => {
    mountPanel('en', [{ id: 'P1', x: 10, y: 0 }]);
    const row = document.querySelector('[data-testid^="drawing-ordinate-point-row-"]')!;
    const key = row.getAttribute('data-testid')!.replace('drawing-ordinate-point-row-', '');
    fireEvent.change(screen.getByTestId(`drawing-ordinate-point-id-${key}`), { target: { value: '' } });
    expect(screen.getByTestId('drawing-ordinate-errors').textContent ?? '').toMatch(/empty id/i);
  });
});

describe('OrdinateDimensionPanel — i18n', () => {
  const cases: Array<[DrawingLang, RegExp]> = [
    ['ko', /기준선 치수/],
    ['en', /Ordinate Dimensions/],
    ['ja', /基準線寸法/],
    ['zh', /基准线尺寸/],
    ['es', /Cotas de ordenada/],
    ['ar', /أبعاد خط الأساس/],
  ];
  it('localises the title across 6 langs and sets RTL for Arabic', () => {
    for (const [lang, re] of cases) {
      mountPanel(lang);
      const panel = screen.getByTestId('drawing-ordinate-panel');
      expect(panel.textContent ?? '').toMatch(re);
      expect(panel.getAttribute('dir')).toBe(lang === 'ar' ? 'rtl' : 'ltr');
      cleanup();
    }
  });
});

describe('DrawingPageContent — ordinate toggle integration', () => {
  it('toggle is OFF by default; ON mounts the section; OFF unmounts it', () => {
    render(<DrawingPageContent lang="en" />);
    const toggle = screen.getByTestId('drawing-ordinate-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.queryByTestId('drawing-ordinate-panel-section')).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByTestId('drawing-ordinate-panel-section')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-ordinate-panel')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByTestId('drawing-ordinate-panel-section')).toBeNull();
  });

  it('toggle label flips to the hide copy when open (en)', () => {
    render(<DrawingPageContent lang="en" />);
    const toggle = screen.getByTestId('drawing-ordinate-toggle');
    const label = toggle.closest('label')!;
    expect(label.textContent ?? '').toMatch(/ordinate dimensions/i);
    fireEvent.click(toggle);
    expect(label.textContent ?? '').toMatch(/hide ordinate dimensions/i);
  });
});
