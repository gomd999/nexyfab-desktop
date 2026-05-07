'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AutoSaveState {
  version: 1;
  timestamp: number;
  selectedId: string;
  params: Record<string, number>;
  features: Array<{ type: string; params: Record<string, number>; enabled: boolean }>;
  isSketchMode: boolean;
  sketchProfile?: { segments: unknown[]; closed: boolean };
  sketchConfig?: unknown;
  activeTab: 'design' | 'optimize';
  /** Ribbon workspace id (optional — older saves omit). */
  cadWorkspace?: string;
  /** Scene render mode (optional — older saves omit). */
  renderMode?: 'standard' | 'photorealistic';
  /** AI 채팅 히스토리 (최대 60개) */
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface SaveSlotMeta {
  key: string;
  timestamp: number;
  selectedId: string;
  isSketchMode: boolean;
}

const STORAGE_PREFIX = 'nexyfab-autosave-';
const META_KEY = 'nexyfab-autosave-meta';
const MAX_SLOTS = 5;
const DEBOUNCE_MS = 30_000; // 30 seconds
const MAX_SAVE_BYTES = 4_500_000; // 4.5 MB guard

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMetaList(): SaveSlotMeta[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SaveSlotMeta[];
  } catch {
    return [];
  }
}

function setMetaList(list: SaveSlotMeta[]) {
  localStorage.setItem(META_KEY, JSON.stringify(list));
}

function pruneSlots(list: SaveSlotMeta[]): SaveSlotMeta[] {
  if (list.length <= MAX_SLOTS) return list;
  const sorted = [...list].sort((a, b) => b.timestamp - a.timestamp);
  const removed = sorted.slice(MAX_SLOTS);
  removed.forEach(m => {
    try { localStorage.removeItem(m.key); } catch { /* ignore */ }
  });
  return sorted.slice(0, MAX_SLOTS);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAutoSave() {
  const [hasRecovery, setHasRecovery] = useState(false);
  const [recoveryData, setRecoveryData] = useState<AutoSaveState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStateRef = useRef<AutoSaveState | null>(null);

  // Guard against state updates after unmount
  const isMounted = useRef(true);
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  // On mount, check for existing saves; clean up debounce timer on unmount
  useEffect(() => {
    const meta = getMetaList();
    if (meta.length === 0) return;
    const sorted = [...meta].sort((a, b) => b.timestamp - a.timestamp);
    const latestMeta = sorted[0];
    try {
      const raw = localStorage.getItem(latestMeta.key);
      if (raw) {
        const data = JSON.parse(raw) as AutoSaveState;
        if (data.version === 1) {
          setRecoveryData(data);
          setHasRecovery(true);
        }
      }
    } catch {
      // corrupted save — ignore
    }
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  /** Immediately persist current state to localStorage */
  const save = useCallback((state: AutoSaveState) => {
    if (isMounted.current) setIsSaving(true);
    try {
      const ts = Date.now();
      const key = `${STORAGE_PREFIX}${ts}`;
      const payload: AutoSaveState = { ...state, version: 1, timestamp: ts };

      // Guard against oversized payloads before writing
      const serialized = JSON.stringify(payload);
      if (serialized.length > MAX_SAVE_BYTES) {
        console.warn('[AutoSave] State too large to save:', serialized.length, 'bytes');
        if (isMounted.current) {
          setSaveError('저장 데이터가 너무 큽니다 (4.5MB 초과)');
        }
        return;
      }

      localStorage.setItem(key, serialized);

      const meta = getMetaList();
      meta.push({
        key,
        timestamp: ts,
        selectedId: state.selectedId,
        isSketchMode: state.isSketchMode,
      });
      const pruned = pruneSlots(meta);
      setMetaList(pruned);
      if (isMounted.current) {
        setLastSavedAt(ts);
        setSaveError(null);
      }
    } catch (err) {
      console.error('[AutoSave] localStorage write failed:', err);
      if (isMounted.current) {
        setSaveError(
          err instanceof DOMException && err.name === 'QuotaExceededError'
            ? 'Storage quota exceeded — auto-save unavailable'
            : 'Auto-save failed — localStorage may be unavailable',
        );
      }
    } finally {
      if (isMounted.current) setIsSaving(false);
    }
  }, []);

  /** Schedule a debounced save (resets timer on each call) */
  const scheduleSave = useCallback((state: AutoSaveState) => {
    latestStateRef.current = state;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      // Guard: skip if component has unmounted by the time the timer fires
      if (isMounted.current && latestStateRef.current) {
        save(latestStateRef.current);
      }
    }, DEBOUNCE_MS);
  }, [save]);

  /** Save immediately — for significant actions */
  const saveNow = useCallback((state: AutoSaveState) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    save(state);
  }, [save]);

  /** Load the latest save from localStorage */
  const loadLatest = useCallback((): AutoSaveState | null => {
    const meta = getMetaList();
    if (meta.length === 0) return null;
    const sorted = [...meta].sort((a, b) => b.timestamp - a.timestamp);
    try {
      const raw = localStorage.getItem(sorted[0].key);
      if (!raw) return null;
      const data = JSON.parse(raw) as AutoSaveState;
      return data.version === 1 ? data : null;
    } catch {
      return null;
    }
  }, []);

  /** List all save slots with metadata */
  const listSaves = useCallback((): SaveSlotMeta[] => {
    return [...getMetaList()].sort((a, b) => b.timestamp - a.timestamp);
  }, []);

  /** Delete a specific save by key */
  const deleteSave = useCallback((key: string) => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    const meta = getMetaList().filter(m => m.key !== key);
    setMetaList(meta);
    // If we deleted the one we were showing recovery for, clear recovery
    if (recoveryData && `${STORAGE_PREFIX}${recoveryData.timestamp}` === key) {
      setHasRecovery(false);
      setRecoveryData(null);
    }
  }, [recoveryData]);

  /** Clear all auto-save data */
  const clearAllSaves = useCallback(() => {
    const meta = getMetaList();
    meta.forEach(m => {
      try { localStorage.removeItem(m.key); } catch { /* ignore */ }
    });
    try { localStorage.removeItem(META_KEY); } catch { /* ignore */ }
    setHasRecovery(false);
    setRecoveryData(null);
  }, []);

  /** Dismiss the recovery banner without restoring */
  const dismissRecovery = useCallback(() => {
    setHasRecovery(false);
    setRecoveryData(null);
    // Delete all old saves so user isn't prompted again
    clearAllSaves();
  }, [clearAllSaves]);

  // Cleanup debounce timer on unmount (secondary guard — primary is in isMounted)
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return {
    hasRecovery,
    recoveryData,
    saveError,
    lastSavedAt,
    isSaving,
    save: saveNow,
    scheduleSave,
    loadLatest,
    listSaves,
    deleteSave,
    dismissRecovery,
    clearAllSaves,
  };
}
