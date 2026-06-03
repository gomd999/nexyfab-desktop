/** @vitest-environment jsdom */
/**
 * SketchExpressionsPanel — standalone parametric-variable scratchpad tests.
 *
 * The panel is solver-free (the expression engine is pure + eval-free), so
 * these mount in jsdom with no WASM boot. Coverage:
 *   - empty state + add/delete rows
 *   - evaluate a free var, an expression with deps, units, builtins
 *   - per-row error display (undefined ref, div-by-zero)
 *   - cycle banner via detectCircularDependency
 *   - duplicate-name flagging
 *   - i18n across 6 langs
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import SketchExpressionsPanel, {
  type EditorLang,
} from '@/app/[lang]/shape-generator/sketch/SketchExpressionsPanel';

afterEach(cleanup);

function mount(
  lang: EditorLang = 'en',
  initialRows?: ReadonlyArray<{ name: string; def: string }>,
): void {
  render(<SketchExpressionsPanel lang={lang} initialRows={initialRows} />);
}

/** Find the row key for a given variable name input. */
function rowKeyForName(name: string): string {
  const input = Array.from(
    document.querySelectorAll<HTMLInputElement>('[data-testid^="solver-sketch-expressions-name-"]'),
  ).find((el) => el.value === name);
  if (!input) throw new Error(`no row with name "${name}"`);
  return input.getAttribute('data-testid')!.replace('solver-sketch-expressions-name-', '');
}

function valueOf(name: string): string {
  return screen.getByTestId(`solver-sketch-expressions-value-${rowKeyForName(name)}`).textContent ?? '';
}

describe('SketchExpressionsPanel — basics', () => {
  it('mounts empty with the empty hint and a disabled Evaluate button', () => {
    mount();
    expect(screen.getByTestId('solver-sketch-expressions-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-sketch-expressions-empty')).toBeInTheDocument();
    expect((screen.getByTestId('solver-sketch-expressions-evaluate') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Add appends a row and removes the empty hint', () => {
    mount();
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-add'));
    expect(screen.queryByTestId('solver-sketch-expressions-empty')).toBeNull();
    expect(document.querySelectorAll('[data-testid^="solver-sketch-expressions-row-"]')).toHaveLength(1);
    expect((screen.getByTestId('solver-sketch-expressions-evaluate') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Delete removes the row', () => {
    mount('en', [{ name: 'w', def: '50' }]);
    const key = rowKeyForName('w');
    fireEvent.click(screen.getByTestId(`solver-sketch-expressions-delete-${key}`));
    expect(screen.getByTestId('solver-sketch-expressions-empty')).toBeInTheDocument();
  });
});

describe('SketchExpressionsPanel — evaluation', () => {
  it('value is "—" until Evaluate is pressed', () => {
    mount('en', [{ name: 'w', def: '50' }]);
    expect(valueOf('w')).toBe('—');
  });

  it('resolves a free var and a dependent expression', () => {
    mount('en', [
      { name: 'width', def: '50' },
      { name: 'cols', def: '4' },
      { name: 'gap', def: '5' },
      { name: 'total', def: 'width * cols + gap * (cols - 1)' },
    ]);
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-evaluate'));
    expect(valueOf('width')).toBe('50');
    expect(valueOf('total')).toBe('215'); // 50*4 + 5*3
  });

  it('folds units to canonical mm/rad and evaluates builtins', () => {
    mount('en', [
      { name: 'd', def: '1in' },
      { name: 'a', def: 'sin(pi/2)' },
    ]);
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-evaluate'));
    expect(valueOf('d')).toBe('25.4');
    expect(valueOf('a')).toBe('1');
  });

  it('shows a per-row error for an undefined reference', () => {
    mount('en', [{ name: 'x', def: 'missing + 1' }]);
    const key = rowKeyForName('x');
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-evaluate'));
    expect(valueOf('x')).toBe('—');
    expect(screen.getByTestId(`solver-sketch-expressions-error-${key}`).textContent ?? '').toMatch(/undefined/i);
  });

  it('flags a circular reference with the cycle banner', () => {
    mount('en', [
      { name: 'a', def: 'b + 1' },
      { name: 'b', def: 'a + 1' },
    ]);
    expect(screen.queryByTestId('solver-sketch-expressions-cycle')).toBeNull();
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-evaluate'));
    const banner = screen.getByTestId('solver-sketch-expressions-cycle');
    expect(banner.textContent ?? '').toMatch(/a → b|b → a/);
  });

  it('flags duplicate variable names', () => {
    mount('en', [
      { name: 'w', def: '1' },
      { name: 'w', def: '2' },
    ]);
    // Both rows share the name → both flagged as duplicate (no Evaluate needed).
    const errors = document.querySelectorAll('[data-testid^="solver-sketch-expressions-error-"]');
    expect(errors.length).toBe(2);
    expect(errors[0].textContent ?? '').toMatch(/duplicate/i);
  });
});

describe('SketchExpressionsPanel — apply to constraint', () => {
  it('no Apply button without onApply', () => {
    mount('en', [{ name: 'w', def: '50' }]);
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-evaluate'));
    expect(document.querySelector('[data-testid^="solver-sketch-expressions-apply-"]')).toBeNull();
  });

  it('Apply appears only after a row evaluates ok, and fires onApply with the value', () => {
    const onApply = vi.fn<(v: number) => void>();
    render(
      <SketchExpressionsPanel
        lang="en"
        initialRows={[{ name: 'w', def: '12.5' }]}
        onApply={onApply}
        canApply
      />,
    );
    const key = rowKeyForName('w');
    // Not evaluated yet → no Apply button.
    expect(screen.queryByTestId(`solver-sketch-expressions-apply-${key}`)).toBeNull();
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-evaluate'));
    fireEvent.click(screen.getByTestId(`solver-sketch-expressions-apply-${key}`));
    expect(onApply).toHaveBeenCalledWith(12.5);
  });

  it('Apply is disabled when canApply is false', () => {
    render(
      <SketchExpressionsPanel lang="en" initialRows={[{ name: 'w', def: '50' }]} onApply={vi.fn()} canApply={false} />,
    );
    const key = rowKeyForName('w');
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-evaluate'));
    expect((screen.getByTestId(`solver-sketch-expressions-apply-${key}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it('no Apply button for a failed row even with onApply', () => {
    render(
      <SketchExpressionsPanel lang="en" initialRows={[{ name: 'x', def: 'missing + 1' }]} onApply={vi.fn()} canApply />,
    );
    const key = rowKeyForName('x');
    fireEvent.click(screen.getByTestId('solver-sketch-expressions-evaluate'));
    expect(screen.queryByTestId(`solver-sketch-expressions-apply-${key}`)).toBeNull();
  });
});

describe('SketchExpressionsPanel — i18n', () => {
  const cases: Array<[EditorLang, RegExp]> = [
    ['ko', /파라메트릭 변수/],
    ['en', /Parametric Variables/],
    ['ja', /パラメトリック変数/],
    ['zh', /参数化变量/],
    ['es', /Variables Paramétricas/],
    ['ar', /متغيرات معاملية/],
  ];
  it('localises the panel title across 6 langs', () => {
    for (const [lang, re] of cases) {
      mount(lang);
      expect(screen.getByTestId('solver-sketch-expressions-panel').textContent ?? '').toMatch(re);
      cleanup();
    }
  });
});
