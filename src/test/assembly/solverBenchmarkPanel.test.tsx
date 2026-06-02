/** @vitest-environment jsdom */
/**
 * SolverBenchmarkPanel — Phase 3.2.3.UI dev panel tests.
 *
 * Mounts the panel with a stub `onRun` callback (so we don't pay for
 * two real solvers per scenario × N scenarios per test) and verifies:
 *   - Run button triggers onRun and stores its result
 *   - results render in a table
 *   - winner cell colour mapping (blue / green / grey)
 *   - finalResidual > tolerance ⇒ red text on the ok cell
 *   - Export CSV triggers URL.createObjectURL (mocked)
 *   - Reset clears state
 *   - initialResults prop ⇒ immediate render
 *   - all 6 langs render their dictionary title
 *   - empty results ⇒ "no results" placeholder
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import {
  SolverBenchmarkPanel,
  buildCsv,
  type SolverBenchmarkLang,
} from '@/app/[lang]/shape-generator/assembly/SolverBenchmarkPanel';
import type { BenchmarkResult } from '@/lib/assembly/solverBenchmark';

// ─── fixtures ──────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    scenario: 'fixture-scenario',
    gaussSeidel: {
      iterations: 3,
      durationMs: 0.123,
      success: true,
      finalResidual: 1e-8,
    },
    lagrangian: {
      iterations: 5,
      durationMs: 0.234,
      success: true,
      finalResidual: 1e-9,
    },
    winner: 'gauss_seidel',
    ratio: 0.5256,
    ...overrides,
  };
}

const SAMPLE_RESULTS: ReadonlyArray<BenchmarkResult> = [
  makeResult({
    scenario: 'gs-wins-case',
    winner: 'gauss_seidel',
    gaussSeidel: { iterations: 1, durationMs: 0.10, success: true, finalResidual: 1e-9 },
    lagrangian: { iterations: 4, durationMs: 0.30, success: true, finalResidual: 1e-9 },
    ratio: 0.10 / 0.30,
  }),
  makeResult({
    scenario: 'lag-wins-case',
    winner: 'lagrangian',
    gaussSeidel: { iterations: 50, durationMs: 0.80, success: false, finalResidual: 0.5 },
    lagrangian: { iterations: 6, durationMs: 0.20, success: true, finalResidual: 1e-9 },
    ratio: 0.80 / 0.20,
  }),
  makeResult({
    scenario: 'tie-case',
    winner: 'tie',
    gaussSeidel: { iterations: 3, durationMs: 0.21, success: true, finalResidual: 1e-9 },
    lagrangian: { iterations: 5, durationMs: 0.21, success: true, finalResidual: 1e-9 },
    ratio: 1.0,
  }),
];

// ─── URL.createObjectURL shim for jsdom (CSV export) ───────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;

beforeEach(() => {
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  createObjectUrlSpy = vi.fn(() => 'blob:mock-url');
  revokeObjectUrlSpy = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectUrlSpy,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectUrlSpy,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  if (originalCreate) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreate,
      configurable: true,
      writable: true,
    });
  }
  if (originalRevoke) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: originalRevoke,
      configurable: true,
      writable: true,
    });
  }
});

// ─── tests ─────────────────────────────────────────────────────────────────

describe('SolverBenchmarkPanel', () => {
  it('renders the title + run button on first mount with no results', () => {
    const onRun = vi.fn(async () => SAMPLE_RESULTS);
    render(<SolverBenchmarkPanel lang="en" onRun={onRun} />);
    expect(screen.getByTestId('solver-benchmark-panel')).toBeInTheDocument();
    expect(screen.getByTestId('solver-benchmark-title').textContent).toMatch(
      /Solver benchmark/i,
    );
    expect(screen.getByTestId('solver-benchmark-run')).toBeInTheDocument();
    expect(screen.getByTestId('solver-benchmark-empty')).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('clicking Run invokes onRun and renders the returned results', async () => {
    const onRun = vi.fn(async () => SAMPLE_RESULTS);
    render(<SolverBenchmarkPanel lang="en" onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-benchmark-run'));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('solver-benchmark-table')).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('solver-benchmark-row-gs-wins-case'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('solver-benchmark-row-lag-wins-case'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('solver-benchmark-row-tie-case'),
    ).toBeInTheDocument();
  });

  it('winner cell colour mapping: gauss_seidel=blue, lagrangian=green, tie=grey', async () => {
    render(
      <SolverBenchmarkPanel
        lang="en"
        onRun={vi.fn()}
        initialResults={SAMPLE_RESULTS}
      />,
    );
    const gsCell = screen.getByTestId('solver-benchmark-winner-gs-wins-case');
    const lagCell = screen.getByTestId('solver-benchmark-winner-lag-wins-case');
    const tieCell = screen.getByTestId('solver-benchmark-winner-tie-case');
    // data-winner mirrors the underlying union — easier to assert than colour.
    expect(gsCell.getAttribute('data-winner')).toBe('gauss_seidel');
    expect(lagCell.getAttribute('data-winner')).toBe('lagrangian');
    expect(tieCell.getAttribute('data-winner')).toBe('tie');
    // Background colour mapping — assert the actual hex values used.
    expect(gsCell.style.background).toMatch(/(#2563eb|rgb\(37, *99, *235\))/);
    expect(lagCell.style.background).toMatch(/(#16a34a|rgb\(22, *163, *74\))/);
    expect(tieCell.style.background).toMatch(/(#9ca3af|rgb\(156, *163, *175\))/);
  });

  it('finalResidual exceeding tolerance ⇒ red text on the ok cell', () => {
    const failing: BenchmarkResult = makeResult({
      scenario: 'gs-failed',
      // 0.5 > 1e-4 (GS tol) → ok cell goes red
      gaussSeidel: { iterations: 50, durationMs: 0.7, success: false, finalResidual: 0.5 },
      // 1e-9 < 1e-6 (Lag tol) → ok cell stays default
      lagrangian: { iterations: 6, durationMs: 0.2, success: true, finalResidual: 1e-9 },
      winner: 'lagrangian',
      ratio: 3.5,
    });
    render(
      <SolverBenchmarkPanel lang="en" onRun={vi.fn()} initialResults={[failing]} />,
    );
    const gsOk = screen.getByTestId('solver-benchmark-gs-ok-gs-failed');
    const lagOk = screen.getByTestId('solver-benchmark-lag-ok-gs-failed');
    expect(gsOk.getAttribute('data-failed')).toBe('true');
    expect(lagOk.getAttribute('data-failed')).toBe('false');
    // Red text colour assertion (the panel sets color: '#b91c1c' on the failing cell)
    expect(gsOk.style.color).toMatch(/(#b91c1c|rgb\(185, *28, *28\))/);
  });

  it('Export CSV triggers URL.createObjectURL', () => {
    render(
      <SolverBenchmarkPanel
        lang="en"
        onRun={vi.fn()}
        initialResults={SAMPLE_RESULTS}
      />,
    );
    fireEvent.click(screen.getByTestId('solver-benchmark-export-csv'));
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    const arg = createObjectUrlSpy.mock.calls[0]?.[0] as Blob;
    expect(arg).toBeInstanceOf(Blob);
    expect(arg.type).toMatch(/text\/csv/);
  });

  it('Export CSV is a no-op when there are no results', () => {
    render(<SolverBenchmarkPanel lang="en" onRun={vi.fn()} />);
    // The button is disabled — clicking it should still not call createObjectURL.
    const btn = screen.getByTestId('solver-benchmark-export-csv') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(createObjectUrlSpy).not.toHaveBeenCalled();
  });

  it('Reset clears state back to the empty placeholder', () => {
    render(
      <SolverBenchmarkPanel
        lang="en"
        onRun={vi.fn()}
        initialResults={SAMPLE_RESULTS}
      />,
    );
    expect(screen.getByTestId('solver-benchmark-table')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('solver-benchmark-reset'));
    expect(screen.queryByTestId('solver-benchmark-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('solver-benchmark-empty')).toBeInTheDocument();
  });

  it('initialResults prop renders immediately without a Run click', () => {
    const onRun = vi.fn();
    render(
      <SolverBenchmarkPanel
        lang="en"
        onRun={onRun}
        initialResults={SAMPLE_RESULTS}
      />,
    );
    expect(screen.getByTestId('solver-benchmark-table')).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('summary line counts winners across all results', () => {
    render(
      <SolverBenchmarkPanel
        lang="en"
        onRun={vi.fn()}
        initialResults={SAMPLE_RESULTS}
      />,
    );
    const summary = screen.getByTestId('solver-benchmark-summary');
    // SAMPLE_RESULTS has 1 GS win, 1 Lag win, 1 tie out of 3 total.
    expect(summary.textContent).toMatch(/GS wins 1\/3/);
    expect(summary.textContent).toMatch(/Lag wins 1\/3/);
    expect(summary.textContent).toMatch(/tie 1\/3/);
  });

  it('shows the error banner when onRun rejects', async () => {
    const onRun = vi.fn(async () => {
      throw new Error('boom');
    });
    render(<SolverBenchmarkPanel lang="en" onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-benchmark-run'));
    await waitFor(() =>
      expect(screen.getByTestId('solver-benchmark-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('solver-benchmark-error').textContent).toMatch(/boom/);
  });

  // ── i18n: render each of the 6 langs once and confirm its title surfaces ──
  it.each<[SolverBenchmarkLang, RegExp]>([
    ['ko', /솔버 벤치마크/],
    ['en', /Solver benchmark/i],
    ['ja', /ソルバーベンチマーク/],
    ['zh', /求解器基准测试/],
    ['es', /Banco de pruebas/i],
    ['ar', /اختبار أداء/],
  ])('renders the %s title from the dictionary', (lang, pattern) => {
    render(<SolverBenchmarkPanel lang={lang} onRun={vi.fn()} />);
    expect(screen.getByTestId('solver-benchmark-title').textContent).toMatch(pattern);
  });

  it('CSV exporter produces a header + one row per result with raw numerics', () => {
    const csv = buildCsv(SAMPLE_RESULTS);
    const lines = csv.split('\n').filter((l) => l.length > 0);
    // 1 header + 3 result rows
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      'scenario,gs_iterations,gs_durationMs,gs_success,gs_finalResidual,lag_iterations,lag_durationMs,lag_success,lag_finalResidual,winner,ratio',
    );
    // Each data line should start with the scenario name.
    expect(lines[1]).toMatch(/^gs-wins-case,/);
    expect(lines[2]).toMatch(/^lag-wins-case,/);
    expect(lines[3]).toMatch(/^tie-case,/);
  });
});
