/**
 * Preferences bridge: localStorage today; swap for Tauri plugin-store or
 * fs-backed config later without touching call sites.
 */

export const PREF_KEY_CAM_POST = 'nexyfab.cam.post';

/** Stable keys for grep / migration — keep values identical to legacy strings. */
export const PREF_KEYS = {
  camPost: PREF_KEY_CAM_POST,
  recentImportFiles: 'nf_recent_files',
  shapeFavorites: 'nf_shape_favorites',
  shapeRecent: 'nf_shape_recent',
  sidebarLayout: 'nf_sg_sidebar_v1',
  designPreviewWidth: 'nf_design_preview_width',
  commandPaletteRecent: 'nexyfab-command-palette-recent',
  customShortcuts: 'nexyfab_shortcuts',
  cloudProjectId: 'nexyfab-cloud-project-id',
  /** Tauri: first-run welcome wizard completed (web ignores). */
  desktopFirstRunDone: 'nexyfab-desktop-first-run-v1',
  /** Optional anonymous product-improvement signal (stored only; wire to analytics later). */
  telemetryOptIn: 'nexyfab-telemetry-opt-in',
} as const;

export function prefGetString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function prefSetString(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

export function prefRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function prefGetJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function prefSetJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}
