/**
 * Pending intent stash — sessionStorage-backed.
 *
 * Use case: a Free user clicks "Save" on their 2nd project. The server
 * returns 403, the paywall opens, the user pays, returns. Without this
 * stash the in-flight save payload is gone and the user has to redo
 * whatever they were doing. With this, we save the payload before the
 * paywall fires and re-offer the action when the user returns with a
 * paid plan.
 *
 * Why sessionStorage and not localStorage:
 *   - Pending intents shouldn't outlive the tab — if you closed the tab
 *     you're consciously walking away from the action.
 *   - Cross-tab leakage of "we're about to save your scene" is surprising.
 *
 * Why not React state:
 *   - The Toss/Airwallex redirect tears down the SPA. State doesn't
 *     survive a full page navigation; sessionStorage does.
 */

const STORAGE_KEY = 'nexyfab.pendingIntent';

/** Discriminated union — extend with new kinds as new paywall surfaces appear. */
export type PendingIntent =
  | {
      kind: 'cloud_save_project';
      shapeId: string | null;
      materialId: string | null;
      /** Scene-state JSON; whatever useCloudSaveFlow built for the POST body. */
      sceneData: unknown;
      stashedAt: number;
    }
  // Round 31: extend to other Pro-gated paywall surfaces. The handler in
  // ShapeGeneratorInner reads `kind` and dispatches the appropriate resume.
  // Keep kinds narrow — each new gate gets its own variant so the resume
  // path can carry just the data it needs.
  | {
      kind: 'run_dfm_analysis';
      stashedAt: number;
    }
  | {
      kind: 'run_fea_analysis';
      stashedAt: number;
    }
  | {
      kind: 'export_format';
      format: 'step' | 'dxf' | 'gltf' | 'rhino' | 'grasshopper';
      stashedAt: number;
    }
  | {
      kind: 'request_quote';
      stashedAt: number;
    }
  // Round 33: IP-protected share link generation (Pro feature). Doesn't need
  // payload since the share flow re-derives from the active scene on resume.
  | {
      kind: 'create_share_link';
      stashedAt: number;
    };

export function stashPendingIntent(intent: PendingIntent): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Quota exceeded or sessionStorage disabled — silently drop. The
    // user will simply need to redo the action manually post-upgrade.
  }
}

export function readPendingIntent(): PendingIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingIntent;
    // Expire stale intents — anything older than 1 hour is from a session
    // we don't want to silently resume (different intent, different user, etc.).
    if (typeof parsed?.stashedAt === 'number' && Date.now() - parsed.stashedAt > 60 * 60 * 1000) {
      clearPendingIntent();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingIntent(): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
