'use client';

/**
 * /[lang]/shape-generator/assembly/batch — dev/debug page that mounts the
 * SolverBatchPanel against a default item set built from the three
 * `sampleAssemblies` presets crossed with all three solver choices
 * (gauss_seidel, lagrangian, adaptive) → 9 items total. This gives the
 * panel a concrete hyperparameter-sweep workload to run on first visit.
 *
 * Split out of `page.tsx` so jsdom tests can mount it with a plain `lang`
 * string rather than unwrapping the params Promise via `use(params)`.
 * Filename starts with `_` so Next.js doesn't treat it as a route.
 *
 * Like the sibling /benchmark route, this is a tooling endpoint, not a
 * user-facing flow. Hosting it as a route keeps the production
 * AssemblyBrowser modal free of batch-driver wiring.
 */

import * as React from 'react';
import { useCallback, useMemo } from 'react';
import {
  SAMPLE_ASSEMBLY_NAMES,
  getSampleAssembly,
  type SampleAssemblyName,
} from '@/lib/assembly/sampleAssemblies';
import {
  solveBatch,
  type BatchSolveItem,
  type BatchSolveResult,
  type BatchSolverChoice,
  type SolveBatchOptions,
} from '@/lib/assembly/solverBatch';
import { featureTreeGeometryResolver } from '@/lib/assembly/geometryResolver';
import type { FeatureTree } from '@/lib/cad/featureTree';
import SolverBatchPanel, {
  type SolverBatchLang,
} from '../SolverBatchPanel';

function normalizeLang(raw: string): SolverBatchLang {
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
  // Legacy locale codes seen in URL paths — map to the closest dictionary.
  if (raw === 'cn') return 'zh';
  if (raw === 'kr') return 'ko';
  return 'en';
}

/**
 * The three solver choices we sweep across in the default item set.
 * Order matches the dispatch table in solverBatch.ts so the results
 * table reads in a predictable left-to-right pattern (GS → Lag → Adaptive
 * for every sample assembly).
 */
const SWEEP_SOLVERS: ReadonlyArray<BatchSolverChoice> = [
  'gauss_seidel',
  'lagrangian',
  'adaptive',
];

function toFeatureTreeMap(
  rec: Record<string, FeatureTree>,
): Map<string, FeatureTree> {
  const map = new Map<string, FeatureTree>();
  for (const [k, v] of Object.entries(rec)) map.set(k, v);
  return map;
}

/**
 * Build the default item set: SAMPLE_ASSEMBLY_NAMES × SWEEP_SOLVERS.
 *
 * Item ids are `${sampleName}/${solver}` so each row in the results table
 * is self-describing (the panel echoes the id verbatim in the first
 * column). Every item gets its OWN resolver instance — the resolver is
 * cheap to construct and the solvers may mutate any internal caches,
 * so sharing across items would be a future foot-gun.
 *
 * Exported so the page test can assert the cardinality (3 presets ×
 * 3 solvers = 9 items) without re-implementing the cross-product here.
 */
export function buildDefaultBatchItems(): BatchSolveItem[] {
  const items: BatchSolveItem[] = [];
  for (const sample of SAMPLE_ASSEMBLY_NAMES as ReadonlyArray<SampleAssemblyName>) {
    const preset = getSampleAssembly(sample);
    for (const solver of SWEEP_SOLVERS) {
      items.push({
        id: `${sample}/${solver}`,
        state: preset.state,
        resolver: featureTreeGeometryResolver(toFeatureTreeMap(preset.featureTrees)),
        solver,
      });
    }
  }
  return items;
}

export interface SolverBatchPageContentProps {
  lang: string;
  /**
   * Test seam — overriding the run callback lets tests assert the panel
   * wiring without paying for nine real solver invocations per Run click.
   * Production calls go through `solveBatch` directly.
   */
  onRun?: (
    items: ReadonlyArray<BatchSolveItem>,
    opts: SolveBatchOptions,
  ) => Promise<BatchSolveResult[]>;
  /**
   * Test seam — overriding the items list lets tests mount the page with
   * a deterministic 1- or 2-item fixture instead of the full 9-item
   * default sweep. Production calls use the default below.
   */
  items?: ReadonlyArray<BatchSolveItem>;
}

export function SolverBatchPageContent({
  lang,
  onRun,
  items,
}: SolverBatchPageContentProps): React.ReactElement {
  const panelLang = normalizeLang(lang);

  // Memoise the default item set so re-renders don't rebuild 9 resolver
  // closures every time. The list is stable across the page lifetime.
  const defaultItems = useMemo(() => buildDefaultBatchItems(), []);
  const effectiveItems = items ?? defaultItems;

  // Default onRun forwards to the real solveBatch. We pass-through here
  // (rather than letting the panel default to solveBatch directly) so the
  // page-level test seam can intercept all calls in one place.
  const handleRun = useCallback(
    (
      ix: ReadonlyArray<BatchSolveItem>,
      opts: SolveBatchOptions,
    ) => (onRun ?? solveBatch)(ix, opts),
    [onRun],
  );

  return (
    <main
      data-testid="solver-batch-page"
      style={{
        minHeight: '100vh',
        background: '#f3f4f6',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <SolverBatchPanel
        lang={panelLang}
        items={effectiveItems}
        onRun={handleRun}
      />
    </main>
  );
}

export default SolverBatchPageContent;
