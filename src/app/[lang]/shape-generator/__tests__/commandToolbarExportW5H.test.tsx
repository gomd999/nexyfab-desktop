// @vitest-environment jsdom
/**
 * CommandToolbar — W5-H 익스포트 메뉴 배선 테스트.
 *
 * File 드롭다운에 SAT/IGES/IFC 버튼 3종이 존재하고, 클릭이 onExportSAT/
 * onExportIGES/onExportIFC props 로 전달되며(ShapeGeneratorInner 에서
 * handleExportSAT → runBrepExport → io/exporters 로 이어지는 체인의 UI 끝단),
 * lockedFormats 에 든 포맷은 🔒 PRO 배지를 단다.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CommandToolbar from '../CommandToolbar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/shape-generator',
}));
vi.mock('@/lib/platform', () => ({
  getRecentImportFiles: () => [],
}));

function renderToolbar(over: Partial<React.ComponentProps<typeof CommandToolbar>> = {}) {
  const spies = {
    onExportSAT: vi.fn(),
    onExportIGES: vi.fn(),
    onExportIFC: vi.fn(),
  };
  const utils = render(
    <CommandToolbar
      activeTab="design"
      isSketchMode={false}
      editMode={'none' as React.ComponentProps<typeof CommandToolbar>['editMode']}
      hasResult={true}
      onSketchMode={() => {}}
      onEditMode={() => {}}
      onAddFeature={() => {}}
      onSendToOptimizer={() => {}}
      onExportSTL={() => {}}
      onToggleChat={() => {}}
      onUndo={() => {}}
      showChat={false}
      isOptimizing={false}
      onGenerate={() => {}}
      canGenerate={false}
      resultMesh={true}
      t={{}}
      lang="en"
      {...spies}
      {...over}
    />,
  );
  return { ...utils, spies };
}

function openFileMenu(getByText: (t: RegExp | string) => HTMLElement) {
  fireEvent.click(getByText(/📁/));
}

describe('CommandToolbar W5-H export menu', () => {
  it('renders the three W5-H export buttons in the File menu', () => {
    const { getByText, getByTestId } = renderToolbar();
    openFileMenu(getByText);
    expect(getByTestId('export-sat').textContent).toContain('Export SAT');
    expect(getByTestId('export-iges').textContent).toContain('Export IGES');
    expect(getByTestId('export-ifc').textContent).toContain('Export IFC');
  });

  it('clicking each button fires its export prop exactly once', () => {
    const { getByText, getByTestId, spies } = renderToolbar();
    openFileMenu(getByText);
    fireEvent.click(getByTestId('export-sat'));
    // 메뉴는 클릭 시 닫힌다(closeSub) — 각 클릭마다 다시 연다.
    openFileMenu(getByText);
    fireEvent.click(getByTestId('export-iges'));
    openFileMenu(getByText);
    fireEvent.click(getByTestId('export-ifc'));
    expect(spies.onExportSAT).toHaveBeenCalledTimes(1);
    expect(spies.onExportIGES).toHaveBeenCalledTimes(1);
    expect(spies.onExportIFC).toHaveBeenCalledTimes(1);
  });

  it('locked formats show the 🔒 PRO badge (freemium gate surface)', () => {
    const { getByText, getByTestId } = renderToolbar({
      lockedFormats: ['sat', 'iges', 'ifc'],
    });
    openFileMenu(getByText);
    for (const id of ['export-sat', 'export-iges', 'export-ifc']) {
      expect(getByTestId(id).textContent).toContain('🔒 PRO');
    }
  });

  it('unlocked plan → no PRO badge on the three buttons', () => {
    const { getByText, getByTestId } = renderToolbar({ lockedFormats: [] });
    openFileMenu(getByText);
    for (const id of ['export-sat', 'export-iges', 'export-ifc']) {
      expect(getByTestId(id).textContent).not.toContain('🔒 PRO');
    }
  });

  it('no result → buttons disabled (cannot fire the export chain)', () => {
    const { getByText, getByTestId, spies } = renderToolbar({ hasResult: false });
    openFileMenu(getByText);
    const b = getByTestId('export-sat') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(spies.onExportSAT).not.toHaveBeenCalled();
  });
});
