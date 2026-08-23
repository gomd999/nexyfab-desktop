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
import workspaceStyles from './AssemblyWorkspace.module.css';
import type { AssemblyDrawingHandoff } from './drawingHandoff';

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
      className={workspaceStyles.workspaceLoading}
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
 * Production authoring is fail-closed: every part needs a non-empty tree and
 * the route must report `phase: real`. The compatibility stub remains an API
 * test fixture, not a user-visible precision-CAD result.
 *
 * Tests inject `onSolve` directly so we never hit the network from jsdom.
 */
export const defaultAssemblyOnSolve: AssemblyBrowserOnSolve = async (
  state,
  featureTrees,
  solver,
  groupOptions,
) => {
  const incompletePartIds = state.parts
    .filter(part => !featureTrees[part.id] || featureTrees[part.id]!.nodes.length === 0)
    .map(part => part.id);
  if (state.parts.length === 0) throw new Error('[ASSEMBLY_EMPTY] Add at least one part before solving.');
  if (incompletePartIds.length > 0) {
    throw new Error(`[FEATURE_TREES_INCOMPLETE] Active FeatureTree required for: ${incompletePartIds.join(', ')}`);
  }
  const body: {
    state: AssemblyState;
    featureTrees: Record<string, FeatureTree>;
    solver?: AssemblySolverSelection;
    useGroups?: boolean;
    maxParallel?: number;
  } = { state, featureTrees };
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
  const res = await fetch('/api/assembly-solve/', {
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
  if (data.phase !== 'real') {
    throw new Error('[AUTHORITATIVE_SOLVER_REQUIRED] The server did not run the real FeatureTree solver.');
  }
  return data;
};

// ─── sample-dropdown i18n ───────────────────────────────────────────────────

/**
 * Tiny per-lang dictionary for the sample picker. Kept here (not in the
 * modal's dict) because the dropdown is page-shell chrome — the modal
 * itself stays sample-agnostic.
 */
const SAMPLE_LABELS: Record<AssemblyBrowserLang, {
  picker: string;
  blank: string;
  drawing: string;
  drawingBusy: string;
  drawingError: string;
  solvePassed: string;
  solveNotRun: string;
}> = {
  ko: { picker: '샘플 불러오기', blank: '빈 어셈블리', drawing: '현재 리비전으로 도면 만들기', drawingBusy: '도면 전달 준비 중…', drawingError: '도면 전달 실패', solvePassed: '정밀 풀이 PASS', solveNotRun: '정밀 풀이 NOT_RUN' },
  en: { picker: 'Load sample', blank: 'Blank assembly', drawing: 'Create drawings from current revision', drawingBusy: 'Preparing drawing handoff…', drawingError: 'Drawing handoff failed', solvePassed: 'exact solve PASS', solveNotRun: 'exact solve NOT_RUN' },
  ja: { picker: 'サンプル読み込み', blank: '空のアセンブリ', drawing: '現在のリビジョンから図面を作成', drawingBusy: '図面引き渡しを準備中…', drawingError: '図面引き渡しに失敗', solvePassed: '精密ソルブ PASS', solveNotRun: '精密ソルブ NOT_RUN' },
  zh: { picker: '加载示例', blank: '空装配', drawing: '从当前修订创建图纸', drawingBusy: '正在准备图纸交接…', drawingError: '图纸交接失败', solvePassed: '精确求解 PASS', solveNotRun: '精确求解 NOT_RUN' },
  es: { picker: 'Cargar muestra', blank: 'Ensamblaje vacío', drawing: 'Crear planos desde la revisión actual', drawingBusy: 'Preparando entrega de planos…', drawingError: 'Falló la entrega de planos', solvePassed: 'solución exacta PASS', solveNotRun: 'solución exacta NOT_RUN' },
  ar: { picker: 'تحميل عينة', blank: 'تجميع فارغ', drawing: 'إنشاء رسومات من المراجعة الحالية', drawingBusy: 'جارٍ تجهيز تسليم الرسم…', drawingError: 'فشل تسليم الرسم', solvePassed: 'الحل الدقيق PASS', solveNotRun: 'الحل الدقيق NOT_RUN' },
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
  /** Durable CAD head binding required before the server may own a handoff. */
  projectRevision?: number;
  projectRevisionHash?: string;
  /** One-shot session handoff from the AI design-brief workspace. */
  aiRevisionId?: string;
  /** Test/host navigation hook; storage is always written before this runs. */
  onDrawingHandoff?: (
    handoff: AssemblyDrawingHandoff,
    href: string,
  ) => void | Promise<void>;
}

export function AssemblyBrowserPageContent({
  lang,
  initialState,
  initialFeatureTrees,
  onSolve,
  projectId,
  projectRevision,
  projectRevisionHash,
  aiRevisionId,
  onDrawingHandoff,
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
  const [currentState, setCurrentState] = useState<AssemblyState>(
    initialState ?? { parts: [], mates: [] },
  );
  const [currentFeatureTrees, setCurrentFeatureTrees] = useState<Record<string, FeatureTree>>(
    initialFeatureTrees ?? {},
  );
  const [lastSolve, setLastSolve] = useState<{
    result: AssemblyBrowserSolveResult;
    workspaceFingerprint: string;
  } | null>(null);
  const [drawingHandoffBusy, setDrawingHandoffBusy] = useState(false);
  const [drawingHandoffError, setDrawingHandoffError] = useState<string | null>(null);
  const [drawingHandoffPersistence, setDrawingHandoffPersistence] = useState<'PASS' | 'NOT_RUN'>('NOT_RUN');

  const fingerprintWorkspace = useCallback(
    (state: AssemblyState, trees: Record<string, FeatureTree>) => JSON.stringify({ state, trees }),
    [],
  );

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
    setLastSolve(null);
    setDrawingHandoffError(null);
  }, []);

  const handleSolve = useCallback<AssemblyBrowserOnSolve>(async (
    state,
    trees,
    solver,
    groupOptions,
  ) => {
    // A fresh attempt invalidates the prior solve receipt immediately. If
    // this request fails, the drawing handoff must not inherit an older PASS
    // merely because the editable state bytes happened to stay unchanged.
    setLastSolve(null);
    const result = await (onSolve ?? defaultAssemblyOnSolve)(state, trees, solver, groupOptions);
    const solvedState = result.phase === 'real' && result.success && result.state
      ? result.state
      : state;
    setLastSolve({
      result,
      workspaceFingerprint: fingerprintWorkspace(solvedState, trees),
    });
    return result;
  }, [fingerprintWorkspace, onSolve]);

  const currentFingerprint = fingerprintWorkspace(currentState, currentFeatureTrees);
  const currentSolveResult = lastSolve?.workspaceFingerprint === currentFingerprint
    ? lastSolve.result
    : null;
  const currentSolvePassed = currentSolveResult?.phase === 'real'
    && currentSolveResult.success === true;

  const handleDrawingHandoff = useCallback(async () => {
    if (drawingHandoffBusy || currentState.parts.length === 0) return;
    setDrawingHandoffBusy(true);
    setDrawingHandoffError(null);
    try {
      const {
        buildAssemblyDrawingHandoff,
        writeAssemblyDrawingHandoff,
      } = await import('./drawingHandoff');
      const handoff = await buildAssemblyDrawingHandoff({
        state: currentState,
        featureTrees: currentFeatureTrees,
        solveResult: currentSolveResult,
        projectId,
        ...(Number.isSafeInteger(projectRevision) && projectRevisionHash
          ? { workspaceRevision: projectRevision, workspaceContentSha256: projectRevisionHash }
          : {}),
        upstreamRevisionId: aiSeed?.revisionId,
      });
      const langSegment = editorLang === 'ko' ? 'kr' : editorLang;
      let href: string;
      if (
        projectId
        && Number.isSafeInteger(projectRevision)
        && typeof projectRevisionHash === 'string'
        && /^[a-f0-9]{64}$/.test(projectRevisionHash)
      ) {
        const { saveServerDrawingHandoff } = await import('./serverDrawingHandoff');
        const stored = await saveServerDrawingHandoff({
          projectId,
          expectedRevision: projectRevision!,
          expectedContentSha256: projectRevisionHash,
          handoff,
        });
        if (stored.ok) {
          setDrawingHandoffPersistence('PASS');
          href = `/${langSegment}/shape-generator/drawing?expert=1&handoff=${encodeURIComponent(stored.handoffId)}&project=${encodeURIComponent(projectId)}&storage=server`;
        } else {
          writeAssemblyDrawingHandoff(handoff);
          setDrawingHandoffPersistence('NOT_RUN');
          href = `/${langSegment}/shape-generator/drawing?expert=1&handoff=${encodeURIComponent(handoff.handoffId)}&storage=session`;
        }
      } else {
        writeAssemblyDrawingHandoff(handoff);
        setDrawingHandoffPersistence('NOT_RUN');
        href = `/${langSegment}/shape-generator/drawing?expert=1&handoff=${encodeURIComponent(handoff.handoffId)}&storage=session`;
      }
      if (onDrawingHandoff) {
        await onDrawingHandoff(handoff, href);
      } else if (typeof window !== 'undefined') {
        window.location.assign(href);
      }
    } catch (error) {
      setDrawingHandoffError(error instanceof Error ? error.message : String(error));
    } finally {
      setDrawingHandoffBusy(false);
    }
  }, [
    aiSeed?.revisionId,
    currentFeatureTrees,
    currentSolveResult,
    currentState,
    drawingHandoffBusy,
    editorLang,
    onDrawingHandoff,
    projectId,
    projectRevision,
    projectRevisionHash,
  ]);

  return (
    <main
      data-testid="solver-assembly-page"
      className={workspaceStyles.workspacePage}
    >
      {/* Sample picker — page-shell chrome above the modal. */}
      <div
        data-testid="solver-assembly-sample-picker"
        className={workspaceStyles.samplePicker}
      >
        <label
          htmlFor="solver-assembly-sample-select"
          className={workspaceStyles.sampleLabel}
        >
          {labels.picker}
        </label>
        <select
          id="solver-assembly-sample-select"
          data-testid="solver-assembly-sample-select"
          value={sample}
          onChange={(e) => handleSampleChange(e.target.value)}
          className={workspaceStyles.sampleSelect}
        >
          <option value={BLANK_SENTINEL}>{labels.blank}</option>
          {SAMPLE_ASSEMBLY_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="assembly-create-drawing-handoff"
          disabled={currentState.parts.length === 0 || drawingHandoffBusy}
          aria-describedby="assembly-drawing-handoff-status"
          onClick={() => { void handleDrawingHandoff(); }}
          className={workspaceStyles.drawingHandoffButton}
        >
          {drawingHandoffBusy ? labels.drawingBusy : labels.drawing}
        </button>
        <span
          id="assembly-drawing-handoff-status"
          data-testid="assembly-drawing-handoff-status"
          className={workspaceStyles.drawingHandoffStatus}
          data-status={currentSolvePassed ? 'pass' : 'not-run'}
        >
          {currentSolvePassed ? labels.solvePassed : labels.solveNotRun}
        </span>
        <span
          data-testid="assembly-drawing-handoff-persistence"
          className={workspaceStyles.drawingHandoffStatus}
          data-status={drawingHandoffPersistence === 'PASS' ? 'pass' : 'not-run'}
        >
          Server persistence {drawingHandoffPersistence}{drawingHandoffPersistence === 'NOT_RUN' ? ' · session-only fallback' : ''}
        </span>
      </div>

      {drawingHandoffError ? (
        <div
          role="alert"
          data-testid="assembly-drawing-handoff-error"
          className={workspaceStyles.drawingHandoffError}
        >
          {labels.drawingError}: {drawingHandoffError}
        </div>
      ) : null}

      {aiSeed && (
        <div
          data-testid="ai-assembly-revision-warning"
          role="status"
          className={workspaceStyles.revisionWarning}
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
        onSolve={handleSolve}
        onStateChange={setCurrentState}
        onFeatureTreesChange={setCurrentFeatureTrees}
        exactSolveRequired
        projectId={projectId}
        // Phase 5.2.4 — fire the modal's auto-infer pass whenever the
        // seed came from a non-blank sample. Blank assemblies keep their
        // pristine empty-state UI; pre-populated samples surface the
        // Suggested-Mates panel and toast on mount (subject to the
        // user's localStorage `nexyfab:autoInfer` preference).
        autoInferOnMount={sample !== BLANK_SENTINEL}
        default3DView
      />
    </main>
  );
}

export default AssemblyBrowserPageContent;
