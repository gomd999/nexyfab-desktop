/** @vitest-environment jsdom */
/**
 * SketchViewOptionsPanel — Phase 1.B sketch UX standalone tests.
 *
 * Covers:
 *   - 5 visibility checkboxes render + reflect prop state.
 *   - Each checkbox toggle emits a partial-diff onChange.
 *   - grid spacing numeric input rejects 0 / negative / NaN and emits valid values.
 *   - axis-origin radios (3 options) — single-select + emits onChange.
 *   - Reset button emits the canonical DEFAULT_VIEW_OPTIONS.
 *   - 6-lang label rendering (ko / en / ja / zh / es / ar) + ar RTL dir.
 *   - DEFAULT_VIEW_OPTIONS is the documented default policy.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import SketchViewOptionsPanel, {
  DEFAULT_VIEW_OPTIONS,
  type ViewOptions,
  type ViewOptionsLang,
  type AxisOrigin,
} from '@/app/[lang]/shape-generator/sketch/SketchViewOptionsPanel';

// ─── helpers ─────────────────────────────────────────────────────────────

interface MountOpts {
  lang?: ViewOptionsLang;
  options?: Partial<ViewOptions>;
  onChange?: (opts: Partial<ViewOptions>) => void;
}

function mount(opts: MountOpts = {}) {
  const onChange = opts.onChange ?? vi.fn();
  const options: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, ...opts.options };
  const utils = render(
    <SketchViewOptionsPanel
      lang={opts.lang ?? 'en'}
      options={options}
      onChange={onChange}
    />,
  );
  return { onChange, options, ...utils };
}

afterEach(() => {
  cleanup();
});

// ─── tests ───────────────────────────────────────────────────────────────

describe('SketchViewOptionsPanel', () => {
  it('renders the panel root with the expected testid', () => {
    mount();
    expect(screen.getByTestId('solver-sketch-view-options-panel')).toBeInTheDocument();
  });

  it('renders all 5 visibility checkboxes and they reflect default-ON state', () => {
    mount();
    const ids = [
      'solver-sketch-view-option-showGrid',
      'solver-sketch-view-option-showAxes',
      'solver-sketch-view-option-showDimensions',
      'solver-sketch-view-option-showConstraintGlyphs',
      'solver-sketch-view-option-darkMode',
    ];
    for (const id of ids) {
      const cb = screen.getByTestId(id) as HTMLInputElement;
      expect(cb).toBeInTheDocument();
      expect(cb.type).toBe('checkbox');
      expect(cb.checked).toBe(true);
    }
  });

  it('toggling Grid OFF emits onChange({ showGrid: false })', () => {
    const { onChange } = mount();
    const cb = screen.getByTestId('solver-sketch-view-option-showGrid') as HTMLInputElement;
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ showGrid: false });
  });

  it('toggling Grid ON (from off-state) emits onChange({ showGrid: true })', () => {
    const { onChange } = mount({ options: { showGrid: false } });
    const cb = screen.getByTestId('solver-sketch-view-option-showGrid') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith({ showGrid: true });
  });

  it('each visibility checkbox emits a partial diff keyed by its own field', () => {
    const cases: Array<{ id: string; field: keyof ViewOptions }> = [
      { id: 'solver-sketch-view-option-showAxes', field: 'showAxes' },
      { id: 'solver-sketch-view-option-showDimensions', field: 'showDimensions' },
      { id: 'solver-sketch-view-option-showConstraintGlyphs', field: 'showConstraintGlyphs' },
      { id: 'solver-sketch-view-option-darkMode', field: 'darkMode' },
    ];
    for (const { id, field } of cases) {
      const { onChange, unmount } = mount();
      fireEvent.click(screen.getByTestId(id));
      expect(onChange).toHaveBeenCalledWith({ [field]: false });
      unmount();
    }
  });

  it('grid spacing input shows the current value', () => {
    mount({ options: { gridSpacing: 25 } });
    const input = screen.getByTestId('solver-sketch-view-option-gridSpacing') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('number');
    expect(input.value).toBe('25');
  });

  it('changing grid spacing to a positive value emits onChange({ gridSpacing })', () => {
    // mount with a non-default starting value so React fires the change event
    // when we type the new value (React skips dispatch when value === current).
    const { onChange } = mount({ options: { gridSpacing: 5 } });
    const input = screen.getByTestId('solver-sketch-view-option-gridSpacing') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10' } });
    expect(onChange).toHaveBeenCalledWith({ gridSpacing: 10 });
  });

  it('grid spacing rejects 0 / negative / non-numeric values', () => {
    const { onChange } = mount();
    const input = screen.getByTestId('solver-sketch-view-option-gridSpacing') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders all 3 axis-origin radios and the default-checked one is bottom-left', () => {
    mount();
    const tl = screen.getByTestId('solver-sketch-view-option-axisOrigin-top-left') as HTMLInputElement;
    const bl = screen.getByTestId('solver-sketch-view-option-axisOrigin-bottom-left') as HTMLInputElement;
    const c = screen.getByTestId('solver-sketch-view-option-axisOrigin-center') as HTMLInputElement;
    expect(tl.type).toBe('radio');
    expect(bl.type).toBe('radio');
    expect(c.type).toBe('radio');
    expect(tl.checked).toBe(false);
    expect(bl.checked).toBe(true);
    expect(c.checked).toBe(false);
  });

  it('clicking the center axis-origin radio emits onChange({ axisOrigin: "center" })', () => {
    const { onChange } = mount();
    fireEvent.click(screen.getByTestId('solver-sketch-view-option-axisOrigin-center'));
    expect(onChange).toHaveBeenCalledWith({ axisOrigin: 'center' });
  });

  it('axis-origin radios share a single name (true single-select)', () => {
    mount();
    const tl = screen.getByTestId('solver-sketch-view-option-axisOrigin-top-left') as HTMLInputElement;
    const bl = screen.getByTestId('solver-sketch-view-option-axisOrigin-bottom-left') as HTMLInputElement;
    const c = screen.getByTestId('solver-sketch-view-option-axisOrigin-center') as HTMLInputElement;
    expect(tl.name).toBe(bl.name);
    expect(bl.name).toBe(c.name);
    expect(tl.name.length).toBeGreaterThan(0);
  });

  it('clicking Reset emits the complete DEFAULT_VIEW_OPTIONS object', () => {
    const customOptions: ViewOptions = {
      showGrid: false,
      showAxes: false,
      showDimensions: false,
      showConstraintGlyphs: false,
      gridSpacing: 42,
      axisOrigin: 'center',
      darkMode: false,
    };
    const { onChange } = mount({ options: customOptions });
    fireEvent.click(screen.getByTestId('solver-sketch-view-option-reset'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_VIEW_OPTIONS });
  });

  it('DEFAULT_VIEW_OPTIONS encodes the documented default policy', () => {
    expect(DEFAULT_VIEW_OPTIONS).toEqual({
      showGrid: true,
      showAxes: true,
      showDimensions: true,
      showConstraintGlyphs: true,
      gridSpacing: 10,
      axisOrigin: 'bottom-left',
      darkMode: true,
    });
  });

  it('axis origin can be every one of the 3 allowed values', () => {
    const origins: AxisOrigin[] = ['top-left', 'bottom-left', 'center'];
    for (const origin of origins) {
      const { unmount } = mount({ options: { axisOrigin: origin } });
      const radio = screen.getByTestId(
        `solver-sketch-view-option-axisOrigin-${origin}`,
      ) as HTMLInputElement;
      expect(radio.checked).toBe(true);
      unmount();
    }
  });

  it('renders Korean labels when lang="ko"', () => {
    mount({ lang: 'ko' });
    const panel = screen.getByTestId('solver-sketch-view-options-panel');
    expect(panel.textContent).toContain('뷰 옵션');
    expect(panel.textContent).toContain('그리드');
    expect(panel.textContent).toContain('축');
    expect(panel.textContent).toContain('치수');
    expect(panel.textContent).toContain('구속 기호');
    expect(panel.textContent).toContain('다크 모드');
    expect(panel.textContent).toContain('기본값으로 초기화');
  });

  it('renders English labels when lang="en"', () => {
    mount({ lang: 'en' });
    const panel = screen.getByTestId('solver-sketch-view-options-panel');
    expect(panel.textContent).toContain('View options');
    expect(panel.textContent).toContain('Grid');
    expect(panel.textContent).toContain('Axes');
    expect(panel.textContent).toContain('Dimensions');
    expect(panel.textContent).toContain('Constraint glyphs');
    expect(panel.textContent).toContain('Dark mode');
    expect(panel.textContent).toContain('Reset to defaults');
  });

  it('renders Japanese labels when lang="ja"', () => {
    mount({ lang: 'ja' });
    const panel = screen.getByTestId('solver-sketch-view-options-panel');
    expect(panel.textContent).toContain('表示オプション');
    expect(panel.textContent).toContain('グリッド');
    expect(panel.textContent).toContain('拘束記号');
    expect(panel.textContent).toContain('ダークモード');
  });

  it('renders Chinese labels when lang="zh"', () => {
    mount({ lang: 'zh' });
    const panel = screen.getByTestId('solver-sketch-view-options-panel');
    expect(panel.textContent).toContain('视图选项');
    expect(panel.textContent).toContain('网格');
    expect(panel.textContent).toContain('约束符号');
    expect(panel.textContent).toContain('深色模式');
  });

  it('renders Spanish labels when lang="es"', () => {
    mount({ lang: 'es' });
    const panel = screen.getByTestId('solver-sketch-view-options-panel');
    expect(panel.textContent).toContain('Opciones de vista');
    expect(panel.textContent).toContain('Cuadrícula');
    expect(panel.textContent).toContain('Glifos de restricción');
    expect(panel.textContent).toContain('Modo oscuro');
  });

  it('renders Arabic labels and sets dir="rtl" when lang="ar"', () => {
    mount({ lang: 'ar' });
    const panel = screen.getByTestId('solver-sketch-view-options-panel');
    expect(panel.textContent).toContain('خيارات العرض');
    expect(panel.textContent).toContain('الشبكة');
    expect(panel.getAttribute('dir')).toBe('rtl');
  });

  it('non-ar languages render dir="ltr"', () => {
    mount({ lang: 'en' });
    expect(screen.getByTestId('solver-sketch-view-options-panel').getAttribute('dir')).toBe('ltr');
  });

  it('multiple toggles in succession each emit a single-field partial diff', () => {
    const onChange = vi.fn();
    mount({ onChange });
    fireEvent.click(screen.getByTestId('solver-sketch-view-option-showGrid'));
    fireEvent.click(screen.getByTestId('solver-sketch-view-option-showDimensions'));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[0]![0]).toEqual({ showGrid: false });
    expect(onChange.mock.calls[1]![0]).toEqual({ showDimensions: false });
  });

  it('reset is a button (not a submit) so it cannot accidentally submit a wrapping form', () => {
    mount();
    const btn = screen.getByTestId('solver-sketch-view-option-reset') as HTMLButtonElement;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.type).toBe('button');
  });

  it('grid spacing supports fractional millimetre values (e.g. 0.5 mm)', () => {
    const { onChange } = mount();
    const input = screen.getByTestId('solver-sketch-view-option-gridSpacing') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.5' } });
    expect(onChange).toHaveBeenCalledWith({ gridSpacing: 0.5 });
  });
});
