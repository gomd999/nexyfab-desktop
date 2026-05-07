/**
 * Shared keyboard shortcut configuration.
 * Single-character (non-modifier) keys that the user can rebind.
 * Ctrl/Alt/Shift combos are always fixed (save, undo, etc.).
 */

import { PREF_KEYS, prefGetJson, prefSetJson } from '@/lib/platform';

export const SHORTCUT_LS_KEY = PREF_KEYS.customShortcuts;

/** Default key for each action ID (uppercase for display, compared case-insensitively) */
export const DEFAULT_SHORTCUTS: Record<string, string> = {
  // ── 3D Viewport ────────────────────────────────────────────────────────────
  translate:       'T',
  rotate:          'R',
  scale:           'G',
  measure:         'M',
  dims:            'D',
  view_fit:        'F',
  perf:            'P',
  sketch:          'S',
  // ── Sketch tools (active in sketch mode only) ──────────────────────────────
  sk_line:         'L',
  sk_arc:          'A',
  sk_circle:       'C',
  sk_rect:         'R',
  sk_polygon:      'P',
  sk_ellipse:      'E',
  sk_slot:         'U',
  sk_fillet:       'F',
  sk_mirror:       'K',
  sk_construction: 'Q',
  sk_spline:       'B',
  sk_offset:       'O',
  sk_trim:         'X',
  sk_select:       'V',
  sk_dimension:    'N',
};

export function loadCustomShortcuts(): Record<string, string> {
  return prefGetJson<Record<string, string>>(PREF_KEYS.customShortcuts) ?? {};
}

export function saveCustomShortcuts(map: Record<string, string>): void {
  prefSetJson(PREF_KEYS.customShortcuts, map);
}

/**
 * Returns the effective key for an action (custom override or default), lowercased.
 * Pass the current custom map to avoid repeated localStorage reads.
 */
export function getEffectiveKey(
  actionId: string,
  custom: Record<string, string>,
): string {
  return (custom[actionId] ?? DEFAULT_SHORTCUTS[actionId] ?? '').toLowerCase();
}
