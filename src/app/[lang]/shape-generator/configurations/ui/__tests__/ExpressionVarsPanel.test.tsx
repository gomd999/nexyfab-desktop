// @vitest-environment jsdom
/**
 * ExpressionVarsPanel.test.tsx — A4 expression-vars side panel.
 *
 * Covers:
 *   - render collapsed by default
 *   - expand via toggle
 *   - render globalVars section when none + when populated
 *   - render expressionVars section only when active config exists
 *   - add global var
 *   - edit global var value (numeric vs string)
 *   - add expression var (with active config)
 *   - edit expression var value
 *   - i18n — Korean labels visible
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExpressionVarsPanel from '../ExpressionVarsPanel';
import { ConfigurationTable } from '../../ConfigurationTable';

function makeTable(): ConfigurationTable {
  const t = new ConfigurationTable();
  t.add('A', { id: 'cfg-a' });
  return t;
}

describe('ExpressionVarsPanel — render', () => {
  it('renders collapsed by default with toggle label', () => {
    const table = makeTable();
    render(<ExpressionVarsPanel table={table} activeConfigId="cfg-a" lang="en" />);
    expect(screen.getByTestId('expression-vars-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('global-vars-section')).not.toBeInTheDocument();
  });

  it('expands when toggle clicked', () => {
    const table = makeTable();
    render(<ExpressionVarsPanel table={table} activeConfigId="cfg-a" lang="en" />);
    fireEvent.click(screen.getByTestId('expression-vars-toggle'));
    expect(screen.getByTestId('global-vars-section')).toBeInTheDocument();
  });

  it('renders expr-vars section only when activeConfigId is set', () => {
    const table = makeTable();
    render(<ExpressionVarsPanel table={table} activeConfigId={null} lang="en" defaultOpen />);
    expect(screen.queryByTestId('expr-vars-section')).not.toBeInTheDocument();
    expect(screen.getByTestId('global-vars-section')).toBeInTheDocument();
  });

  it('renders expr-vars section when active config is set', () => {
    const table = makeTable();
    render(<ExpressionVarsPanel table={table} activeConfigId="cfg-a" lang="en" defaultOpen />);
    expect(screen.getByTestId('expr-vars-section')).toBeInTheDocument();
  });

  it('renders Korean labels when lang="ko"', () => {
    const table = makeTable();
    render(<ExpressionVarsPanel table={table} activeConfigId="cfg-a" lang="ko" defaultOpen />);
    // "전역 변수" appears in both the toggle and the section header.
    expect(screen.getAllByText(/전역 변수/).length).toBeGreaterThan(0);
  });
});

describe('ExpressionVarsPanel — global vars CRUD', () => {
  it('add global var creates a row', () => {
    const table = makeTable();
    const onMutate = vi.fn();
    render(
      <ExpressionVarsPanel
        table={table}
        activeConfigId="cfg-a"
        lang="en"
        defaultOpen
        onMutate={onMutate}
      />,
    );
    fireEvent.click(screen.getByTestId('global-vars-add'));
    expect(table.getGlobalVars().var_0).toBe(0);
    expect(onMutate).toHaveBeenCalled();
  });

  it('edit global var value (numeric)', () => {
    const table = makeTable();
    table.setGlobalVar('thickness', 5);
    render(<ExpressionVarsPanel table={table} activeConfigId="cfg-a" lang="en" defaultOpen />);
    const input = screen.getByTestId('global-var-value-thickness') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '8.5' } });
    fireEvent.blur(input);
    expect(table.getGlobalVars().thickness).toBe(8.5);
  });

  it('edit global var value (expression string)', () => {
    const table = makeTable();
    table.setGlobalVar('d', 5);
    render(<ExpressionVarsPanel table={table} activeConfigId="cfg-a" lang="en" defaultOpen />);
    const input = screen.getByTestId('global-var-value-d') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'h * 2' } });
    fireEvent.blur(input);
    expect(table.getGlobalVars().d).toBe('h * 2');
  });
});

describe('ExpressionVarsPanel — expression vars CRUD', () => {
  it('add expression var creates a row tied to active config', () => {
    const table = makeTable();
    render(<ExpressionVarsPanel table={table} activeConfigId="cfg-a" lang="en" defaultOpen />);
    fireEvent.click(screen.getByTestId('expr-vars-add'));
    expect(table.get('cfg-a')?.expressionVars.var_0).toBe(0);
  });

  it('edit expression var value', () => {
    const table = makeTable();
    table.setExpressionVar('cfg-a', 'bolt_d', 4);
    render(<ExpressionVarsPanel table={table} activeConfigId="cfg-a" lang="en" defaultOpen />);
    const input = screen.getByTestId('expr-var-value-bolt_d') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.blur(input);
    expect(table.get('cfg-a')?.expressionVars.bolt_d).toBe(6);
  });

  it('add expression var noop when no active config', () => {
    const table = new ConfigurationTable();
    render(<ExpressionVarsPanel table={table} activeConfigId={null} lang="en" defaultOpen />);
    // No expr-vars-add testid present when active config is null.
    expect(screen.queryByTestId('expr-vars-add')).not.toBeInTheDocument();
  });
});
