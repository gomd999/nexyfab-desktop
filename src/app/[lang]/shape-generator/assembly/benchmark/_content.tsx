'use client';

/**
 * /[lang]/shape-generator/assembly/benchmark — dev/debug page that
 * mounts the SolverBenchmarkPanel against the default scenario library
 * from solverBenchmark.ts.
 *
 * Split out of `page.tsx` so jsdom tests can mount it with a plain
 * `lang` string rather than unwrapping the params Promise via
 * `use(params)`. Filename starts with `_` so Next.js doesn't treat it
 * as a route.
 *
 * The page is intentionally bare — it's a tooling endpoint, not a
 * user-facing flow. Hosting it as a route (rather than a dev panel in
 * the main AssemblyBrowser) keeps the production modal free of solver
 * benchmark wiring and makes it discoverable by URL during reviews.
 */

import * as React from 'react';
import { useCallback } from 'react';
import {
  buildDefaultScenarios,
  runScenarios,
  type BenchmarkResult,
} from '@/lib/assembly/solverBenchmark';
import SolverBenchmarkPanel, {
  type SolverBenchmarkLang,
} from '../SolverBenchmarkPanel';

function normalizeLang(raw: string): SolverBenchmarkLang {
  if (
    raw === 'ko' ||
    raw === 'en' ||
    raw === 'ja' ||
    raw === 'zh' ||
    raw === 'es' ||
    raw === 'ar'
  ) {
    return raw;
  }
  if (raw === 'cn') return 'zh';
  if (raw === 'kr') return 'ko';
  return 'en';
}

export interface SolverBenchmarkPageContentProps {
  lang: string;
  /**
   * Test seam — overriding the run callback lets tests assert the panel
   * wiring without paying the cost of two real solver invocations per
   * scenario. Production calls go through the default below.
   */
  onRun?: () => Promise<ReadonlyArray<BenchmarkResult>>;
}

const defaultOnRun = async (): Promise<ReadonlyArray<BenchmarkResult>> => {
  // runScenarios is synchronous — wrapping in async keeps the onRun
  // signature uniform and lets us hand a real Promise to the panel
  // (which `await`s it).
  return runScenarios(buildDefaultScenarios());
};

export function SolverBenchmarkPageContent({
  lang,
  onRun,
}: SolverBenchmarkPageContentProps): React.ReactElement {
  const panelLang = normalizeLang(lang);
  const handleRun = useCallback(
    () => (onRun ?? defaultOnRun)(),
    [onRun],
  );

  return (
    <main
      data-testid="solver-benchmark-page"
      style={{
        minHeight: '100vh',
        background: '#f3f4f6',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <SolverBenchmarkPanel lang={panelLang} onRun={handleRun} />
    </main>
  );
}

export default SolverBenchmarkPageContent;
