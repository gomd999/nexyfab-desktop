'use client';

/**
 * useDesignPreviewWidth — encapsulates the resizable design-preview pane width.
 *
 * Extracted verbatim from the ShapeGeneratorInner monolith: a single width
 * state, persistence via platform prefs, a window-resize re-clamp, and the
 * splitter drag handler. Self-contained — no CAD/scene state — so it lifts out
 * with zero behaviour change.
 */

import { useCallback, useEffect, useState } from 'react';
import { prefGetString, prefSetString, PREF_KEYS } from '@/lib/platform';

export const DESIGN_PREVIEW_MIN = 260;
export const DESIGN_PREVIEW_MAX_CAP = 920;

/** Clamp a requested width into the viewport-aware allowed range. */
export function clampDesignPreviewWidth(w: number): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const maxW = Math.max(DESIGN_PREVIEW_MIN + 80, Math.min(DESIGN_PREVIEW_MAX_CAP, vw - 320));
  return Math.round(Math.min(maxW, Math.max(DESIGN_PREVIEW_MIN, w)));
}

export interface DesignPreviewWidthState {
  designPreviewWidth: number;
  handleDesignPreviewResize: (next: number) => void;
}

export function useDesignPreviewWidth(): DesignPreviewWidthState {
  const [designPreviewWidth, setDesignPreviewWidth] = useState(380);

  // Restore the persisted width on mount.
  useEffect(() => {
    try {
      const raw = prefGetString(PREF_KEYS.designPreviewWidth);
      if (raw) {
        const v = parseInt(raw, 10);
        if (Number.isFinite(v)) setDesignPreviewWidth(clampDesignPreviewWidth(v));
      }
    } catch { /* ignore */ }
  }, []);

  // Re-clamp when the viewport changes so the pane never exceeds bounds.
  useEffect(() => {
    const onResize = () => setDesignPreviewWidth((w) => clampDesignPreviewWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleDesignPreviewResize = useCallback((next: number) => {
    const c = clampDesignPreviewWidth(next);
    setDesignPreviewWidth(c);
    try {
      prefSetString(PREF_KEYS.designPreviewWidth, String(c));
    } catch { /* ignore */ }
  }, []);

  return { designPreviewWidth, handleDesignPreviewResize };
}
