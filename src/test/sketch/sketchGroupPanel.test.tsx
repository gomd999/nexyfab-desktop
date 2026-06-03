/** @vitest-environment jsdom */
/**
 * SketchGroupPanel — standalone Phase 2.x sketchGroup UI tests.
 *
 * Covers: empty state, group-selected button enable/disable, create
 * callback, lock toggle, translate / rotate / scale apply with parsed
 * inputs (rotate converts ° → rad), delete + window.confirm guard,
 * locked-row input disabling, and 6-lang i18n.
 *
 * The panel is standalone — no planegcs / SketchSolver. Tests mount in
 * jsdom and assert against the callback spies + DOM state.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import SketchGroupPanel, {
  type SketchGroupPanelProps,
  type SketchSelectionRef,
  type EditorLang,
} from '@/app/[lang]/shape-generator/sketch/SketchGroupPanel';
import type { SketchGroup } from '@/lib/sketch/sketchGroup';

// ─── helpers ────────────────────────────────────────────────────────────

function makeGroup(overrides: Partial<SketchGroup> = {}): SketchGroup {
  return {
    id: 'g1',
    name: 'Triangle',
    entityIds: ['p1', 'p2', 'p3'],
    anchor: { x: 0, y: 0 },
    locked: false,
    ...overrides,
  };
}

function refPoint(id: string): SketchSelectionRef {
  return { kind: 'point', id };
}

interface MountOpts extends Partial<SketchGroupPanelProps> {
  lang?: EditorLang;
}

function mount(opts: MountOpts = {}) {
  const onCreate = vi.fn(opts.onCreate);
  const onRemove = vi.fn(opts.onRemove);
  const onTranslate = vi.fn(opts.onTranslate);
  const onRotate = vi.fn(opts.onRotate);
  const onScale = vi.fn(opts.onScale);
  const onToggleLock = vi.fn(opts.onToggleLock);
  const utils = render(
    <SketchGroupPanel
      lang={opts.lang ?? 'en'}
      groups={opts.groups ?? []}
      selection={opts.selection ?? []}
      onCreate={onCreate}
      onRemove={onRemove}
      onTranslate={onTranslate}
      onRotate={onRotate}
      onScale={onScale}
      onToggleLock={onToggleLock}
    />,
  );
  return { onCreate, onRemove, onTranslate, onRotate, onScale, onToggleLock, ...utils };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── tests ──────────────────────────────────────────────────────────────

describe('SketchGroupPanel', () => {
  it('renders the panel with the empty hint when there are no groups', () => {
    mount();
    expect(screen.getByTestId('solver-sketch-group-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sketch-group-empty')).toBeInTheDocument();
  });

  it('disables "Group selected" when selection is < 2', () => {
    mount({ selection: [refPoint('p1')] });
    const btn = screen.getByTestId('solver-sketch-group-create') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/\(1\)/);
  });

  it('enables "Group selected" when selection is >= 2', () => {
    mount({ selection: [refPoint('p1'), refPoint('p2')] });
    const btn = screen.getByTestId('solver-sketch-group-create') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toMatch(/\(2\)/);
  });

  it('calls onCreate with default name + ids when "Group selected" is clicked', () => {
    const { onCreate } = mount({
      selection: [refPoint('p1'), refPoint('p2'), refPoint('p3')],
      groups: [],
    });
    fireEvent.click(screen.getByTestId('solver-sketch-group-create'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const [name, ids] = onCreate.mock.calls[0]!;
    expect(name).toBe('Group 1');
    expect(ids).toEqual(['p1', 'p2', 'p3']);
  });

  it('lists each group row with name + count', () => {
    mount({
      groups: [
        makeGroup({ id: 'g1', name: 'Alpha', entityIds: ['p1', 'p2'] }),
        makeGroup({ id: 'g2', name: 'Beta', entityIds: ['p3', 'p4', 'p5'] }),
      ],
    });
    expect(screen.getByTestId('solver-sketch-group-row-g1')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sketch-group-name-g1').textContent).toBe('Alpha');
    expect(screen.getByTestId('solver-sketch-group-count-g1').textContent).toMatch(/2/);
    expect(screen.getByTestId('solver-sketch-group-row-g2')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sketch-group-count-g2').textContent).toMatch(/3/);
  });

  it('clicking lock toggle fires onToggleLock with the group id', () => {
    const { onToggleLock } = mount({ groups: [makeGroup({ id: 'g7' })] });
    fireEvent.click(screen.getByTestId('solver-sketch-group-lock-g7'));
    expect(onToggleLock).toHaveBeenCalledWith('g7');
  });

  it('renders locked badge + disables transform inputs when group.locked', () => {
    mount({ groups: [makeGroup({ id: 'g1', locked: true })] });
    const row = screen.getByTestId('solver-sketch-group-row-g1');
    expect(row.getAttribute('data-group-locked')).toBe('true');
    const dx = screen.getByTestId('solver-sketch-group-translate-dx-g1') as HTMLInputElement;
    const apply = screen.getByTestId('solver-sketch-group-translate-apply-g1') as HTMLButtonElement;
    expect(dx.disabled).toBe(true);
    expect(apply.disabled).toBe(true);
  });

  it('translate apply: parses dx/dy and fires onTranslate', () => {
    const { onTranslate } = mount({ groups: [makeGroup({ id: 'g1' })] });
    const dx = screen.getByTestId('solver-sketch-group-translate-dx-g1') as HTMLInputElement;
    const dy = screen.getByTestId('solver-sketch-group-translate-dy-g1') as HTMLInputElement;
    fireEvent.change(dx, { target: { value: '12' } });
    fireEvent.change(dy, { target: { value: '-3' } });
    fireEvent.click(screen.getByTestId('solver-sketch-group-translate-apply-g1'));
    expect(onTranslate).toHaveBeenCalledWith('g1', 12, -3);
  });

  it('translate apply: ignores NaN inputs (no callback)', () => {
    const { onTranslate } = mount({ groups: [makeGroup({ id: 'g1' })] });
    const dx = screen.getByTestId('solver-sketch-group-translate-dx-g1') as HTMLInputElement;
    fireEvent.change(dx, { target: { value: 'not-a-number' } });
    fireEvent.click(screen.getByTestId('solver-sketch-group-translate-apply-g1'));
    expect(onTranslate).not.toHaveBeenCalled();
  });

  it('rotate apply: converts degrees to radians', () => {
    const { onRotate } = mount({ groups: [makeGroup({ id: 'g1' })] });
    const deg = screen.getByTestId('solver-sketch-group-rotate-deg-g1') as HTMLInputElement;
    fireEvent.change(deg, { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('solver-sketch-group-rotate-apply-g1'));
    expect(onRotate).toHaveBeenCalledTimes(1);
    const [gid, rad] = onRotate.mock.calls[0]!;
    expect(gid).toBe('g1');
    expect(rad).toBeCloseTo(Math.PI / 2, 6);
  });

  it('scale apply: parses factor and fires onScale', () => {
    const { onScale } = mount({ groups: [makeGroup({ id: 'g1' })] });
    const factor = screen.getByTestId('solver-sketch-group-scale-factor-g1') as HTMLInputElement;
    fireEvent.change(factor, { target: { value: '2.5' } });
    fireEvent.click(screen.getByTestId('solver-sketch-group-scale-apply-g1'));
    expect(onScale).toHaveBeenCalledWith('g1', 2.5);
  });

  it('scale apply: refuses factor === 0 (no callback)', () => {
    const { onScale } = mount({ groups: [makeGroup({ id: 'g1' })] });
    const factor = screen.getByTestId('solver-sketch-group-scale-factor-g1') as HTMLInputElement;
    fireEvent.change(factor, { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('solver-sketch-group-scale-apply-g1'));
    expect(onScale).not.toHaveBeenCalled();
  });

  it('delete: calls onRemove when window.confirm returns true', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onRemove } = mount({ groups: [makeGroup({ id: 'g9' })] });
    fireEvent.click(screen.getByTestId('solver-sketch-group-delete-g9'));
    expect(onRemove).toHaveBeenCalledWith('g9');
  });

  it('delete: skips onRemove when window.confirm returns false', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onRemove } = mount({ groups: [makeGroup({ id: 'g9' })] });
    fireEvent.click(screen.getByTestId('solver-sketch-group-delete-g9'));
    expect(onRemove).not.toHaveBeenCalled();
  });

  // ─── i18n: 6 langs render distinct title strings ────────────────────
  it.each<[EditorLang, string]>([
    ['ko', '그룹'],
    ['en', 'Groups'],
    ['ja', 'グループ'],
    ['zh', '组'],
    ['es', 'Grupos'],
    ['ar', 'مجموعات'],
  ])('i18n: renders %s title %s', (lang, expected) => {
    mount({ lang });
    expect(screen.getByTestId('solver-sketch-group-panel').textContent).toContain(expected);
  });
});
