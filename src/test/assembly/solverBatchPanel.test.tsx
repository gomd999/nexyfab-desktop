/** @vitest-environment jsdom */
/**
 * SolverBatchPanel — Phase 3.3.UI dev panel tests.
 *
 * Mounts the panel with a stub `onRun` (so we don't pay for real solver
 * work per test) and verifies:
 *   - Run button triggers onRun with the items + maxParallel option
 *   - results render in the table with one row per BatchSolveResult
 *   - maxParallel slider drives the value passed through to onRun
 *   - stats strip totals match the sum of durationMs + failure count
 *   - success vs failure styling on the success cell
 *   - Reset clears state back to the "no results" placeholder
 *   - empty items ⇒ Run disabled + warning surfaces
 *   - error banner appears when onRun rejects
 *   - loading spinner shows while onRun is pending
 *   - all 6 langs render their dictionary title
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import {
  SolverBatchPanel,
  MAX_PARALLEL_DEFAULT,
  MAX_PARALLEL_MAX,
  type SolverBatchLang,
} from '@/app/[lang]/shape-generator/assembly/SolverBatchPanel';
import type {
  BatchSolveItem,
  BatchSolveResult,
  SolveBatchOptions,
} from '@/lib/assembly/solverBatch';
import type { GeometryResolver } from '@/lib/assembly/iterativeSolver';

type RunFn = (
  items: ReadonlyArray<BatchSolveItem>,
  opts: SolveBatchOptions,
) => Promise<BatchSolveResult[]>;

// ─── fixtures ──────────────────────────────────────────────────────────────

const NOOP_RESOLVER: GeometryResolver = () => null;

function makeItem(
  id: string,
  solver: BatchSolveItem['solver'] = 'gauss_seidel',
): BatchSolveItem {
  return {
    id,
    state: { parts: [], mates: [] },
    resolver: NOOP_RESOLVER,
    solver,
  };
}

function makeResult(
  id: string,
  overrides: {
    success?: boolean;
    iterations?: number;
    durationMs?: number;
    residual?: number;
  } = {},
): BatchSolveResult {
  return {
    id,
    durationMs: overrides.durationMs ?? 0.5,
    result: {
      state: { parts: [], mates: [] },
      success: overrides.success ?? true,
      iterations: overrides.iterations ?? 3,
      finalMaxResidual: overrides.residual ?? 1e-9,
      residuals: [],
    },
  };
}

const SAMPLE_ITEMS: ReadonlyArray<BatchSolveItem> = [
  makeItem('alpha', 'gauss_seidel'),
  makeItem('beta', 'lagrangian'),
  makeItem('gamma', 'adaptive'),
];

const SAMPLE_RESULTS: ReadonlyArray<BatchSolveResult> = [
  makeResult('alpha', { iterations: 1, durationMs: 0.1, success: true, residual: 1e-9 }),
  makeResult('beta', { iterations: 6, durationMs: 0.3, success: true, residual: 1e-10 }),
  makeResult('gamma', { iterations: 50, durationMs: 0.7, success: false, residual: 0.42 }),
];

afterEach(() => {
  cleanup();
});

// ─── tests ─────────────────────────────────────────────────────────────────

describe('SolverBatchPanel', () => {
  it('renders the title + run button + slider with default maxParallel', () => {
    const onRun = vi.fn(async () => [...SAMPLE_RESULTS]);
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    expect(screen.getByTestId('solver-batch-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-batch-title').textContent).toMatch(
      /Solver batch/i,
    );
    const slider = screen.getByTestId(
      'solver-batch-maxparallel-slider',
    ) as HTMLInputElement;
    expect(slider.value).toBe(String(MAX_PARALLEL_DEFAULT));
    expect(screen.getByTestId('solver-batch-maxparallel-value').textContent).toBe(
      String(MAX_PARALLEL_DEFAULT),
    );
    expect(screen.getByTestId('solver-batch-empty')).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('clicking Run invokes onRun with the items + default maxParallel and renders the results', async () => {
    const onRun = vi.fn<RunFn>(async () => [...SAMPLE_RESULTS]);
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-batch-run'));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    expect(onRun.mock.calls[0]?.[0]).toEqual(SAMPLE_ITEMS);
    expect(onRun.mock.calls[0]?.[1]).toEqual({ maxParallel: MAX_PARALLEL_DEFAULT });
    await waitFor(() =>
      expect(screen.getByTestId('solver-batch-table')).toBeInTheDocument(),
    );
    // One row per result.
    expect(screen.getByTestId('solver-batch-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('solver-batch-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('solver-batch-row-2')).toBeInTheDocument();
    // First row id + solver echoed in dataset.
    expect(screen.getByTestId('solver-batch-row-0').getAttribute('data-row-id')).toBe(
      'alpha',
    );
    expect(
      screen.getByTestId('solver-batch-row-0').getAttribute('data-row-solver'),
    ).toBe('gauss_seidel');
  });

  it('moving the slider changes maxParallel passed to onRun', async () => {
    const onRun = vi.fn<RunFn>(async () => [...SAMPLE_RESULTS]);
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    const slider = screen.getByTestId(
      'solver-batch-maxparallel-slider',
    ) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '2' } });
    expect(screen.getByTestId('solver-batch-maxparallel-value').textContent).toBe('2');
    fireEvent.click(screen.getByTestId('solver-batch-run'));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    expect(onRun.mock.calls[0]?.[1]).toEqual({ maxParallel: 2 });
  });

  it('slider value clamps to the [1, MAX_PARALLEL_MAX] range', () => {
    const onRun = vi.fn();
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    const slider = screen.getByTestId(
      'solver-batch-maxparallel-slider',
    ) as HTMLInputElement;
    // Slider element honours min/max natively, but the onChange handler
    // ALSO clamps defensively — assert that the displayed value never
    // exceeds the upper bound.
    fireEvent.change(slider, { target: { value: '999' } });
    expect(
      Number(screen.getByTestId('solver-batch-maxparallel-value').textContent),
    ).toBeLessThanOrEqual(MAX_PARALLEL_MAX);
    fireEvent.change(slider, { target: { value: '0' } });
    expect(
      Number(screen.getByTestId('solver-batch-maxparallel-value').textContent),
    ).toBeGreaterThanOrEqual(1);
  });

  it('stats strip shows total / avg / failures derived from results', async () => {
    const onRun = vi.fn(async () => [...SAMPLE_RESULTS]);
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-batch-run'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-batch-stats')).toBeInTheDocument(),
    );
    // SAMPLE_RESULTS durations are 0.1 + 0.3 + 0.7 = 1.1 (sum), avg 0.367
    const total = screen.getByTestId('solver-batch-stats-total');
    const avg = screen.getByTestId('solver-batch-stats-avg');
    const failures = screen.getByTestId('solver-batch-stats-failures');
    const items = screen.getByTestId('solver-batch-stats-items');
    expect(total.textContent).toMatch(/1\.100/);
    expect(avg.textContent).toMatch(/0\.367/);
    // Only the gamma row failed.
    expect(failures.textContent).toMatch(/failures.*1/);
    expect(items.textContent).toMatch(/items.*3/);
  });

  it('success vs failure cell colour mapping (green vs red)', async () => {
    const onRun = vi.fn(async () => [...SAMPLE_RESULTS]);
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-batch-run'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-batch-table')).toBeInTheDocument(),
    );
    const okCell = screen.getByTestId('solver-batch-success-0');
    const failCell = screen.getByTestId('solver-batch-success-2');
    expect(okCell.getAttribute('data-success')).toBe('true');
    expect(failCell.getAttribute('data-success')).toBe('false');
    expect(okCell.style.color).toMatch(/(#16a34a|rgb\(22, *163, *74\))/);
    expect(failCell.style.color).toMatch(/(#b91c1c|rgb\(185, *28, *28\))/);
  });

  it('Reset clears state back to the empty placeholder', async () => {
    const onRun = vi.fn(async () => [...SAMPLE_RESULTS]);
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-batch-run'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-batch-table')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('solver-batch-reset'));
    expect(screen.queryByTestId('solver-batch-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('solver-batch-empty')).toBeInTheDocument();
  });

  it('empty items list disables Run and surfaces a warning', () => {
    const onRun = vi.fn();
    render(<SolverBatchPanel lang="en" items={[]} onRun={onRun} />);
    const runBtn = screen.getByTestId('solver-batch-run') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(screen.getByTestId('solver-batch-empty-items')).toBeInTheDocument();
    fireEvent.click(runBtn);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('shows the error banner when onRun rejects', async () => {
    const onRun = vi.fn(async () => {
      throw new Error('batch boom');
    });
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-batch-run'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-batch-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('solver-batch-error').textContent).toMatch(/batch boom/);
  });

  it('shows the loading spinner while onRun is pending', async () => {
    let resolveRun: ((r: BatchSolveResult[]) => void) | null = null;
    const onRun = vi.fn(
      () =>
        new Promise<BatchSolveResult[]>((resolve) => {
          resolveRun = resolve;
        }),
    );
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-batch-run'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-batch-spinner')).toBeInTheDocument(),
    );
    // Resolve the pending promise; spinner should vanish.
    resolveRun!([...SAMPLE_RESULTS]);
    await waitFor(() =>
      expect(screen.queryByTestId('solver-batch-spinner')).not.toBeInTheDocument(),
    );
  });

  it('residual cell renders in scientific notation', async () => {
    const onRun = vi.fn(async () => [...SAMPLE_RESULTS]);
    render(<SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-batch-run'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-batch-table')).toBeInTheDocument(),
    );
    // 1e-9 → "1.000e-9"
    expect(
      screen.getByTestId('solver-batch-residual-0').textContent,
    ).toMatch(/e[+-]?\d+/);
  });

  // ── i18n: render each of the 6 langs once and confirm its title surfaces ──
  it.each<[SolverBatchLang, RegExp]>([
    ['ko', /배치 솔버/],
    ['en', /Solver batch/i],
    ['ja', /バッチソルバー/],
    ['zh', /批量求解/],
    ['es', /Lote de solver/i],
    ['ar', /تشغيل دفعة/],
  ])('renders the %s title from the dictionary', (lang, pattern) => {
    render(<SolverBatchPanel lang={lang} items={SAMPLE_ITEMS} onRun={vi.fn()} />);
    expect(screen.getByTestId('solver-batch-title').textContent).toMatch(pattern);
  });

  it('Reset is disabled until there are results or an error', () => {
    render(
      <SolverBatchPanel lang="en" items={SAMPLE_ITEMS} onRun={vi.fn()} />,
    );
    const reset = screen.getByTestId('solver-batch-reset') as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
  });
});
