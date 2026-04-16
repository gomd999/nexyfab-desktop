'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { DesignBranch, BranchState, BranchDiff } from './DesignBranch';
import { BRANCH_COLORS, DEFAULT_BRANCH_ID, createDefaultBranch } from './DesignBranch';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DesignVersion {
  id: string;
  timestamp: number;
  label: string;           // user-editable label
  autoLabel: string;       // auto-generated: "Added fillet", "Changed width to 50"
  shapeId: string;
  params: Record<string, number>;
  features: Array<{ type: string; params: Record<string, number>; enabled: boolean }>;
  thumbnail?: string;      // base64 data URL from canvas snapshot
  branchId?: string;       // which branch this version belongs to
}

interface VersionMeta {
  id: string;
  timestamp: number;
  label: string;
  autoLabel: string;
  shapeId: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'nexyfab-version-';
const META_KEY = 'nexyfab-version-meta';
const BRANCH_KEY = 'nexyfab-branch-state';
const MAX_VERSIONS = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getMetaList(): VersionMeta[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as VersionMeta[];
  } catch {
    return [];
  }
}

function setMetaList(list: VersionMeta[]) {
  localStorage.setItem(META_KEY, JSON.stringify(list));
}

function loadVersion(id: string): DesignVersion | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw) as DesignVersion;
  } catch {
    return null;
  }
}

function storeVersion(v: DesignVersion) {
  localStorage.setItem(`${STORAGE_PREFIX}${v.id}`, JSON.stringify(v));
}

function removeVersionStorage(id: string) {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
  } catch {
    /* ignore */
  }
}

function loadBranchState(): BranchState {
  try {
    const raw = localStorage.getItem(BRANCH_KEY);
    if (!raw) {
      const defaultBranch = createDefaultBranch();
      return {
        branches: [defaultBranch],
        activeBranch: DEFAULT_BRANCH_ID,
        branchVersions: { [DEFAULT_BRANCH_ID]: [] },
      };
    }
    return JSON.parse(raw) as BranchState;
  } catch {
    const defaultBranch = createDefaultBranch();
    return {
      branches: [defaultBranch],
      activeBranch: DEFAULT_BRANCH_ID,
      branchVersions: { [DEFAULT_BRANCH_ID]: [] },
    };
  }
}

function saveBranchState(state: BranchState) {
  localStorage.setItem(BRANCH_KEY, JSON.stringify(state));
}

function genBranchId(): string {
  return `branch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function pruneVersions(meta: VersionMeta[]): VersionMeta[] {
  if (meta.length <= MAX_VERSIONS) return meta;
  const sorted = [...meta].sort((a, b) => b.timestamp - a.timestamp);
  const removed = sorted.slice(MAX_VERSIONS);
  removed.forEach(m => removeVersionStorage(m.id));
  return sorted.slice(0, MAX_VERSIONS);
}

/** Generate a human-readable label from the diff between two states */
function generateAutoLabel(
  shapeId: string,
  params: Record<string, number>,
  features: Array<{ type: string; params: Record<string, number>; enabled: boolean }>,
  prevVersion: DesignVersion | null,
): string {
  if (!prevVersion) return `Initial: ${shapeId}`;

  const changes: string[] = [];

  // Shape changed
  if (prevVersion.shapeId !== shapeId) {
    changes.push(`Shape -> ${shapeId}`);
  }

  // Param changes
  for (const [key, val] of Object.entries(params)) {
    const prev = prevVersion.params[key];
    if (prev !== undefined && prev !== val) {
      changes.push(`${key}: ${prev} -> ${val}`);
    } else if (prev === undefined) {
      changes.push(`${key} = ${val}`);
    }
  }

  // Feature additions / removals
  const prevTypes = prevVersion.features.map(f => f.type);
  const curTypes = features.map(f => f.type);

  const added = curTypes.filter((t, i) => !prevTypes.includes(t) || i >= prevTypes.length);
  const removed = prevTypes.filter((t, i) => !curTypes.includes(t) || i >= curTypes.length);

  if (added.length > 0 && removed.length === 0) {
    changes.push(`Added ${added.join(', ')}`);
  } else if (removed.length > 0 && added.length === 0) {
    changes.push(`Removed ${removed.join(', ')}`);
  } else if (added.length > 0 && removed.length > 0) {
    changes.push(`+${added.join(',')} -${removed.join(',')}`);
  }

  // Feature enable/disable changes
  const minLen = Math.min(prevVersion.features.length, features.length);
  for (let i = 0; i < minLen; i++) {
    if (prevVersion.features[i].type === features[i].type && prevVersion.features[i].enabled !== features[i].enabled) {
      changes.push(`${features[i].enabled ? 'Enabled' : 'Disabled'} ${features[i].type}`);
    }
  }

  if (changes.length === 0) return 'No visible changes';
  // Limit to 2 most important changes
  return changes.slice(0, 2).join('; ');
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useVersionHistory() {
  const [versions, setVersions] = useState<DesignVersion[]>([]);
  const [branches, setBranches] = useState<DesignBranch[]>([]);
  const [activeBranch, setActiveBranch] = useState<string>(DEFAULT_BRANCH_ID);
  const loadedRef = useRef(false);

  // Load all versions and branches on mount
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    // Load branch state
    const bs = loadBranchState();
    setBranches(bs.branches);
    setActiveBranch(bs.activeBranch);

    // Load all versions
    const meta = getMetaList();
    const sorted = [...meta].sort((a, b) => b.timestamp - a.timestamp);
    const loaded: DesignVersion[] = [];
    for (const m of sorted) {
      const v = loadVersion(m.id);
      if (v) loaded.push(v);
    }

    // Migrate: assign branchId to old versions that lack one
    let migrated = false;
    for (const v of loaded) {
      if (!v.branchId) {
        v.branchId = DEFAULT_BRANCH_ID;
        storeVersion(v);
        migrated = true;
      }
    }
    if (migrated) {
      // Update branchVersions
      const ids = loaded.filter(v => v.branchId === DEFAULT_BRANCH_ID).map(v => v.id);
      bs.branchVersions[DEFAULT_BRANCH_ID] = ids;
      saveBranchState(bs);
    }

    setVersions(loaded);
  }, []);

  /** Get versions for a specific branch */
  const getVersionsForBranch = useCallback((branchId: string): DesignVersion[] => {
    return versions.filter(v => (v.branchId || DEFAULT_BRANCH_ID) === branchId);
  }, [versions]);

  /** Save a new version snapshot */
  const saveVersion = useCallback((
    shapeId: string,
    params: Record<string, number>,
    features: Array<{ type: string; params: Record<string, number>; enabled: boolean }>,
    thumbnail?: string,
    customLabel?: string,
  ): DesignVersion => {
    const id = genId();
    const timestamp = Date.now();

    // Get the latest version on active branch for diff-based auto-label
    const meta = getMetaList();
    const sortedMeta = [...meta].sort((a, b) => b.timestamp - a.timestamp);
    const prevVersion = sortedMeta.length > 0 ? loadVersion(sortedMeta[0].id) : null;

    const autoLabel = generateAutoLabel(shapeId, params, features, prevVersion);

    const currentBranch = activeBranch;

    const version: DesignVersion = {
      id,
      timestamp,
      label: customLabel || '',
      autoLabel,
      shapeId,
      params: { ...params },
      features: features.map(f => ({ type: f.type, params: { ...f.params }, enabled: f.enabled })),
      thumbnail,
      branchId: currentBranch,
    };

    storeVersion(version);

    const newMeta: VersionMeta = { id, timestamp, label: version.label, autoLabel, shapeId };
    meta.push(newMeta);
    const pruned = pruneVersions(meta);
    setMetaList(pruned);

    // Update branch state
    const bs = loadBranchState();
    if (!bs.branchVersions[currentBranch]) bs.branchVersions[currentBranch] = [];
    bs.branchVersions[currentBranch].push(id);
    saveBranchState(bs);

    setVersions(prev => {
      const updated = [version, ...prev];
      if (updated.length > MAX_VERSIONS) updated.length = MAX_VERSIONS;
      return updated;
    });

    return version;
  }, [activeBranch]);

  /** Restore a version — returns its full data so the caller can apply it.
   *  Dispatches 'nexyfab:scene-cleanup' so ShapePreview can dispose GPU
   *  resources before the new scene data is applied. */
  const restoreVersion = useCallback((id: string): DesignVersion | null => {
    window.dispatchEvent(new CustomEvent('nexyfab:scene-cleanup'));
    const v = loadVersion(id);
    return v;
  }, []);

  /** Delete a version */
  const deleteVersion = useCallback((id: string) => {
    removeVersionStorage(id);
    const meta = getMetaList().filter(m => m.id !== id);
    setMetaList(meta);

    // Remove from branch state
    const bs = loadBranchState();
    for (const branchId of Object.keys(bs.branchVersions)) {
      bs.branchVersions[branchId] = bs.branchVersions[branchId].filter(vid => vid !== id);
    }
    saveBranchState(bs);

    setVersions(prev => prev.filter(v => v.id !== id));
  }, []);

  /** Rename a version (user-editable label) */
  const renameVersion = useCallback((id: string, newLabel: string) => {
    const v = loadVersion(id);
    if (v) {
      v.label = newLabel;
      storeVersion(v);
    }
    const meta = getMetaList();
    const idx = meta.findIndex(m => m.id === id);
    if (idx >= 0) {
      meta[idx].label = newLabel;
      setMetaList(meta);
    }
    setVersions(prev => prev.map(ver => ver.id === id ? { ...ver, label: newLabel } : ver));
  }, []);

  // ─── Branch Management ──────────────────────────────────────────────────────

  /** Create a new branch, optionally forking from a specific version */
  const createBranch = useCallback((name: string, fromVersionId?: string): DesignBranch => {
    const bs = loadBranchState();
    const colorIdx = bs.branches.length % BRANCH_COLORS.length;
    const newBranch: DesignBranch = {
      id: genBranchId(),
      name,
      parentBranch: activeBranch,
      forkVersionId: fromVersionId,
      color: BRANCH_COLORS[colorIdx],
      createdAt: Date.now(),
    };

    bs.branches.push(newBranch);
    bs.branchVersions[newBranch.id] = [];

    // If forking from a version, copy that version (and its ancestors on the parent branch) into the new branch
    if (fromVersionId) {
      const parentVersions = (bs.branchVersions[activeBranch] || []).slice();
      const forkIdx = parentVersions.indexOf(fromVersionId);
      if (forkIdx >= 0) {
        // Copy versions up to and including the fork point
        const copiedIds = parentVersions.slice(0, forkIdx + 1);
        bs.branchVersions[newBranch.id] = [...copiedIds];
      }
    }

    // Switch to the new branch
    bs.activeBranch = newBranch.id;
    saveBranchState(bs);

    setBranches([...bs.branches]);
    setActiveBranch(newBranch.id);

    return newBranch;
  }, [activeBranch]);

  /** Switch to a different branch.
   *  Dispatches 'nexyfab:scene-cleanup' so ShapePreview can dispose GPU
   *  resources before the branch's scene data is applied. */
  const switchBranch = useCallback((branchId: string): DesignVersion | null => {
    const bs = loadBranchState();
    const branch = bs.branches.find(b => b.id === branchId);
    if (!branch) return null;

    window.dispatchEvent(new CustomEvent('nexyfab:scene-cleanup'));
    bs.activeBranch = branchId;
    saveBranchState(bs);
    setActiveBranch(branchId);

    // Return the latest version on the target branch so the caller can restore it
    const branchVersionIds = bs.branchVersions[branchId] || [];
    if (branchVersionIds.length === 0) return null;

    const lastId = branchVersionIds[branchVersionIds.length - 1];
    return loadVersion(lastId);
  }, []);

  /** Delete a branch (cannot delete main) */
  const deleteBranch = useCallback((branchId: string): boolean => {
    if (branchId === DEFAULT_BRANCH_ID) return false;

    const bs = loadBranchState();
    bs.branches = bs.branches.filter(b => b.id !== branchId);

    // Remove version-to-branch mappings (but don't delete the version data itself
    // — versions may be shared with parent branch via fork copy)
    const branchOnlyVersions = bs.branchVersions[branchId] || [];
    // Find versions that only exist on this branch
    const otherBranchVersionIds = new Set<string>();
    for (const [bid, vids] of Object.entries(bs.branchVersions)) {
      if (bid !== branchId) vids.forEach(vid => otherBranchVersionIds.add(vid));
    }
    // Delete versions exclusive to this branch
    for (const vid of branchOnlyVersions) {
      if (!otherBranchVersionIds.has(vid)) {
        removeVersionStorage(vid);
        const meta = getMetaList().filter(m => m.id !== vid);
        setMetaList(meta);
      }
    }

    delete bs.branchVersions[branchId];

    // If active branch was deleted, switch to main
    if (bs.activeBranch === branchId) {
      bs.activeBranch = DEFAULT_BRANCH_ID;
      setActiveBranch(DEFAULT_BRANCH_ID);
    }

    saveBranchState(bs);
    setBranches([...bs.branches]);

    // Update versions state
    setVersions(prev => prev.filter(v => {
      if ((v.branchId || DEFAULT_BRANCH_ID) === branchId && !otherBranchVersionIds.has(v.id)) return false;
      return true;
    }));

    return true;
  }, []);

  /** Merge: take latest version from source branch and apply it to target branch */
  const mergeBranch = useCallback((sourceBranchId: string, targetBranchId: string): DesignVersion | null => {
    const bs = loadBranchState();
    const sourceVersionIds = bs.branchVersions[sourceBranchId] || [];
    if (sourceVersionIds.length === 0) return null;

    const latestSourceId = sourceVersionIds[sourceVersionIds.length - 1];
    const sourceVersion = loadVersion(latestSourceId);
    if (!sourceVersion) return null;

    // Create a new version on the target branch based on the source's latest
    const id = genId();
    const timestamp = Date.now();
    const sourceBranch = bs.branches.find(b => b.id === sourceBranchId);
    const mergeLabel = `Merge from ${sourceBranch?.name || sourceBranchId}`;

    const mergedVersion: DesignVersion = {
      id,
      timestamp,
      label: mergeLabel,
      autoLabel: mergeLabel,
      shapeId: sourceVersion.shapeId,
      params: { ...sourceVersion.params },
      features: sourceVersion.features.map(f => ({ type: f.type, params: { ...f.params }, enabled: f.enabled })),
      thumbnail: sourceVersion.thumbnail,
      branchId: targetBranchId,
    };

    storeVersion(mergedVersion);

    const meta = getMetaList();
    meta.push({ id, timestamp, label: mergeLabel, autoLabel: mergeLabel, shapeId: mergedVersion.shapeId });
    const pruned = pruneVersions(meta);
    setMetaList(pruned);

    if (!bs.branchVersions[targetBranchId]) bs.branchVersions[targetBranchId] = [];
    bs.branchVersions[targetBranchId].push(id);
    saveBranchState(bs);

    setVersions(prev => {
      const updated = [mergedVersion, ...prev];
      if (updated.length > MAX_VERSIONS) updated.length = MAX_VERSIONS;
      return updated;
    });

    return mergedVersion;
  }, []);

  /** Compare the tips (latest versions) of two branches */
  const compareBranches = useCallback((branchAId: string, branchBId: string): BranchDiff | null => {
    const bs = loadBranchState();
    const aVersionIds = bs.branchVersions[branchAId] || [];
    const bVersionIds = bs.branchVersions[branchBId] || [];

    const versionA = aVersionIds.length > 0 ? loadVersion(aVersionIds[aVersionIds.length - 1]) : null;
    const versionB = bVersionIds.length > 0 ? loadVersion(bVersionIds[bVersionIds.length - 1]) : null;

    if (!versionA && !versionB) return null;

    const paramsA = versionA?.params || {};
    const paramsB = versionB?.params || {};
    const allKeys = new Set([...Object.keys(paramsA), ...Object.keys(paramsB)]);
    const paramDiffs: BranchDiff['paramDiffs'] = [];
    for (const key of allKeys) {
      const valA = paramsA[key];
      const valB = paramsB[key];
      if (valA !== valB) {
        paramDiffs.push({ key, valueA: valA, valueB: valB });
      }
    }

    return {
      branchA: branchAId,
      branchB: branchBId,
      paramDiffs,
      featureDiffsA: versionA?.features || [],
      featureDiffsB: versionB?.features || [],
      shapeA: versionA?.shapeId || '',
      shapeB: versionB?.shapeId || '',
      thumbnailA: versionA?.thumbnail,
      thumbnailB: versionB?.thumbnail,
    };
  }, []);

  return {
    versions,
    saveVersion,
    restoreVersion,
    deleteVersion,
    renameVersion,
    // Branch management
    branches,
    activeBranch,
    createBranch,
    switchBranch,
    mergeBranch,
    deleteBranch,
    compareBranches,
    getVersionsForBranch,
  };
}
