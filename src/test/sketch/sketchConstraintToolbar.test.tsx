/** @vitest-environment jsdom */
/**
 * SketchConstraintToolbar — Phase 1.A sketch UX standalone tests.
 *
 * Covers all 11 constraint kinds:
 *   coincident, parallel, perpendicular, tangent, equal_length, equal_radius,
 *   fix, horizontal, vertical, distance, angle.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SketchConstraintToolbar, {
  type SketchEntityRef,
  type Constraint,
  type EditorLang,
} from '@/app/[lang]/shape-generator/sketch/SketchConstraintToolbar';

// ─── helpers ─────────────────────────────────────────────────────────────

const point = (id: string): SketchEntityRef => ({ kind: 'point', id });
const line = (id: string): SketchEntityRef => ({ kind: 'line', id });
const circle = (id: string): SketchEntityRef => ({ kind: 'circle', id });
const arc = (id: string): SketchEntityRef => ({ kind: 'arc', id });

interface MountOpts {
  selection?: ReadonlyArray<SketchEntityRef>;
  lang?: EditorLang;
  onAdd?: (c: Constraint) => void;
  onClear?: () => void;
  disabled?: boolean;
  hideClear?: boolean;
}

function mount({
  selection = [],
  lang = 'en',
  onAdd = vi.fn(),
  onClear,
  disabled = false,
  hideClear = false,
}: MountOpts = {}): { onAdd: (c: Constraint) => void; onClear?: () => void } {
  const clearProp = hideClear ? undefined : (onClear ?? vi.fn());
  render(
    <SketchConstraintToolbar
      lang={lang}
      selection={selection}
      onAdd={onAdd}
      onClear={clearProp}
      disabled={disabled}
    />,
  );
  return { onAdd, onClear: clearProp };
}

const ALL_KINDS = [
  'coincident', 'parallel', 'perpendicular', 'tangent',
  'equal_length', 'equal_radius', 'fix',
  'horizontal', 'vertical', 'distance', 'angle',
] as const;

function btn(kind: typeof ALL_KINDS[number]): HTMLButtonElement {
  return screen.getByTestId(`solver-constraint-${kind}-button`) as HTMLButtonElement;
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('SketchConstraintToolbar', () => {
  it('renders all 11 constraint buttons', () => {
    mount();
    for (const k of ALL_KINDS) {
      expect(screen.getByTestId(`solver-constraint-${k}-button`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('solver-constraint-toolbar')).toBeInTheDocument();
  });

  it('coincident: enabled with 2 points', () => {
    mount({ selection: [point('p1'), point('p2')] });
    expect(btn('coincident').disabled).toBe(false);
  });

  it('coincident: disabled with 1 point', () => {
    mount({ selection: [point('p1')] });
    expect(btn('coincident').disabled).toBe(true);
  });

  it('coincident: disabled with 1 point + 1 line (mixed)', () => {
    mount({ selection: [point('p1'), line('l1')] });
    expect(btn('coincident').disabled).toBe(true);
  });

  it('parallel: enabled with 2 lines', () => {
    mount({ selection: [line('l1'), line('l2')] });
    expect(btn('parallel').disabled).toBe(false);
  });

  it('parallel: disabled with 1 line + 1 point', () => {
    mount({ selection: [line('l1'), point('p1')] });
    expect(btn('parallel').disabled).toBe(true);
  });

  it('perpendicular: enabled with 2 lines', () => {
    mount({ selection: [line('l1'), line('l2')] });
    expect(btn('perpendicular').disabled).toBe(false);
  });

  it('tangent: enabled with line + circle', () => {
    mount({ selection: [line('l1'), circle('c1')] });
    expect(btn('tangent').disabled).toBe(false);
  });

  it('tangent: enabled with 2 circles', () => {
    mount({ selection: [circle('c1'), circle('c2')] });
    expect(btn('tangent').disabled).toBe(false);
  });

  it('tangent: enabled with line + arc', () => {
    mount({ selection: [line('l1'), arc('a1')] });
    expect(btn('tangent').disabled).toBe(false);
  });

  it('equal_length: enabled with 2 lines', () => {
    mount({ selection: [line('l1'), line('l2')] });
    expect(btn('equal_length').disabled).toBe(false);
  });

  it('equal_radius: enabled with 2 circles, 2 arcs, or 1 circle + 1 arc', () => {
    // 2 circles
    const { unmount } = render(
      <SketchConstraintToolbar
        lang="en"
        selection={[circle('c1'), circle('c2')]}
        onAdd={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('solver-constraint-equal_radius-button') as HTMLButtonElement).disabled,
    ).toBe(false);
    unmount();

    // 2 arcs
    const r2 = render(
      <SketchConstraintToolbar
        lang="en"
        selection={[arc('a1'), arc('a2')]}
        onAdd={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('solver-constraint-equal_radius-button') as HTMLButtonElement).disabled,
    ).toBe(false);
    r2.unmount();

    // 1 circle + 1 arc
    render(
      <SketchConstraintToolbar
        lang="en"
        selection={[circle('c1'), arc('a1')]}
        onAdd={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('solver-constraint-equal_radius-button') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('fix: enabled with any 1+ entity', () => {
    const r1 = render(
      <SketchConstraintToolbar lang="en" selection={[point('p1')]} onAdd={vi.fn()} />,
    );
    expect((screen.getByTestId('solver-constraint-fix-button') as HTMLButtonElement).disabled).toBe(false);
    r1.unmount();

    const r2 = render(
      <SketchConstraintToolbar lang="en" selection={[line('l1')]} onAdd={vi.fn()} />,
    );
    expect((screen.getByTestId('solver-constraint-fix-button') as HTMLButtonElement).disabled).toBe(false);
    r2.unmount();

    render(<SketchConstraintToolbar lang="en" selection={[]} onAdd={vi.fn()} />);
    expect((screen.getByTestId('solver-constraint-fix-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('horizontal: enabled with 1+ lines, disabled with 0 lines', () => {
    const r = render(
      <SketchConstraintToolbar lang="en" selection={[line('l1')]} onAdd={vi.fn()} />,
    );
    expect((screen.getByTestId('solver-constraint-horizontal-button') as HTMLButtonElement).disabled).toBe(false);
    r.unmount();

    render(<SketchConstraintToolbar lang="en" selection={[point('p1')]} onAdd={vi.fn()} />);
    expect((screen.getByTestId('solver-constraint-horizontal-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('vertical: enabled with 1+ lines, disabled with 0 lines', () => {
    const r = render(
      <SketchConstraintToolbar lang="en" selection={[line('l1'), line('l2')]} onAdd={vi.fn()} />,
    );
    expect((screen.getByTestId('solver-constraint-vertical-button') as HTMLButtonElement).disabled).toBe(false);
    r.unmount();

    render(<SketchConstraintToolbar lang="en" selection={[]} onAdd={vi.fn()} />);
    expect((screen.getByTestId('solver-constraint-vertical-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('distance: opens input on click and submit fires onAdd with value', () => {
    const onAdd = vi.fn();
    mount({ selection: [point('p1'), point('p2')], onAdd });
    fireEvent.click(btn('distance'));
    const input = screen.getByTestId('solver-constraint-distance-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '25.5' } });
    fireEvent.click(screen.getByTestId('solver-constraint-distance-submit'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const c = onAdd.mock.calls[0]![0] as Constraint;
    expect(c.kind).toBe('distance');
    expect((c as { value: number }).value).toBe(25.5);
    expect(c.entities).toEqual([point('p1'), point('p2')]);
  });

  it('angle: opens input on click and submit fires onAdd with value', () => {
    const onAdd = vi.fn();
    mount({ selection: [line('l1'), line('l2')], onAdd });
    fireEvent.click(btn('angle'));
    const input = screen.getByTestId('solver-constraint-angle-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('solver-constraint-angle-submit'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const c = onAdd.mock.calls[0]![0] as Constraint;
    expect(c.kind).toBe('angle');
    expect((c as { value: number }).value).toBe(45);
    expect(c.entities).toEqual([line('l1'), line('l2')]);
  });

  it('disabled=true disables all buttons', () => {
    mount({
      selection: [line('l1'), line('l2'), point('p1'), point('p2'), circle('c1'), arc('a1')],
      disabled: true,
    });
    for (const k of ALL_KINDS) {
      expect(btn(k).disabled).toBe(true);
    }
  });

  it('clear button calls onClear when present', () => {
    const onClear = vi.fn();
    mount({ onClear });
    const clearBtn = screen.getByTestId('solver-constraint-clear-button');
    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('clear button hidden when onClear absent', () => {
    mount({ hideClear: true });
    expect(screen.queryByTestId('solver-constraint-clear-button')).toBeNull();
  });

  it('onAdd called with constraint of correct kind for parallel', () => {
    const onAdd = vi.fn();
    mount({ selection: [line('l1'), line('l2')], onAdd });
    fireEvent.click(btn('parallel'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const c = onAdd.mock.calls[0]![0] as Constraint;
    expect(c.kind).toBe('parallel');
    expect(c.entities).toEqual([line('l1'), line('l2')]);
  });

  it('i18n: renders Korean label for coincident', () => {
    mount({ lang: 'ko' });
    expect(btn('coincident').textContent).toContain('일치');
  });

  it('i18n: renders English label for coincident', () => {
    mount({ lang: 'en' });
    expect(btn('coincident').textContent).toContain('Coincident');
  });

  it('i18n: renders Japanese label for coincident', () => {
    mount({ lang: 'ja' });
    expect(btn('coincident').textContent).toContain('一致');
  });

  it('i18n: renders Chinese label for coincident', () => {
    mount({ lang: 'zh' });
    expect(btn('coincident').textContent).toContain('重合');
  });

  it('i18n: renders Spanish label for coincident', () => {
    mount({ lang: 'es' });
    expect(btn('coincident').textContent).toContain('Coincidente');
  });

  it('i18n: renders Arabic label for coincident', () => {
    mount({ lang: 'ar' });
    expect(btn('coincident').textContent).toContain('متطابق');
  });
});
