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
 * Default solve fetcher — POSTs the AssemblyState to /api/assembly-solve.
 * Tests inject `onSolve` directly so we never hit the network from jsdom.
 */
const defaultOnSolve: AssemblyBrowserOnSolve = async (state) => {
  const res = await fetch('/api/assembly-solve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state }),
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
  onSolve?: AssemblyBrowserOnSolve;
}

export function AssemblyBrowserPageContent({
  lang,
  initialState,
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
        onClose={onClose}
        onSolve={onSolve ?? defaultOnSolve}
      />
    </main>
  );
}

export default AssemblyBrowserPageContent;
