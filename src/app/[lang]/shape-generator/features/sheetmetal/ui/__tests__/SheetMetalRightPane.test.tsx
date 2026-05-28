/** @vitest-environment jsdom */
/**
 * SheetMetalRightPane.test.tsx — Wave 2 Phase 2 Track B5.
 *
 * Renders the Korean-canonical sheet-metal right pane (spec §6.3). Covers
 * material switching, thickness/radius sliders, K-factor table updates,
 * the bend-allowance preview math, and the auto-drawing button hook.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SheetMetalRightPane,
  K_FACTOR_RT_COLUMNS,
  closestRtColumn,
  type SheetMetalPaneState,
} from '../SheetMetalRightPane';
import { bendAllowance, getKFactor } from '../../../sheetMetalTables';

describe('SheetMetalRightPane — render baseline', () => {
  it('renders the pane container', () => {
    render(<SheetMetalRightPane lang="en" />);
    expect(screen.getByTestId('sheet-metal-right-pane')).toBeTruthy();
  });

  it('renders the localised title in English by default', () => {
    render(<SheetMetalRightPane lang="en" />);
    const title = screen.getByTestId('sheet-metal-pane-title');
    expect(title.textContent).toBe('Sheet metal properties');
  });

  it('renders the Korean title for lang=ko', () => {
    render(<SheetMetalRightPane lang="ko" />);
    const title = screen.getByTestId('sheet-metal-pane-title');
    expect(title.textContent).toBe('판금 속성');
  });

  it('renders all 4 main sections (material / thickness / k-table / preview)', () => {
    render(<SheetMetalRightPane lang="en" />);
    expect(screen.getByTestId('sheet-metal-section-material')).toBeTruthy();
    expect(screen.getByTestId('sheet-metal-section-thickness')).toBeTruthy();
    expect(screen.getByTestId('sheet-metal-section-k-table')).toBeTruthy();
    expect(screen.getByTestId('sheet-metal-section-ba-preview')).toBeTruthy();
  });

  it('renders 7 material options in the picker', () => {
    render(<SheetMetalRightPane lang="en" />);
    const select = screen.getByTestId('sheet-metal-material-select') as HTMLSelectElement;
    expect(select.options.length).toBe(7);
  });

  it('renders all 7 R/t column headers', () => {
    render(<SheetMetalRightPane lang="en" />);
    for (const rt of K_FACTOR_RT_COLUMNS) {
      expect(screen.getByTestId(`k-table-header-${rt}`)).toBeTruthy();
    }
  });

  it('defaults thickness to 1.5 mm', () => {
    render(<SheetMetalRightPane lang="en" />);
    const slider = screen.getByTestId('sheet-metal-thickness-slider') as HTMLInputElement;
    expect(Number(slider.value)).toBe(1.5);
  });

  it('defaults material to mildSteel', () => {
    render(<SheetMetalRightPane lang="en" />);
    const select = screen.getByTestId('sheet-metal-material-select') as HTMLSelectElement;
    expect(select.value).toBe('mildSteel');
  });
});

describe('SheetMetalRightPane — interaction', () => {
  it('material switch fires onChange with the new material', () => {
    const onChange = vi.fn();
    render(<SheetMetalRightPane lang="en" onChange={onChange} />);
    onChange.mockClear();
    fireEvent.change(
      screen.getByTestId('sheet-metal-material-select'),
      { target: { value: 'aluminum6061' } },
    );
    const last = onChange.mock.calls.at(-1)?.[0] as SheetMetalPaneState;
    expect(last.material).toBe('aluminum6061');
  });

  it('thickness slider drives the displayed value', () => {
    render(<SheetMetalRightPane lang="en" />);
    fireEvent.change(
      screen.getByTestId('sheet-metal-thickness-slider'),
      { target: { value: '3' } },
    );
    expect(screen.getByTestId('sheet-metal-thickness-value').textContent).toContain('3.00');
  });

  it('radius slider drives the displayed value', () => {
    render(<SheetMetalRightPane lang="en" initialRadius={2} />);
    fireEvent.change(
      screen.getByTestId('sheet-metal-radius-slider'),
      { target: { value: '5' } },
    );
    expect(screen.getByTestId('sheet-metal-radius-value').textContent).toContain('5.00');
  });

  it('opens the AutoDrawingDialog when the auto-drawing button is clicked', () => {
    render(<SheetMetalRightPane lang="en" />);
    fireEvent.click(screen.getByTestId('sheet-metal-auto-drawing-button'));
    expect(screen.getByTestId('auto-drawing-dialog')).toBeTruthy();
  });
});

describe('SheetMetalRightPane — K-factor table', () => {
  it('renders a K-value for every R/t column', () => {
    render(<SheetMetalRightPane lang="en" />);
    for (const rt of K_FACTOR_RT_COLUMNS) {
      const cell = screen.getByTestId(`k-table-cell-${rt}`);
      // value should look like "0.420" — 3-decimal monospace number.
      expect(cell.textContent).toMatch(/^[01]\.\d{3}$/);
    }
  });

  it('K-table values match getKFactor(material, rt × t, t) for mildSteel at t=1.5', () => {
    render(<SheetMetalRightPane lang="en" />);
    for (const rt of K_FACTOR_RT_COLUMNS) {
      const cell = screen.getByTestId(`k-table-cell-${rt}`);
      const expected = getKFactor('mildSteel', rt * 1.5, 1.5);
      expect(parseFloat(cell.textContent!)).toBeCloseTo(expected, 3);
    }
  });

  it('K-table values update when the material changes', () => {
    render(<SheetMetalRightPane lang="en" />);
    fireEvent.change(
      screen.getByTestId('sheet-metal-material-select'),
      { target: { value: 'stainless304' } },
    );
    // At R/t=0.5 the stainless K is 0.33, not mildSteel's 0.38.
    const cell = screen.getByTestId('k-table-cell-0.5');
    expect(parseFloat(cell.textContent!)).toBeCloseTo(0.33, 3);
  });

  it('highlights the column closest to the current R/t ratio', () => {
    // Default radius=1.5, t=1.5 → R/t=1.0 → column "1" highlighted.
    render(<SheetMetalRightPane lang="en" />);
    const cell = screen.getByTestId('k-table-cell-1');
    expect(cell.getAttribute('data-current')).toBe('true');
  });

  it('shifts the highlight when the radius changes', () => {
    render(<SheetMetalRightPane lang="en" />);
    // Move radius to 3, t still 1.5 → R/t=2 → "2" column highlighted.
    fireEvent.change(
      screen.getByTestId('sheet-metal-radius-slider'),
      { target: { value: '3' } },
    );
    expect(screen.getByTestId('k-table-cell-2').getAttribute('data-current')).toBe('true');
  });
});

describe('SheetMetalRightPane — bend-allowance preview', () => {
  it('renders the formula line', () => {
    render(<SheetMetalRightPane lang="en" />);
    const formula = screen.getByTestId('sheet-metal-ba-formula');
    expect(formula.textContent).toContain('π / 180');
  });

  it('computes BA for the sample (R=2, t=2, θ=90°) using the current material', () => {
    render(<SheetMetalRightPane lang="en" />);
    const ba = screen.getByTestId('sheet-metal-ba-value');
    // mildSteel K @ R/t=1 → 0.42; BA = π/180 · 90 · (2 + 0.42·2)
    const expected = bendAllowance(90, 2, 2, getKFactor('mildSteel', 2, 2));
    const printed = parseFloat(ba.textContent!.replace(/[^\d.]/g, ''));
    expect(printed).toBeCloseTo(expected, 2);
  });

  it('BA value updates when the material switches', () => {
    render(<SheetMetalRightPane lang="en" />);
    // before: mildSteel
    const beforeText = screen.getByTestId('sheet-metal-ba-value').textContent!;
    const beforeBA = parseFloat(beforeText.replace(/[^\d.]/g, ''));

    fireEvent.change(
      screen.getByTestId('sheet-metal-material-select'),
      { target: { value: 'aluminum5052' } },
    );

    const afterText = screen.getByTestId('sheet-metal-ba-value').textContent!;
    const afterBA = parseFloat(afterText.replace(/[^\d.]/g, ''));

    // K differs across materials so BA shifts.
    expect(afterBA).not.toBeCloseTo(beforeBA, 4);
  });
});

describe('closestRtColumn helper', () => {
  it('snaps to the nearest column for exact matches', () => {
    expect(closestRtColumn(2)).toBe(2);
    expect(closestRtColumn(0.5)).toBe(0.5);
    expect(closestRtColumn(10)).toBe(10);
  });

  it('snaps to nearest column for between values', () => {
    // 1.25 is closer to 1 than to 1.5? distance: 0.25 vs 0.25. tied — first wins.
    // 1.3 → 1.5 closer. 0.7 → 0.5 closer.
    expect(closestRtColumn(1.3)).toBe(1.5);
    expect(closestRtColumn(0.7)).toBe(0.5);
    expect(closestRtColumn(7)).toBe(5);
    expect(closestRtColumn(20)).toBe(10);
  });
});
