/** @vitest-environment jsdom */
/**
 * MateConstraintsToolbar — Phase 3.A assembly UX standalone tests.
 *
 * Covers all 12 mate button kinds, enable rules, cross-part requirement,
 * 4 numeric popovers (distance / angle / gear / rack_pinion), clear button,
 * disabled flag, and 6-lang i18n.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import MateConstraintsToolbar, {
  type ToolbarSelectionRef,
  type EditorLang,
  type MateButtonKind,
} from '@/app/[lang]/shape-generator/assembly/MateConstraintsToolbar';
import type { Mate } from '@/lib/assembly/mate';
import { validateMate } from '@/lib/assembly/mate';

// ─── helpers ─────────────────────────────────────────────────────────────

const ref = (
  partId: string,
  refId: string,
  refKind: ToolbarSelectionRef['refKind'],
): ToolbarSelectionRef => ({ partId, refId, refKind });

const axis = (part: string, id: string) => ref(part, id, 'axis');
const plane = (part: string, id: string) => ref(part, id, 'plane');
const point = (part: string, id: string) => ref(part, id, 'point');
const edge = (part: string, id: string) => ref(part, id, 'edge');

interface MountOpts {
  selection?: ReadonlyArray<ToolbarSelectionRef>;
  lang?: EditorLang;
  onAdd?: (m: Mate) => void;
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
}: MountOpts = {}): { onAdd: (m: Mate) => void; onClear?: () => void } {
  const clearProp = hideClear ? undefined : (onClear ?? vi.fn());
  render(
    <MateConstraintsToolbar
      lang={lang}
      selection={selection}
      onAdd={onAdd}
      onClear={clearProp}
      disabled={disabled}
    />,
  );
  return { onAdd, onClear: clearProp };
}

const ALL_KINDS: MateButtonKind[] = [
  'concentric',
  'coincident_point',
  'coincident_plane',
  'parallel',
  'perpendicular',
  'distance',
  'angle',
  'tangent',
  'hinge',
  'slot',
  'gear',
  'rack_pinion',
];

function btn(kind: MateButtonKind): HTMLButtonElement {
  return screen.getByTestId(`solver-mate-${kind}-button`) as HTMLButtonElement;
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('MateConstraintsToolbar', () => {
  it('renders all 12 mate kind buttons + toolbar root', () => {
    mount();
    for (const k of ALL_KINDS) {
      expect(screen.getByTestId(`solver-mate-${k}-button`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('solver-mate-toolbar')).toBeInTheDocument();
  });

  it('concentric: enabled with 2 axes from different parts, click → onAdd(concentric)', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    mount({ selection: [axis('partA', 'ax1'), axis('partB', 'ax2')], onAdd });
    const b = btn('concentric');
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const m = onAdd.mock.calls[0]![0];
    expect(m.kind).toBe('concentric');
    expect(m.a).toEqual({ partId: 'partA', refId: 'ax1', refKind: 'axis' });
    expect(m.b).toEqual({ partId: 'partB', refId: 'ax2', refKind: 'axis' });
    // sanity: emitted mate must pass validateMate
    expect(() => validateMate(m)).not.toThrow();
  });

  it('concentric: disabled when both axes belong to the same part', () => {
    mount({ selection: [axis('partA', 'ax1'), axis('partA', 'ax2')] });
    expect(btn('concentric').disabled).toBe(true);
  });

  it('coincident_point: enabled with 2 points (different parts), emits coincident mate', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    mount({ selection: [point('partA', 'p1'), point('partB', 'p2')], onAdd });
    const b = btn('coincident_point');
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]![0].kind).toBe('coincident');
    expect(() => validateMate(onAdd.mock.calls[0]![0])).not.toThrow();
  });

  it('coincident_plane: enabled with 2 planes (different parts), emits coincident mate', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    mount({ selection: [plane('partA', 'pl1'), plane('partB', 'pl2')], onAdd });
    fireEvent.click(btn('coincident_plane'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]![0].kind).toBe('coincident');
    expect(() => validateMate(onAdd.mock.calls[0]![0])).not.toThrow();
  });

  it('parallel: enabled with 2 axes', () => {
    mount({ selection: [axis('A', 'a1'), axis('B', 'a2')] });
    expect(btn('parallel').disabled).toBe(false);
  });

  it('parallel: enabled with 2 planes', () => {
    mount({ selection: [plane('A', 'pl1'), plane('B', 'pl2')] });
    expect(btn('parallel').disabled).toBe(false);
  });

  it('parallel: disabled with mixed axis + plane', () => {
    mount({ selection: [axis('A', 'a1'), plane('B', 'pl1')] });
    expect(btn('parallel').disabled).toBe(true);
  });

  it('perpendicular: enabled with 2 axes OR 2 planes; disabled mixed', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    const r1 = render(
      <MateConstraintsToolbar
        lang="en"
        selection={[axis('A', 'a1'), axis('B', 'a2')]}
        onAdd={onAdd}
      />,
    );
    expect(
      (screen.getByTestId('solver-mate-perpendicular-button') as HTMLButtonElement).disabled,
    ).toBe(false);
    r1.unmount();

    const r2 = render(
      <MateConstraintsToolbar
        lang="en"
        selection={[plane('A', 'pl1'), plane('B', 'pl2')]}
        onAdd={onAdd}
      />,
    );
    expect(
      (screen.getByTestId('solver-mate-perpendicular-button') as HTMLButtonElement).disabled,
    ).toBe(false);
    r2.unmount();

    render(
      <MateConstraintsToolbar
        lang="en"
        selection={[axis('A', 'a1'), plane('B', 'pl1')]}
        onAdd={onAdd}
      />,
    );
    expect(
      (screen.getByTestId('solver-mate-perpendicular-button') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('distance: 2 points enables button; popover input + submit fires onAdd(distance, value)', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    mount({ selection: [point('A', 'p1'), point('B', 'p2')], onAdd });
    const b = btn('distance');
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    const input = screen.getByTestId('solver-mate-distance-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '25.5' } });
    fireEvent.click(screen.getByTestId('solver-mate-distance-submit'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const m = onAdd.mock.calls[0]![0] as Mate & { value: number };
    expect(m.kind).toBe('distance');
    expect(m.value).toBe(25.5);
    expect(() => validateMate(m)).not.toThrow();
  });

  it('distance: also enabled with 2 planes', () => {
    mount({ selection: [plane('A', 'pl1'), plane('B', 'pl2')] });
    expect(btn('distance').disabled).toBe(false);
  });

  it('angle: 2 axes enables button; popover submit fires onAdd(angle, value)', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    mount({ selection: [axis('A', 'a1'), axis('B', 'a2')], onAdd });
    fireEvent.click(btn('angle'));
    const input = screen.getByTestId('solver-mate-angle-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('solver-mate-angle-submit'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const m = onAdd.mock.calls[0]![0] as Mate & { value: number };
    expect(m.kind).toBe('angle');
    expect(m.value).toBe(45);
    expect(() => validateMate(m)).not.toThrow();
  });

  it('tangent: enabled with edge + axis OR 2 edges', () => {
    const r1 = render(
      <MateConstraintsToolbar
        lang="en"
        selection={[edge('A', 'e1'), axis('B', 'a1')]}
        onAdd={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('solver-mate-tangent-button') as HTMLButtonElement).disabled,
    ).toBe(false);
    r1.unmount();

    render(
      <MateConstraintsToolbar
        lang="en"
        selection={[edge('A', 'e1'), edge('B', 'e2')]}
        onAdd={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('solver-mate-tangent-button') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('hinge: 2 axes enables; click → onAdd(hinge)', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    mount({ selection: [axis('A', 'a1'), axis('B', 'a2')], onAdd });
    const b = btn('hinge');
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]![0].kind).toBe('hinge');
    expect(() => validateMate(onAdd.mock.calls[0]![0])).not.toThrow();
  });

  it('slot: edge + axis enables; emitted IR has a=edge, b=axis regardless of click order', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    // user clicked axis FIRST, then edge — slot IR must still serialize as (edge, axis).
    mount({ selection: [axis('B', 'a1'), edge('A', 'e1')], onAdd });
    const b = btn('slot');
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const m = onAdd.mock.calls[0]![0];
    expect(m.kind).toBe('slot');
    expect(m.a.refKind).toBe('edge');
    expect(m.b.refKind).toBe('axis');
    expect(() => validateMate(m)).not.toThrow();
  });

  it('gear: 2 axes; popover ratio input → onAdd(gear, ratio)', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    mount({ selection: [axis('A', 'a1'), axis('B', 'a2')], onAdd });
    fireEvent.click(btn('gear'));
    const input = screen.getByTestId('solver-mate-gear-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.click(screen.getByTestId('solver-mate-gear-submit'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const m = onAdd.mock.calls[0]![0] as Mate & { ratio: number };
    expect(m.kind).toBe('gear');
    expect(m.ratio).toBe(2.5);
    expect(() => validateMate(m)).not.toThrow();
  });

  it('rack_pinion: axis + edge; popover pinionRadius input → onAdd(rack_pinion, radius); IR a=axis, b=edge', () => {
    const onAdd = vi.fn<(m: Mate) => void>();
    // click order: edge first, then axis — IR must still serialize a=axis, b=edge.
    mount({ selection: [edge('B', 'e1'), axis('A', 'a1')], onAdd });
    const b = btn('rack_pinion');
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    const input = screen.getByTestId('solver-mate-rack_pinion-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('solver-mate-rack_pinion-submit'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const m = onAdd.mock.calls[0]![0] as Mate & { pinionRadius: number };
    expect(m.kind).toBe('rack_pinion');
    expect(m.pinionRadius).toBe(12);
    expect(m.a.refKind).toBe('axis');
    expect(m.b.refKind).toBe('edge');
    expect(() => validateMate(m)).not.toThrow();
  });

  it('empty selection: all buttons disabled', () => {
    mount();
    for (const k of ALL_KINDS) {
      expect(btn(k).disabled).toBe(true);
    }
  });

  it('single-ref selection: all buttons disabled', () => {
    mount({ selection: [axis('A', 'a1')] });
    for (const k of ALL_KINDS) {
      expect(btn(k).disabled).toBe(true);
    }
  });

  it('same-part 2-ref selection: all buttons disabled (cross-part rule)', () => {
    mount({ selection: [axis('A', 'a1'), axis('A', 'a2')] });
    for (const k of ALL_KINDS) {
      expect(btn(k).disabled).toBe(true);
    }
  });

  it('disabled=true: all buttons + clear disabled even with a valid pair', () => {
    mount({
      selection: [axis('A', 'a1'), axis('B', 'a2')],
      disabled: true,
    });
    for (const k of ALL_KINDS) {
      expect(btn(k).disabled).toBe(true);
    }
    const clear = screen.getByTestId('solver-mate-clear-button') as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });

  it('clear button calls onClear when present', () => {
    const onClear = vi.fn();
    mount({ onClear });
    fireEvent.click(screen.getByTestId('solver-mate-clear-button'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('clear button hidden when onClear absent', () => {
    mount({ hideClear: true });
    expect(screen.queryByTestId('solver-mate-clear-button')).toBeNull();
  });

  it('i18n ko: concentric label = 동심', () => {
    mount({ lang: 'ko' });
    expect(btn('concentric').textContent).toContain('동심');
  });

  it('i18n en: concentric label = Concentric', () => {
    mount({ lang: 'en' });
    expect(btn('concentric').textContent).toContain('Concentric');
  });

  it('i18n ja: concentric label = 同心', () => {
    mount({ lang: 'ja' });
    expect(btn('concentric').textContent).toContain('同心');
  });

  it('i18n zh: concentric label = 同心', () => {
    mount({ lang: 'zh' });
    expect(btn('concentric').textContent).toContain('同心');
  });

  it('i18n es: concentric label = Concéntrico', () => {
    mount({ lang: 'es' });
    expect(btn('concentric').textContent).toContain('Concéntrico');
  });

  it('i18n ar: concentric label = متمركز', () => {
    cleanup();
    mount({ lang: 'ar' });
    expect(btn('concentric').textContent).toContain('متمركز');
  });
});
