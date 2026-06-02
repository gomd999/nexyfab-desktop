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
 */

import React, { useCallback } from 'react';
import AssemblyBrowserModal, {
  type AssemblyBrowserLang,
  type AssemblyBrowserOnSolve,
  type AssemblyBrowserSolveResult,
} from './AssemblyBrowserModal';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';

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
const defaultOnSolve: AssemblyBrowserOnSolve = async (state, featureTrees) => {
  const body: { state: AssemblyState; featureTrees?: Record<string, FeatureTree> } = {
    state,
  };
  if (featureTrees && Object.keys(featureTrees).length > 0) {
    body.featureTrees = featureTrees;
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

export interface AssemblyBrowserPageContentProps {
  lang: string;
  initialState?: AssemblyState;
  initialFeatureTrees?: Record<string, FeatureTree>;
  onSolve?: AssemblyBrowserOnSolve;
}

export function AssemblyBrowserPageContent({
  lang,
  initialState,
  initialFeatureTrees,
  onSolve,
}: AssemblyBrowserPageContentProps): React.ReactElement {
  const editorLang = normalizeLang(lang);
  // The page route shows the modal full-screen and has nothing to close
  // back to — the close button just navigates back via history.
  const onClose = useCallback(() => {
    if (typeof window !== 'undefined') window.history.back();
  }, []);

  return (
    <main
      data-testid="solver-assembly-page"
      style={{
        minHeight: '100vh',
        background: '#f3f4f6',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <AssemblyBrowserModal
        lang={editorLang}
        initialState={initialState}
        initialFeatureTrees={initialFeatureTrees}
        onClose={onClose}
        onSolve={onSolve ?? defaultOnSolve}
      />
    </main>
  );
}

export default AssemblyBrowserPageContent;
