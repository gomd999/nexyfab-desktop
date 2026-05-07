'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type DfmStatus = 'ok' | 'warn' | 'error';

export interface DfmWarningsState {
  issues: number;
  warnings: number;
  status: DfmStatus;
  loading: boolean;
  items: Array<{ level: 'error' | 'warning' | 'info'; param: string; message: string; value?: number }>;
}

const INITIAL_STATE: DfmWarningsState = {
  issues: 0,
  warnings: 0,
  status: 'ok',
  loading: false,
  items: [],
};

/**
 * useDfmWarnings
 *
 * Debounces `designParams` by 800ms, then calls POST /api/nexyfab/dfm-check.
 * Returns `{ issues, warnings, status, loading, items }`.
 *
 * `designParams` should be a flat Record<string, number> of current shape params.
 * Pass `null` to skip (e.g. when no geometry exists yet).
 */
export function useDfmWarnings(
  designParams: Record<string, number> | null,
  debounceMs = 800,
): DfmWarningsState {
  const [state, setState] = useState<DfmWarningsState>(INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runCheck = useCallback(async (params: Record<string, number>) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState(s => ({ ...s, loading: true }));

    try {
      const res = await fetch('/api/nexyfab/dfm-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: ac.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const issues: number = data.issues ?? 0;
      const warnings: number = data.warnings ?? 0;
      const items = data.items ?? [];

      const status: DfmStatus = issues > 0 ? 'error' : warnings > 0 ? 'warn' : 'ok';
      setState({ issues, warnings, status, loading: false, items });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return; // cancelled — don't update state
      setState(s => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!designParams || Object.keys(designParams).length === 0) {
      setState(INITIAL_STATE);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      runCheck(designParams);
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [designParams, debounceMs, runCheck]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return state;
}
