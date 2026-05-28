/** @vitest-environment jsdom */
/**
 * BendTableDock.test.tsx — Wave 2 Phase 2 Track B5.
 *
 * Renders the bottom-docked K-factor lookup table. Validates the full
 * 7-materials × 7-columns table is populated, cell clicks copy to
 * clipboard, the CSV export button assembles a CSV, and the collapse +
 * close toolbar interactions work as expected.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BendTableDock } from '../BendTableDock';
import { K_FACTOR_RT_COLUMNS } from '../SheetMetalRightPane';
import { getKFactor, SHEET_METAL_MATERIALS } from '../../../sheetMetalTables';

function makeClipboard() {
  const writes: string[] = [];
  return {
    writes,
    writeText: vi.fn(async (s: string) => {
      writes.push(s);
    }),
  };
}

describe('BendTableDock — render baseline', () => {
  it('renders the dock container', () => {
    render(<BendTableDock lang="en" />);
    expect(screen.getByTestId('bend-table-dock')).toBeTruthy();
  });

  it('renders the toolbar with refresh / CSV / collapse buttons', () => {
    render(<BendTableDock lang="en" />);
    expect(screen.getByTestId('bend-table-dock-toolbar')).toBeTruthy();
    expect(screen.getByTestId('bend-table-dock-refresh')).toBeTruthy();
    expect(screen.getByTestId('bend-table-dock-csv')).toBeTruthy();
    expect(screen.getByTestId('bend-table-dock-toggle')).toBeTruthy();
  });

  it('renders the close button only when onClose is provided', () => {
    const { rerender } = render(<BendTableDock lang="en" />);
    expect(screen.queryByTestId('bend-table-dock-close')).toBeNull();
    rerender(<BendTableDock lang="en" onClose={() => {}} />);
    expect(screen.getByTestId('bend-table-dock-close')).toBeTruthy();
  });

  it('renders one row per Schema A material (7 materials)', () => {
    render(<BendTableDock lang="en" />);
    const materials = Object.keys(SHEET_METAL_MATERIALS);
    expect(materials.length).toBe(7);
    for (const m of materials) {
      expect(screen.getByTestId(`bend-table-dock-row-${m}`)).toBeTruthy();
    }
  });

  it('renders the R/t column headers (7 columns)', () => {
    render(<BendTableDock lang="en" />);
    for (const rt of K_FACTOR_RT_COLUMNS) {
      expect(screen.getByTestId(`bend-table-dock-header-${rt}`)).toBeTruthy();
    }
  });
});

describe('BendTableDock — data', () => {
  it('cell values match getKFactor for every material × R/t pair', () => {
    render(<BendTableDock lang="en" />);
    for (const m of Object.keys(SHEET_METAL_MATERIALS) as (keyof typeof SHEET_METAL_MATERIALS)[]) {
      for (const rt of K_FACTOR_RT_COLUMNS) {
        const cell = screen.getByTestId(`bend-table-dock-cell-${m}-${rt}`);
        const expected = getKFactor(m, rt, 1);
        expect(parseFloat(cell.textContent!)).toBeCloseTo(expected, 3);
      }
    }
  });
});

describe('BendTableDock — interactions', () => {
  it('clicking a cell selects it (data-selected) and copies the K value', async () => {
    const cb = makeClipboard();
    render(<BendTableDock lang="en" clipboard={cb} />);
    const cell = screen.getByTestId('bend-table-dock-cell-mildSteel-1');
    fireEvent.click(cell);
    // Wait a microtask for the async copy.
    await Promise.resolve();
    await Promise.resolve();
    expect(cell.getAttribute('data-selected')).toBe('true');
    expect(cb.writes.length).toBeGreaterThanOrEqual(1);
    expect(cb.writes[0]).toMatch(/^[01]\.\d{3}$/);
  });

  it('clicking a second cell moves the selection off the first', async () => {
    const cb = makeClipboard();
    render(<BendTableDock lang="en" clipboard={cb} />);
    const a = screen.getByTestId('bend-table-dock-cell-mildSteel-1');
    const b = screen.getByTestId('bend-table-dock-cell-aluminum5052-2');
    fireEvent.click(a);
    await Promise.resolve();
    fireEvent.click(b);
    await Promise.resolve();
    expect(a.getAttribute('data-selected')).toBeNull();
    expect(b.getAttribute('data-selected')).toBe('true');
  });

  it('CSV export writes a header + 7 rows', async () => {
    const cb = makeClipboard();
    render(<BendTableDock lang="en" clipboard={cb} />);
    fireEvent.click(screen.getByTestId('bend-table-dock-csv'));
    await Promise.resolve();
    await Promise.resolve();
    expect(cb.writes.length).toBe(1);
    const csv = cb.writes[0];
    const lines = csv.split('\n');
    expect(lines.length).toBe(1 + 7); // header + 7 materials
    expect(lines[0]).toContain('R/t=');
  });

  it('collapse toggle adds data-collapsed and hides the table', () => {
    render(<BendTableDock lang="en" />);
    const dock = screen.getByTestId('bend-table-dock');
    expect(dock.getAttribute('data-collapsed')).toBeNull();
    fireEvent.click(screen.getByTestId('bend-table-dock-toggle'));
    expect(dock.getAttribute('data-collapsed')).toBe('true');
    expect(screen.queryByTestId('bend-table-dock-table')).toBeNull();
  });

  it('close button invokes onClose', () => {
    const onClose = vi.fn();
    render(<BendTableDock lang="en" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('bend-table-dock-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('refresh button does not throw and clears the selection', async () => {
    const cb = makeClipboard();
    render(<BendTableDock lang="en" clipboard={cb} />);
    const cell = screen.getByTestId('bend-table-dock-cell-mildSteel-1');
    fireEvent.click(cell);
    await Promise.resolve();
    expect(cell.getAttribute('data-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('bend-table-dock-refresh'));
    expect(cell.getAttribute('data-selected')).toBeNull();
  });
});

describe('BendTableDock — i18n', () => {
  it('uses Korean labels for lang=ko', () => {
    render(<BendTableDock lang="ko" />);
    const toolbar = screen.getByTestId('bend-table-dock-toolbar');
    // 절곡 표 = bend table (KO dockTitle)
    expect(toolbar.textContent).toContain('절곡 표');
  });
});
