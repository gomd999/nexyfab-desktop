// @vitest-environment jsdom
/**
 * FamilyExportButton.test.tsx — A4 family export button + modal.
 *
 * Covers:
 *   - button visible
 *   - modal opens on click + closes on cancel
 *   - select-all / select-none chips
 *   - click "Export" triggers zip + closes progress
 *   - placeholder-mode notice shown when no stepExporter
 *   - custom stepExporter is called per selected config
 *   - empty config list → disabled button
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FamilyExportButton from '../FamilyExportButton';
import { ConfigurationTable } from '../../ConfigurationTable';
import type { FeatureInstance } from '../../../features/types';

function feat(id: string, params: Record<string, number>): FeatureInstance {
  return {
    id,
    type: 'fillet' as FeatureInstance['type'],
    params,
    enabled: true,
  };
}

function makeTable(n: number): { table: ConfigurationTable; features: FeatureInstance[] } {
  const table = new ConfigurationTable();
  for (let i = 0; i < n; i += 1) table.add(`C${i}`, { id: `cfg-${i}` });
  const features = [feat('f1', { r: 5 }), feat('f2', { d: 10 })];
  return { table, features };
}

beforeEach(() => {
  // URL.createObjectURL / revokeObjectURL stubs for jsdom.
  if (typeof URL.createObjectURL === 'undefined') {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:test'),
      configurable: true,
    });
  }
  if (typeof URL.revokeObjectURL === 'undefined') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
  }
});

describe('FamilyExportButton — render', () => {
  it('renders the button when at least one config exists', () => {
    const { table, features } = makeTable(2);
    render(<FamilyExportButton table={table} features={features} lang="en" />);
    expect(screen.getByTestId('family-export-button')).toBeInTheDocument();
  });

  it('button is disabled when no configs', () => {
    const table = new ConfigurationTable();
    render(<FamilyExportButton table={table} features={[]} lang="en" />);
    const btn = screen.getByTestId('family-export-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('renders Korean label when lang="ko"', () => {
    const { table, features } = makeTable(1);
    render(<FamilyExportButton table={table} features={features} lang="ko" />);
    expect(screen.getByText('패밀리 내보내기')).toBeInTheDocument();
  });
});

describe('FamilyExportButton — modal', () => {
  it('opens modal on button click', () => {
    const { table, features } = makeTable(2);
    render(<FamilyExportButton table={table} features={features} lang="en" />);
    fireEvent.click(screen.getByTestId('family-export-button'));
    expect(screen.getByTestId('family-export-modal')).toBeInTheDocument();
  });

  it('closes modal on cancel', () => {
    const { table, features } = makeTable(2);
    render(<FamilyExportButton table={table} features={features} lang="en" />);
    fireEvent.click(screen.getByTestId('family-export-button'));
    fireEvent.click(screen.getByTestId('family-export-cancel'));
    expect(screen.queryByTestId('family-export-modal')).not.toBeInTheDocument();
  });

  it('shows checkboxes per config — selected by default', () => {
    const { table, features } = makeTable(3);
    render(<FamilyExportButton table={table} features={features} lang="en" />);
    fireEvent.click(screen.getByTestId('family-export-button'));
    const c0 = screen.getByTestId('family-export-pick-cfg-0') as HTMLInputElement;
    expect(c0.checked).toBe(true);
  });

  it('select-none unchecks all', () => {
    const { table, features } = makeTable(3);
    render(<FamilyExportButton table={table} features={features} lang="en" />);
    fireEvent.click(screen.getByTestId('family-export-button'));
    fireEvent.click(screen.getByTestId('family-export-select-none'));
    const c0 = screen.getByTestId('family-export-pick-cfg-0') as HTMLInputElement;
    expect(c0.checked).toBe(false);
  });
});

describe('FamilyExportButton — export', () => {
  it('shows placeholder-mode notice when no stepExporter', async () => {
    const { table, features } = makeTable(2);
    render(<FamilyExportButton table={table} features={features} lang="en" />);
    fireEvent.click(screen.getByTestId('family-export-button'));
    fireEvent.click(screen.getByTestId('family-export-go'));
    await waitFor(() =>
      expect(screen.getByTestId('family-export-deferred-notice')).toBeInTheDocument(),
    );
  });

  it('calls stepExporter for each selected config when provided', async () => {
    const { table, features } = makeTable(2);
    const stepExporter = vi.fn<(configId: string, resolved: FeatureInstance[]) => Promise<string>>(
      async () => '!! mock step body !!',
    );
    render(
      <FamilyExportButton
        table={table}
        features={features}
        lang="en"
        stepExporter={stepExporter}
      />,
    );
    fireEvent.click(screen.getByTestId('family-export-button'));
    fireEvent.click(screen.getByTestId('family-export-go'));
    await waitFor(() => expect(stepExporter).toHaveBeenCalledTimes(2));
    const calledIds = stepExporter.mock.calls.map(c => c[0]);
    expect(calledIds).toContain('cfg-0');
    expect(calledIds).toContain('cfg-1');
  });

  it('preserves the original active config after export', async () => {
    const { table, features } = makeTable(3);
    table.activate('cfg-1');
    render(<FamilyExportButton table={table} features={features} lang="en" />);
    fireEvent.click(screen.getByTestId('family-export-button'));
    fireEvent.click(screen.getByTestId('family-export-go'));
    await waitFor(() =>
      expect(screen.getByTestId('family-export-deferred-notice')).toBeInTheDocument(),
    );
    expect(table.getActiveId()).toBe('cfg-1');
  });
});
