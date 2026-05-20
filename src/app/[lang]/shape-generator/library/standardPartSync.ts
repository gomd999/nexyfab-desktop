/**
 * standardPartSync.ts — Sync local standard-parts cache with a remote
 * catalog (e.g., shop's central library or supplier feed).
 *
 * Shops maintain a list of approved parts (fasteners, bearings,
 * o-rings) that pass internal QA. The local CAD cache needs to
 * stay in sync with that central library:
 *
 *   - **Pull** new entries (parts added in remote).
 *   - **Update** modified entries (price/spec change).
 *   - **Mark obsolete** entries (removed in remote).
 *   - **Conflict resolution** when both local and remote changed.
 *
 * Module is the *diff + merge* engine; the actual HTTP fetch is the
 * caller's responsibility (network swap-out). Each part has a
 * monotonic `revision` integer for ordering.
 */

export interface StandardPart {
  id: string;
  /** Part number (e.g. "ISO 4762 M6x20"). */
  partNumber: string;
  /** Revision number (monotonic per id). */
  revision: number;
  /** Catalog category. */
  category: string;
  /** Free-form properties (size, material, etc.). */
  properties: Record<string, string | number>;
  /** Local modifications kept (true if user customized this part). */
  locallyModified?: boolean;
  /** Marked obsolete? */
  obsolete?: boolean;
}

export interface SyncDiff {
  /** Parts added remotely (not in local). */
  added: StandardPart[];
  /** Parts updated (remote revision > local). */
  updated: Array<{ local: StandardPart; remote: StandardPart }>;
  /** Parts marked obsolete remotely. */
  obsoleted: StandardPart[];
  /** Parts in conflict: locallyModified + remote also changed. */
  conflicts: Array<{ local: StandardPart; remote: StandardPart }>;
}

export interface SyncMergeResult {
  /** Merged part list after sync. */
  merged: StandardPart[];
  /** Summary diff before merging. */
  diff: SyncDiff;
  /** Conflict resolutions taken. */
  resolutions: Array<{ id: string; chose: 'local' | 'remote' }>;
}

export interface SyncOptions {
  /** How to resolve conflicts. */
  conflictPolicy: 'prefer-local' | 'prefer-remote' | 'newest-revision';
  /** Drop obsolete entries from merged result. */
  pruneObsolete: boolean;
}

export const DEFAULT_OPTIONS: SyncOptions = {
  conflictPolicy: 'prefer-local',
  pruneObsolete: false,
};

// ── Diff ───────────────────────────────────────────────────────

export function diffCatalog(localParts: StandardPart[], remoteParts: StandardPart[]): SyncDiff {
  const localMap = new Map(localParts.map(p => [p.id, p]));
  const remoteMap = new Map(remoteParts.map(p => [p.id, p]));

  const added: StandardPart[] = [];
  const updated: Array<{ local: StandardPart; remote: StandardPart }> = [];
  const obsoleted: StandardPart[] = [];
  const conflicts: Array<{ local: StandardPart; remote: StandardPart }> = [];

  for (const [id, remote] of remoteMap) {
    const local = localMap.get(id);
    if (!local) {
      added.push(remote);
      continue;
    }
    if (remote.obsolete && !local.obsolete) {
      obsoleted.push(remote);
      continue;
    }
    if (remote.revision > local.revision) {
      if (local.locallyModified) conflicts.push({ local, remote });
      else updated.push({ local, remote });
    }
  }
  return { added, updated, obsoleted, conflicts };
}

// ── Merge ──────────────────────────────────────────────────────

export function mergeCatalog(
  localParts: StandardPart[],
  remoteParts: StandardPart[],
  options: Partial<SyncOptions> = {},
): SyncMergeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const diff = diffCatalog(localParts, remoteParts);
  const result = new Map<string, StandardPart>();
  // Start from local.
  for (const p of localParts) result.set(p.id, p);

  // Apply added.
  for (const p of diff.added) result.set(p.id, p);
  // Apply updated.
  for (const { remote } of diff.updated) {
    result.set(remote.id, remote);
  }
  // Apply obsoleted.
  for (const p of diff.obsoleted) {
    if (opts.pruneObsolete) {
      result.delete(p.id);
    } else {
      result.set(p.id, { ...result.get(p.id)!, obsolete: true });
    }
  }
  // Resolve conflicts per policy.
  const resolutions: Array<{ id: string; chose: 'local' | 'remote' }> = [];
  for (const { local, remote } of diff.conflicts) {
    let pick: 'local' | 'remote';
    switch (opts.conflictPolicy) {
      case 'prefer-local': pick = 'local'; break;
      case 'prefer-remote': pick = 'remote'; break;
      case 'newest-revision': pick = remote.revision > local.revision ? 'remote' : 'local'; break;
    }
    resolutions.push({ id: local.id, chose: pick });
    result.set(local.id, pick === 'local' ? local : remote);
  }

  return { merged: [...result.values()], diff, resolutions };
}

// ── Catalog stats ──────────────────────────────────────────────

export interface CatalogStats {
  totalParts: number;
  obsoleteCount: number;
  locallyModifiedCount: number;
  categories: Record<string, number>;
}

export function statsOf(parts: StandardPart[]): CatalogStats {
  const cats: Record<string, number> = {};
  let obsolete = 0, mod = 0;
  for (const p of parts) {
    cats[p.category] = (cats[p.category] ?? 0) + 1;
    if (p.obsolete) obsolete++;
    if (p.locallyModified) mod++;
  }
  return { totalParts: parts.length, obsoleteCount: obsolete, locallyModifiedCount: mod, categories: cats };
}

// ── Summary ────────────────────────────────────────────────────

export interface SyncSummary {
  addedCount: number;
  updatedCount: number;
  obsoletedCount: number;
  conflictCount: number;
  totalAfterMerge: number;
  noChange: boolean;
}

export function summarize(result: SyncMergeResult): SyncSummary {
  const d = result.diff;
  return {
    addedCount: d.added.length,
    updatedCount: d.updated.length,
    obsoletedCount: d.obsoleted.length,
    conflictCount: d.conflicts.length,
    totalAfterMerge: result.merged.length,
    noChange: d.added.length === 0 && d.updated.length === 0 && d.obsoleted.length === 0 && d.conflicts.length === 0,
  };
}
