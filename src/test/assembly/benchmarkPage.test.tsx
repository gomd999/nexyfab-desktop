/** @vitest-environment jsdom */
/**
 * benchmarkPage.test.tsx — /[lang]/shape-generator/assembly/benchmark
 * page content tests.
 *
 * The Next.js page (page.tsx) just unwraps the params Promise and renders
 * SolverBenchmarkPageContent — we test _content.tsx directly with a
 * plain `lang` string so jsdom doesn't have to deal with the
 * use(params) hook.
 *
 * The real runScenarios would invoke two solvers on six scenarios per
 * Run click; we always inject a stub `onRun` here to keep the tests
 * deterministic and fast.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { SolverBenchmarkPageContent } from '@/app/[lang]/shape-generator/assembly/benchmark/_content';
import type { BenchmarkResult } from '@/lib/assembly/solverBenchmark';

const STUB_RESULT: BenchmarkResult = {
  scenario: 'stub-scenario',
  gaussSeidel: { iterations: 1, durationMs: 0.1, success: true, finalResidual: 1e-9 },
  lagrangian: { iterations: 2, durationMs: 0.2, success: true, finalResidual: 1e-9 },
  winner: 'gauss_seidel',
  ratio: 0.5,
};

describe('SolverBenchmarkPageContent', () => {
  it('mounts the panel inside a page wrapper', () => {
    render(<SolverBenchmarkPageContent lang="en" onRun={vi.fn()} />);
    expect(screen.getByTestId('solver-benchmark-page')).toBeInTheDocument();
    expect(screen.getByTestId('solver-benchmark-panel')).toBeInTheDocument();
  });

  it('Run button forwards to the onRun prop and renders results', async () => {
    const onRun = vi.fn(async () => [STUB_RESULT]);
    render(<SolverBenchmarkPageContent lang="en" onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-benchmark-run'));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByTestId('solver-benchmark-row-stub-scenario'),
      ).toBeInTheDocument(),
    );
  });

  it('respects the lang prop (en ⇒ English title)', () => {
    render(<SolverBenchmarkPageContent lang="en" onRun={vi.fn()} />);
    expect(screen.getByTestId('solver-benchmark-title').textContent).toMatch(
      /Solver benchmark/i,
    );
  });

  it('respects the lang prop (ko ⇒ Korean title)', () => {
    render(<SolverBenchmarkPageContent lang="ko" onRun={vi.fn()} />);
    expect(screen.getByTestId('solver-benchmark-title').textContent).toMatch(
      /솔버 벤치마크/,
    );
  });

  it('normalizes unknown lang codes to English', () => {
    render(<SolverBenchmarkPageContent lang="xx" onRun={vi.fn()} />);
    expect(screen.getByTestId('solver-benchmark-title').textContent).toMatch(
      /Solver benchmark/i,
    );
  });
});
