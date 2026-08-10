'use client';

/**
 * Page-shell content for the standalone Assembly Browser route, split out
 * of `page.tsx` so jsdom tests can mount it with a plain `lang` string
 * instead of unwrapping the `use(params)` promise hook. Filename starts
 * with `_` so Next.js does not treat it as a route.
 *
 * Phase 3.A: minimal full-screen wrapper around AssemblyBrowserModal that
 * seeds an empty AssemblyState and POSTs to /api/assembly-solve when the
 * user clicks Solve.
 *
 * Phase 4.A: adds a "Load sample" dropdown above the modal that drops
 * a pre-canned (AssemblyState, FeatureTrees) pair into the modal, so a
 * one-click flow can exercise the full AssemblyBrowser → /api/assembly-solve
 * → iterativeSolve real path. The dropdown is purely additive: the page
 * still defaults to a blank assembly and the existing tests keep passing.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type {
  AssemblyBrowserLang,
  AssemblyBrowserOnSolve,
  AssemblyBrowserSolveResult,
  AssemblySolverSelection,
} from './AssemblyBrowserModal';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  SAMPLE_ASSEMBLY_NAMES,
  getSampleAssembly,
  type SampleAssemblyName,
} from '@/lib/assembly/sampleAssemblies';
import {
  readAiAssemblyWorkspaceSeed,
  removeAiAssemblyWorkspaceSeed,
  type AiAssemblyWorkspaceSeed,
} from '../design-brief/assemblyWorkspaceSeed';

// The assembly editor pulls in the 3D viewer, constraint solvers and the
// optional expert tooling. Keep that graph out of the route's hydration
// bundle and fetch it only after the lightweight page shell is interactive.
const AssemblyBrowserModal = dynamic(() => import('./AssemblyBrowserModal'), {
  ssr: false,
  loading: () => (
    <div
      aria-busy="true"
      aria-live="polite"
      data-testid="assembly-browser-loading"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--nx-text-2)',
      }}
    >
      Loading assembly workspace…
    </div>
  ),
});

function normalizeLang(raw: string): AssemblyBrowserLang {
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

/**
 * Default solve fetcher — POSTs the AssemblyState + per-part FeatureTrees
 * to /api/assembly-solve.
 *
 * - When `featureTrees` is empty (no part has a tree yet), we OMIT the
 *   `featureTrees` field from the body so the API route stays on its
 *   Phase-1 'stub' path (preserves existing UI behaviour for users who
 *   haven't opened any tree editor).
 * - When `featureTrees` has at least one entry, we forward it so the
 *   route flips to the Phase-4 'real' iterativeSolve path and the
 *   response carries `phase: 'real'` + actual residuals.
 *
 * Tests inject `onSolve` directly so we never hit the network from jsdom.
 */
const defaultOnSolve: AssemblyBrowserOnSolve = async (
  state,
  featureTrees,
  solver,
  groupOptions,
) => {
  const body: {
    state: AssemblyState;
    featureTrees?: Record<string, FeatureTree>;
    solver?: AssemblySolverSelection;
    useGroups?: boolean;
    maxParallel?: number;
  } = {
    state,
  };
  if (featureTrees && Object.keys(featureTrees).length > 0) {
    body.featureTrees = featureTrees;
  }
  // Forward the solver picker selection so the API can pick / dispatch.
  // Defaults to 'auto' inside the modal — we still send it explicitly so
  // the server's recommendSolver pipeline runs instead of falling back to
  // the API's back-compat 'gauss_seidel' default.
  if (solver !== undefined) {
    body.solver = solver;
  }
  // Phase B31.1 — only attach the grouped-solve fields when the user
  // checked the "Use group partition" box in the modal. Omitting them
  // keeps the body byte-identical to the pre-B31.1 path so the route's
  // default `useGroups = false` takes over server-side (zero-regression).
  if (groupOptions) {
    body.useGroups = true;
    body.maxParallel = groupOptions.maxParallel;
  }
  const res = await fetch('/api/assembly-solve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as
    | (AssemblyBrowserSolveResult & { ok: true })
    | { ok: false; code: string; message: string };
  if ('ok' in data && data.ok === false) {
    throw new Error(`[${data.code}] ${data.message}`);
  }
  return data;
};

// ─── sample-dropdown i18n ───────────────────────────────────────────────────

/**
 * Tiny per-lang dictionary for the sample picker. Kept here (not in the
 * modal's dict) because the dropdown is page-shell chrome — the modal
 * itself stays sample-agnostic.
 */
const SAMPLE_LABELS: Record<AssemblyBrowserLang, { picker: string; blank: string }> = {
  ko: { picker: '샘플 불러오기', blank: '빈 어셈블리' },
  en: { picker: 'Load sample', blank: 'Blank assembly' },
  ja: { picker: 'サンプル読み込み', blank: '空のアセンブリ' },
  zh: { picker: '加载示例', blank: '空装配' },
  es: { picker: 'Cargar muestra', blank: 'Ensamblaje vacío' },
  ar: { picker: 'تحميل عينة', blank: 'تجميع فارغ' },
};

/** Sentinel value the <option value=""> uses for the "blank" entry. */
const BLANK_SENTINEL = '';

type SampleSelection = '' | SampleAssemblyName;

function isSampleName(v: string): v is SampleAssemblyName {
  return (SAMPLE_ASSEMBLY_NAMES as ReadonlyArray<string>).includes(v);
}

export interface AssemblyBrowserPageContentProps {
  lang: string;
  initialState?: AssemblyState;
  initialFeatureTrees?: Record<string, FeatureTree>;
  onSolve?: AssemblyBrowserOnSolve;
  /**
   * Optional project identifier (Phase 4). Threaded down into the
   * AssemblyBrowserModal so parts + mates + per-part FeatureTrees are
   * auto-persisted to localStorage under `nexyfab:assembly:${projectId}`
   * and `nexyfab:assembly-trees:${projectId}`. When omitted the modal
   * stays on its in-memory state path.
   */
  projectId?: string;
  /** One-shot session handoff from the AI design-brief workspace. */
  aiRevisionId?: string;
}

export function AssemblyBrowserPageContent({
  lang,
  initialState,
  initialFeatureTrees,
  onSolve,
  projectId,
  aiRevisionId,
}: AssemblyBrowserPageContentProps): React.ReactElement {
  const editorLang = normalizeLang(lang);
  const labels = SAMPLE_LABELS[editorLang];
  // The page route shows the modal full-screen and has nothing to close
  // back to — the close button just navigates back via history.
  const onClose = useCallback(() => {
    if (typeof window !== 'undefined') window.history.back();
  }, []);

  // ── sample dropdown state ────────────────────────────────────────────────
  // `sample` is the dropdown's controlled value; `loadedState` and
  // `loadedTrees` are what we hand to the modal. The modal itself owns the
  // mutable state internally, so we use `key={modalKey}` to FORCE a remount
  // whenever the sample selection changes — that wipes any in-progress
  // edits the user made on the previous sample and re-seeds the modal
  // from scratch. This is the simplest way to "reset previous state" on
  // sample change without giving the modal an imperative reset API.
  const [sample, setSample] = useState<SampleSelection>(BLANK_SENTINEL);
  const [modalKey, setModalKey] = useState(0);
  const [aiSeed, setAiSeed] = useState<AiAssemblyWorkspaceSeed | null>(null);

  useEffect(() => {
    if (!aiRevisionId || initialState || initialFeatureTrees) return;
    const seed = readAiAssemblyWorkspaceSeed(aiRevisionId);
    if (!seed) return;
    setAiSeed(seed);
    setSample(BLANK_SENTINEL);
    setModalKey(key => key + 1);
    removeAiAssemblyWorkspaceSeed(aiRevisionId);
  }, [aiRevisionId, initialFeatureTrees, initialState]);

  const { loadedState, loadedTrees } = useMemo<{
    loadedState: AssemblyState | undefined;
    loadedTrees: Record<string, FeatureTree> | undefined;
  }>(() => {
    if (sample === BLANK_SENTINEL) {
      return {
        loadedState: initialState ?? aiSeed?.candidate.assembly?.state,
        loadedTrees: initialFeatureTrees ?? aiSeed?.candidate.assembly?.featureTrees,
      };
    }
    const preset = getSampleAssembly(sample);
    return { loadedState: preset.state, loadedTrees: preset.featureTrees };
  }, [sample, initialState, initialFeatureTrees, aiSeed]);

  const handleSampleChange = useCallback((next: string) => {
    if (next === BLANK_SENTINEL) {
      setSample(BLANK_SENTINEL);
    } else if (isSampleName(next)) {
      setSample(next);
    }
    // Force the modal to remount with the new seed so any prior edits are
    // dropped. Even when the value is "blank" we still want a fresh
    // mount — the user explicitly asked to clear.
    setModalKey((k) => k + 1);
  }, []);

  return (
    <main
      data-testid="solver-assembly-page"
      style={{
        minHeight: '100vh',
        background: 'var(--nx-panel-2)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Sample picker — page-shell chrome above the modal. */}
      <div
        data-testid="solver-assembly-sample-picker"
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          background: 'var(--nx-panel)',
          border: '1px solid var(--nx-border)',
          borderRadius: 4,
          fontSize: 12,
          fontFamily: 'system-ui, sans-serif',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        <label
          htmlFor="solver-assembly-sample-select"
          style={{ color: 'var(--nx-text-2)' }}
        >
          {labels.picker}
        </label>
        <select
          id="solver-assembly-sample-select"
          data-testid="solver-assembly-sample-select"
          value={sample}
          onChange={(e) => handleSampleChange(e.target.value)}
          style={{
            fontSize: 12,
            padding: '2px 6px',
            border: '1px solid var(--nx-border)',
            borderRadius: 3,
            background: 'var(--nx-panel)',
          }}
        >
          <option value={BLANK_SENTINEL}>{labels.blank}</option>
          {SAMPLE_ASSEMBLY_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {aiSeed && (
        <div
          data-testid="ai-assembly-revision-warning"
          role="status"
          style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            maxWidth: 620,
            padding: '7px 12px',
            border: '1px solid #b45309',
            borderRadius: 4,
            background: '#2b2112',
            color: '#fcd34d',
            fontSize: 11,
            textAlign: 'center',
          }}
        >
          AI revision {aiSeed.revisionId} · semantic mates preserved · prior verification not inherited · run Manufacturing verify for exact OCCT/STEP, static interference and DoF evidence; motion still requires a governed timeline
        </div>
      )}

      <AssemblyBrowserModal
        key={modalKey}
        lang={editorLang}
        initialState={loadedState}
        initialFeatureTrees={loadedTrees}
        onClose={onClose}
        onSolve={onSolve ?? defaultOnSolve}
        projectId={projectId}
        // Phase 5.2.4 — fire the modal's auto-infer pass whenever the
        // seed came from a non-blank sample. Blank assemblies keep their
        // pristine empty-state UI; pre-populated samples surface the
        // Suggested-Mates panel and toast on mount (subject to the
        // user's localStorage `nexyfab:autoInfer` preference).
        autoInferOnMount={sample !== BLANK_SENTINEL}
      />
    </main>
  );
}

export default AssemblyBrowserPageContent;
