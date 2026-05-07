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
import { PREF_KEYS, prefGetString, prefSetString, prefRemove } from '@/lib/platform';
import type { AutoSaveState } from './useAutoSave';
import { useCloudProjectAccessStore } from './store/cloudProjectAccessStore';

export type CloudSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
const DEBOUNCE_MS = 10_000; // 10s

export interface UseCloudSaveFlowResult {
  cloudStatus: CloudSyncStatus;
  projectId: string | null;
  cloudSavedAt: number | null;
  cloudError: string | null;
  /** PATCH 409 `PROJECT_VERSION_CONFLICT` 직후 — UI에서 서버 최신본으로 리로드 유도 */
  versionConflictNeedsReload: boolean;
  syncNow: (state: AutoSaveState, shapeId: string, materialId: string) => void;
  scheduleSync: (state: AutoSaveState, shapeId: string, materialId: string) => void;
  /** Adopt a server project id (e.g. dashboard ?projectId=) so PATCH targets the right row */
  adoptProjectId: (id: string | null, serverUpdatedAt?: number | null) => void;
  /** 서버 `updatedAt`과 씬을 다시 맞추기 위해 동일 URL에 `projectId`를 붙여 전체 리로드 */
  reloadToFetchServerProject: () => void;
}

export function useCloudSaveFlow(isLoggedIn: boolean): UseCloudSaveFlowResult {
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>('idle');
  const [projectId, setProjectId] = useState<string | null>(() => prefGetString(PREF_KEYS.cloudProjectId));
  const [cloudSavedAt, setCloudSavedAt] = useState<number | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [versionConflictNeedsReload, setVersionConflictNeedsReload] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  const pendingRef = useRef<{ state: AutoSaveState; shapeId: string; materialId: string } | null>(null);
  const lastServerUpdatedAtRef = useRef<number | null>(null);

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

    const acc = useCloudProjectAccessStore.getState();
    if (acc.hydrated && !acc.canEdit) {
      if (isMounted.current) {
        setCloudStatus('idle');
        setVersionConflictNeedsReload(false);
        const ko =
          typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ko');
        setCloudError(
          ko
            ? '이 프로젝트는 보기 전용입니다. 클라우드 자동 저장이 비활성화됩니다.'
            : 'This project is read-only. Cloud autosave is disabled.',
        );
      }
      return;
    }

    setCloudStatus('syncing');
    setCloudError(null);

    const sceneData = JSON.stringify(state);
    const currentProjectId = projectId ?? prefGetString(PREF_KEYS.cloudProjectId);

    try {
      if (currentProjectId) {
        // Update existing project
        const patchBody: Record<string, unknown> = { shapeId, materialId, sceneData };
        if (lastServerUpdatedAtRef.current != null) {
          patchBody.ifMatchUpdatedAt = lastServerUpdatedAtRef.current;
        }
        const res = await fetch(`/api/nexyfab/projects/${currentProjectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        });
        if (!res.ok && res.status === 404) {
          // Project was deleted — create new one
          prefRemove(PREF_KEYS.cloudProjectId);
          setProjectId(null);
          lastServerUpdatedAtRef.current = null;
          setVersionConflictNeedsReload(false);
          useCloudProjectAccessStore.getState().reset();
          await doSync(state, shapeId, materialId);
          return;
        }
        const patchData = await res.json().catch(() => ({})) as {
          error?: string;
          code?: string;
          project?: { id: string; updatedAt: number };
          serverUpdatedAt?: number;
          clientExpected?: number;
        };
        if (!res.ok) {
          if (res.status === 403 && patchData.code === 'PROJECT_READ_ONLY' && isMounted.current) {
            useCloudProjectAccessStore.getState().setFromApiProject(currentProjectId, {
              role: 'viewer',
              canEdit: false,
            });
            setCloudStatus('idle');
            const ko =
              typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ko');
            setCloudError(
              ko
                ? '이 프로젝트는 보기 전용입니다. 저장할 수 없습니다.'
                : 'This project is read-only. Save was skipped.',
            );
            setVersionConflictNeedsReload(false);
            return;
          }
          if (res.status === 409 && patchData.code === 'PROJECT_VERSION_CONFLICT' && isMounted.current) {
            setCloudStatus('error');
            setVersionConflictNeedsReload(true);
            if (
              typeof patchData.serverUpdatedAt === 'number' &&
              Number.isFinite(patchData.serverUpdatedAt)
            ) {
              lastServerUpdatedAtRef.current = patchData.serverUpdatedAt;
            }
            const ko =
              typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ko');
            const meta =
              patchData.serverUpdatedAt != null || patchData.clientExpected != null
                ? ko
                  ? ` (서버 updatedAt: ${patchData.serverUpdatedAt ?? '—'}, 클라이언트 기대: ${patchData.clientExpected ?? '—'})`
                  : ` (server updatedAt: ${patchData.serverUpdatedAt ?? '—'}, client expected: ${patchData.clientExpected ?? '—'})`
                : '';
            setCloudError(
              ko
                ? `${patchData.error ?? '버전 충돌'}${meta} — 아래 버튼으로 서버 최신본을 불러오세요.`
                : `${patchData.error ?? 'Version conflict'}${meta} — Use the button below to load the latest from the server.`,
            );
            return;
          }
          throw new Error(patchData.error || `Server ${res.status}`);
        }
        if (patchData.project?.updatedAt != null) {
          lastServerUpdatedAtRef.current = patchData.project.updatedAt;
        }
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
        const data = await res.json() as {
          project?: { id: string; updatedAt: number; role?: 'owner' | 'editor' | 'viewer'; canEdit?: boolean };
          id?: string;
        };
        const newId = data.project?.id ?? (data as { id?: string }).id ?? null;
        if (newId) {
          prefSetString(PREF_KEYS.cloudProjectId, newId);
          if (isMounted.current) setProjectId(newId);
        }
        if (data.project?.updatedAt != null) {
          lastServerUpdatedAtRef.current = data.project.updatedAt;
        }
        if (newId && data.project) {
          useCloudProjectAccessStore.getState().setFromApiProject(newId, {
            role: data.project.role,
            canEdit: data.project.canEdit,
          });
        }
      }

      if (isMounted.current) {
        setCloudStatus('synced');
        setCloudSavedAt(Date.now());
        setVersionConflictNeedsReload(false);
      }
    } catch (err) {
      if (isMounted.current) {
        setCloudStatus('error');
        setVersionConflictNeedsReload(false);
        setCloudError(err instanceof Error ? err.message : 'Cloud save failed');
      }
    }
  }, [isLoggedIn, projectId]);

  const syncNow = useCallback((state: AutoSaveState, shapeId: string, materialId: string) => {
    const acc = useCloudProjectAccessStore.getState();
    if (acc.hydrated && !acc.canEdit) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingRef.current = null;
    void doSync(state, shapeId, materialId);
  }, [doSync]);

  const reloadToFetchServerProject = useCallback(() => {
    if (typeof window === 'undefined') return;
    const id = projectId ?? prefGetString(PREF_KEYS.cloudProjectId);
    if (!id) {
      window.location.reload();
      return;
    }
    const u = new URL(window.location.href);
    u.searchParams.set('projectId', id);
    window.location.assign(u.toString());
  }, [projectId]);

  const adoptProjectId = useCallback((id: string | null, serverUpdatedAt?: number | null) => {
    if (id) prefSetString(PREF_KEYS.cloudProjectId, id);
    else prefRemove(PREF_KEYS.cloudProjectId);
    setProjectId(id);
    if (id === null) {
      lastServerUpdatedAtRef.current = null;
      useCloudProjectAccessStore.getState().reset();
    } else if (typeof serverUpdatedAt === 'number' && Number.isFinite(serverUpdatedAt)) {
      lastServerUpdatedAtRef.current = serverUpdatedAt;
    }
  }, []);

  const scheduleSync = useCallback((state: AutoSaveState, shapeId: string, materialId: string) => {
    if (!isLoggedIn) return;
    const acc = useCloudProjectAccessStore.getState();
    if (acc.hydrated && !acc.canEdit) return;
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

  return {
    cloudStatus,
    projectId,
    cloudSavedAt,
    cloudError,
    versionConflictNeedsReload,
    syncNow,
    scheduleSync,
    adoptProjectId,
    reloadToFetchServerProject,
  };
}
