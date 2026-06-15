/** @vitest-environment jsdom */
/**
 * batchPage.test.tsx — /[lang]/shape-generator/assembly/batch page
 * content tests.
 *
 * The Next.js page (page.tsx) just unwraps the params Promise and renders
 * SolverBatchPageContent — we test _content.tsx directly with a plain
 * `lang` string so jsdom doesn't have to deal with the use(params) hook.
 *
 * The real solveBatch would run nine real solvers (3 sample presets ×
 * 3 solver choices) per Run click; we inject a stub `onRun` here to keep
 * the tests deterministic and fast.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import {
  SolverBatchPageContent,
  buildDefaultBatchItems,
} from '@/app/[lang]/shape-generator/assembly/batch/_content';
import type {
  BatchSolveItem,
  BatchSolveResult,
  SolveBatchOptions,
} from '@/lib/assembly/solverBatch';

type RunFn = (
  items: ReadonlyArray<BatchSolveItem>,
  opts: SolveBatchOptions,
) => Promise<BatchSolveResult[]>;

const STUB_RESULT: BatchSolveResult = {
  id: 'two-cubes-concentric/gauss_seidel',
  durationMs: 0.42,
  result: {
    state: { parts: [], mates: [] },
    success: true,
    iterations: 1,
    finalMaxResidual: 1e-9,
    residuals: [],
  },
};

describe('SolverBatchPageContent', () => {
  it('mounts the panel inside a page wrapper', () => {
    render(<SolverBatchPageContent lang="en" onRun={vi.fn()} />);
    expect(screen.getByTestId('solver-batch-page')).toBeInTheDocument();
    expect(screen.getByTestId('solver-batch-panel')).toBeInTheDocument();
  });

  it('Run button forwards to the onRun prop with the default 9-item sweep', async () => {
    const onRun = vi.fn<RunFn>(async () => [STUB_RESULT]);
    render(<SolverBatchPageContent lang="en" onRun={onRun} />);
    fireEvent.click(screen.getByTestId('solver-batch-run'));
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
    // 3 presets × 3 solver choices = 9 items in the default sweep.
    expect(onRun.mock.calls[0]?.[0]).toHaveLength(9);
    await waitFor(() =>
      expect(screen.getByTestId('solver-batch-row-0')).toBeInTheDocument(),
    );
  });

  it('respects the lang prop (ko ⇒ Korean title)', () => {
    render(<SolverBatchPageContent lang="ko" onRun={vi.fn()} />);
    expect(screen.getByTestId('solver-batch-title').textContent).toMatch(
      /배치 솔버/,
    );
  });

  it('normalizes unknown lang codes to English', () => {
    render(<SolverBatchPageContent lang="xx" onRun={vi.fn()} />);
    expect(screen.getByTestId('solver-batch-title').textContent).toMatch(
      /Solver batch/i,
    );
  });

  it('buildDefaultBatchItems returns 9 items covering all 3 sample × 3 solver pairs', () => {
    const items = buildDefaultBatchItems();
    expect(items).toHaveLength(9);
    // Every sample × solver pair represented exactly once.
    const ids = items.map((i) => i.id).sort();
    expect(ids).toEqual([
      'hinge-pair/adaptive',
      'hinge-pair/gauss_seidel',
      'hinge-pair/lagrangian',
      'three-cubes-chain/adaptive',
      'three-cubes-chain/gauss_seidel',
      'three-cubes-chain/lagrangian',
      'two-cubes-concentric/adaptive',
      'two-cubes-concentric/gauss_seidel',
      'two-cubes-concentric/lagrangian',
    ]);
    // Every item carries a resolver function.
    for (const item of items) {
      expect(typeof item.resolver).toBe('function');
    }
  });
});
