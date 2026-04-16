import { useState, useCallback, useRef } from 'react';

export type ContextKey = 'general' | 'sketch' | 'feature' | 'render';

const LS_PREFIX = 'nexyfab_ctx_tip_';

/**
 * Manages context-aware help state.
 * – enterContext: call when the user enters a mode; auto-shows if first time
 * – show / hide: manual control (? key → show)
 * – dismissForever: marks current context as "seen" in localStorage
 */
export function useContextHelp() {
  const [context, setContext] = useState<ContextKey>('general');
  const [visible, setVisible] = useState(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enterContext = useCallback((ctx: ContextKey) => {
    setContext(ctx);
    if (ctx === 'general') { setVisible(false); return; }
    // Clear any pending auto-show
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    try {
      if (!localStorage.getItem(LS_PREFIX + ctx)) {
        // Delay so the UI settles before the panel pops in
        autoTimerRef.current = setTimeout(() => setVisible(true), 500);
      }
    } catch { /* localStorage unavailable */ }
  }, []);

  const leaveContext = useCallback(() => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    setContext('general');
    setVisible(false);
  }, []);

  const show = useCallback((ctx?: ContextKey) => {
    if (ctx) setContext(ctx);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  const dismissForever = useCallback((ctx: ContextKey) => {
    try { localStorage.setItem(LS_PREFIX + ctx, '1'); } catch {}
    setVisible(false);
  }, []);

  /** For dev/debug: clear all seen flags */
  const resetAll = useCallback(() => {
    try {
      (['general', 'sketch', 'feature', 'render'] as ContextKey[])
        .forEach(k => localStorage.removeItem(LS_PREFIX + k));
    } catch {}
  }, []);

  return {
    context, setContext,
    visible,
    enterContext, leaveContext,
    show, hide,
    dismissForever,
    resetAll,
  };
}
