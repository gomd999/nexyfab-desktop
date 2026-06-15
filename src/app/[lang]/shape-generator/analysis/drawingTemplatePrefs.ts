/**
 * drawingTemplatePrefs.ts — Phase 6c persistence helper.
 *
 * The host historically inlined a DrawingConfig template literal in
 * two places (assembly export branch + configurations export branch).
 * That hardcoded "first-pass for vendor" default (3-view A4 landscape
 * + dims + centerlines + rev A) ignored user prefs — a customer who
 * always exports to A3 portrait had to re-author the template every
 * session via AutoDrawingPanel.
 *
 * This module centralises the default + provides localStorage-backed
 * load/save + a React hook. Both export bridges (assembly + configs)
 * share the same prefs key, so a single user preference applies
 * everywhere. The AutoDrawingPanel can later wire `saveDrawingTemplate
 * Prefs` to its "Save as default" button to round-trip user choices
 * into this slot.
 *
 * Storage:
 *   - Key: `nexyfab:drawingTemplatePrefs:v1` (versioned so a future
 *     schema bump can migrate cleanly)
 *   - Value: JSON-serialised partial DrawingConfig — only fields the
 *     user overrode get saved. The loader merges the partial onto the
 *     default to guarantee a complete DrawingConfig comes out.
 *   - Corrupted JSON / missing fields → silently fall back to default
 *     (no toast — this is a hint cache, not authoritative state).
 *
 * SSR / Node safety: every storage call is gated by
 * `typeof window !== 'undefined'`. The hook always returns the same
 * default on the server; the first client render reads localStorage
 * via an effect.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DrawingConfig } from './autoDrawing';

export const DRAWING_TEMPLATE_PREFS_STORAGE_KEY = 'nexyfab:drawingTemplatePrefs:v1';

/** Default template — same shape the host used to inline. Public so
 *  callers can compare against it ("user has not customised") and so
 *  the host can fall back synchronously during SSR. */
export const DEFAULT_DRAWING_TEMPLATE: DrawingConfig = {
  views: ['front', 'top', 'right'],
  scale: 1,
  paperSize: 'A4',
  orientation: 'landscape',
  showDimensions: true,
  showCenterlines: true,
  tolerance: { linear: '±0.1', angular: '±1°' },
  titleBlock: {
    partName: 'part',
    material: 'TBD',
    drawnBy: '',
    date: new Date().toISOString().slice(0, 10),
    scale: '1:1',
    revision: 'A',
  },
};

/** Deep-merge a partial onto a complete DrawingConfig. Used by the
 *  loader so a saved partial can override individual fields without
 *  losing required ones. */
function mergeOnto(base: DrawingConfig, partial: Partial<DrawingConfig> | null | undefined): DrawingConfig {
  if (!partial || typeof partial !== 'object') return base;
  return {
    ...base,
    ...partial,
    titleBlock: {
      ...base.titleBlock,
      ...(partial.titleBlock ?? {}),
    },
    ...(partial.tolerance ? { tolerance: partial.tolerance } : {}),
    // Views array: only override when caller provided a non-empty array
    views: Array.isArray(partial.views) && partial.views.length > 0
      ? partial.views
      : base.views,
  };
}

/** Read prefs from localStorage. Returns the default when storage is
 *  unavailable, missing, or corrupted. NEVER throws — UI never wants
 *  a prefs cache failure to surface. */
export function loadDrawingTemplatePrefs(
  defaultTemplate: DrawingConfig = DEFAULT_DRAWING_TEMPLATE,
): DrawingConfig {
  if (typeof window === 'undefined') return defaultTemplate;
  try {
    const raw = window.localStorage.getItem(DRAWING_TEMPLATE_PREFS_STORAGE_KEY);
    if (!raw) return defaultTemplate;
    const parsed = JSON.parse(raw) as Partial<DrawingConfig>;
    return mergeOnto(defaultTemplate, parsed);
  } catch {
    return defaultTemplate;
  }
}

/** Persist prefs. Saves the full DrawingConfig (callers are typically
 *  saving the user's "now make this the default" choice, so full is
 *  fine — the storage cost is negligible). NEVER throws. */
export function saveDrawingTemplatePrefs(template: DrawingConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      DRAWING_TEMPLATE_PREFS_STORAGE_KEY,
      JSON.stringify(template),
    );
  } catch {
    // Storage quota / disabled → silently swallow
  }
}

/** Clear prefs (revert to in-code default on next load). */
export function clearDrawingTemplatePrefs(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAWING_TEMPLATE_PREFS_STORAGE_KEY);
  } catch {
    // Storage disabled → silently swallow
  }
}

/** React hook — returns [template, setTemplate]. Synchronous default
 *  on first render (SSR-safe); reads localStorage on mount and
 *  persists on every setTemplate call. */
export function useDrawingTemplatePrefs(): [
  DrawingConfig,
  (next: DrawingConfig) => void,
] {
  const [template, setTemplateState] = useState<DrawingConfig>(DEFAULT_DRAWING_TEMPLATE);

  // Effect-based localStorage read so the first paint matches the server
  // render (SSR-safe). After mount we hydrate from prefs.
  useEffect(() => {
    setTemplateState(loadDrawingTemplatePrefs(DEFAULT_DRAWING_TEMPLATE));
  }, []);

  const setTemplate = useCallback((next: DrawingConfig): void => {
    setTemplateState(next);
    saveDrawingTemplatePrefs(next);
  }, []);

  return [template, setTemplate];
}
