'use client';

/**
 * useCloudSaveFlow — localStorage autosave를 서버 API와 동기화
 *
 * - 로그인 상태에서만 활성화 (비로그인 시 localStorage only)
 * - 최초 저장: POST /api/nexyfab/projects → projectId 획득 → localStorage 캐시
 * - 이후 저장: PATCH /api/nexyfab/projects/{id} (sceneData, shapeId, materialId)
 * - 10초 debounce — 너무 잦은 API 호출 방지
 * - Returns: { cloudStatus, projectId, cloudSavedAt }
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { AutoSaveState } from './useAutoSave';

export type CloudSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

const PROJECT_ID_KEY = 'nexyfab-cloud-project-id';
const DEBOUNCE_MS = 10_000; // 10s

export interface UseCloudSaveFlowResult {
  cloudStatus: CloudSyncStatus;
  projectId: string | null;
  cloudSavedAt: number | null;
  cloudError: string | null;
  syncNow: (state: AutoSaveState, shapeId: string, materialId: string) => void;
  scheduleSync: (state: AutoSaveState, shapeId: string, materialId: string) => void;
}

export function useCloudSaveFlow(isLoggedIn: boolean): UseCloudSaveFlowResult {
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>('idle');
  const [projectId, setProjectId] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(PROJECT_ID_KEY);
  });
  const [cloudSavedAt, setCloudSavedAt] = useState<number | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  const pendingRef = useRef<{ state: AutoSaveState; shapeId: string; materialId: string } | null>(null);

  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const doSync = useCallback(async (
    state: AutoSaveState,
    shapeId: string,
    materialId: string,
  ) => {
    if (!isLoggedIn) return;
    if (!isMounted.current) return;

    setCloudStatus('syncing');
    setCloudError(null);

    const sceneData = JSON.stringify(state);
    const currentProjectId = projectId ?? localStorage.getItem(PROJECT_ID_KEY);

    try {
      if (currentProjectId) {
        // Update existing project
        const res = await fetch(`/api/nexyfab/projects/${currentProjectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shapeId, materialId, sceneData }),
        });
        if (!res.ok && res.status === 404) {
          // Project was deleted — create new one
          localStorage.removeItem(PROJECT_ID_KEY);
          setProjectId(null);
          await doSync(state, shapeId, materialId);
          return;
        }
        if (!res.ok) throw new Error(`Server ${res.status}`);
      } else {
        // Create new project
        const res = await fetch('/api/nexyfab/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: shapeId ? `${shapeId} design` : 'Untitled design',
            shapeId,
            materialId,
            sceneData,
          }),
        });
        if (!res.ok) throw new Error(`Server ${res.status}`);
        const data = await res.json() as { project?: { id: string }; id?: string };
        const newId = data.project?.id ?? (data as { id?: string }).id ?? null;
        if (newId) {
          localStorage.setItem(PROJECT_ID_KEY, newId);
          if (isMounted.current) setProjectId(newId);
        }
      }

      if (isMounted.current) {
        setCloudStatus('synced');
        setCloudSavedAt(Date.now());
      }
    } catch (err) {
      if (isMounted.current) {
        setCloudStatus('error');
        setCloudError(err instanceof Error ? err.message : 'Cloud save failed');
      }
    }
  }, [isLoggedIn, projectId]);

  const syncNow = useCallback((state: AutoSaveState, shapeId: string, materialId: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingRef.current = null;
    void doSync(state, shapeId, materialId);
  }, [doSync]);

  const scheduleSync = useCallback((state: AutoSaveState, shapeId: string, materialId: string) => {
    if (!isLoggedIn) return;
    pendingRef.current = { state, shapeId, materialId };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (pendingRef.current && isMounted.current) {
        const { state: s, shapeId: sid, materialId: mid } = pendingRef.current;
        pendingRef.current = null;
        void doSync(s, sid, mid);
      }
    }, DEBOUNCE_MS);
  }, [isLoggedIn, doSync]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { cloudStatus, projectId, cloudSavedAt, cloudError, syncNow, scheduleSync };
}
