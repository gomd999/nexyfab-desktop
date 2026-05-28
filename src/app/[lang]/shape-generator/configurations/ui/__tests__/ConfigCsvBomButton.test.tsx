// @vitest-environment jsdom
/**
 * ConfigCsvBomButton.test.tsx — A4 CSV BOM export button.
 *
 * Coverage focuses on the pure `buildConfigBomCsv` helper (deterministic
 * golden) + a render smoke test for the click handler.
 *
 * Cases:
 *   - header row matches the configs + features
 *   - one row per config
 *   - parentId column round-trips
 *   - quantity column = 1 for live features, 0 for suppressed
 *   - inheritance reflected (child of suppressing parent inherits 0)
 *   - render + click smoke (no throw)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfigCsvBomButton, { buildConfigBomCsv } from '../ConfigCsvBomButton';
import { ConfigurationTable } from '../../ConfigurationTable';
import type { FeatureInstance } from '../../../features/types';

function feat(id: string, type: FeatureInstance['type'] = 'fillet'): FeatureInstance {
  return { id, type, params: { r: 1 }, enabled: true };
}

describe('buildConfigBomCsv — pure helper', () => {
  it('header lists configId, configName, parentId + all features', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'cfg-a' });
    const features = [feat('f1'), feat('f2')];
    const csv = buildConfigBomCsv(t, t.list(), features);
    const [header] = csv.split('\n');
    expect(header).toBe('configId,configName,parentId,fillet#f1,fillet#f2');
  });

  it('one data row per config', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'cfg-a' });
    t.add('B', { id: 'cfg-b' });
    const features = [feat('f1')];
    const csv = buildConfigBomCsv(t, t.list(), features);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 configs
  });

  it('writes 1 for live features, 0 for suppressed', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'cfg-a' });
    t.setSuppressed('cfg-a', 'f1', true);
    const features = [feat('f1'), feat('f2')];
    const csv = buildConfigBomCsv(t, t.list(), features);
    const dataRow = csv.split('\n')[1]!;
    expect(dataRow).toBe('cfg-a,A,,0,1');
  });

  it('reflects parentId column', () => {
    const t = new ConfigurationTable();
    t.add('Parent', { id: 'p' });
    t.add('Child', { id: 'c' });
    t.setParent('c', 'p');
    const features = [feat('f1')];
    const csv = buildConfigBomCsv(t, t.list(), features);
    const rows = csv.split('\n');
    expect(rows[2]).toBe('c,Child,p,1');
  });

  it('inheritance: child inherits parent suppression when no override', () => {
    const t = new ConfigurationTable();
    t.add('Parent', { id: 'p' });
    t.add('Child', { id: 'c' });
    t.setParent('c', 'p');
    t.setSuppressed('p', 'f1', true);
    const features = [feat('f1')];
    const csv = buildConfigBomCsv(t, t.list(), features);
    const rows = csv.split('\n');
    expect(rows[1]).toBe('p,Parent,,0');
    expect(rows[2]).toBe('c,Child,p,0');
  });

  it('CSV-escapes commas and quotes in names', () => {
    const t = new ConfigurationTable();
    t.add('A, B "the great"', { id: 'cfg-a' });
    const features = [feat('f1')];
    const csv = buildConfigBomCsv(t, t.list(), features);
    expect(csv).toContain('"A, B ""the great"""');
  });
});

describe('ConfigCsvBomButton — render', () => {
  it('renders the button with EN label', () => {
    const t = new ConfigurationTable();
    render(<ConfigCsvBomButton table={t} features={[]} lang="en" />);
    expect(screen.getByTestId('config-csv-bom-button')).toBeInTheDocument();
  });

  it('click handler runs without throwing in jsdom', () => {
    if (typeof URL.createObjectURL === 'undefined') {
      Object.defineProperty(URL, 'createObjectURL', {
        value: vi.fn(() => 'blob:test'),
        configurable: true,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: vi.fn(),
        configurable: true,
      });
    }
    const t = new ConfigurationTable();
    t.add('A', { id: 'cfg-a' });
    render(<ConfigCsvBomButton table={t} features={[feat('f1')]} lang="en" />);
    expect(() => fireEvent.click(screen.getByTestId('config-csv-bom-button'))).not.toThrow();
  });
});
