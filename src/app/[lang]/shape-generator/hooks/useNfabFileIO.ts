'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { useUIStore } from '../store/uiStore';
import { applyCadWorkspace, isCadWorkspaceId } from '../cadWorkspace/applyCadWorkspace';
import { useAuthStore } from '@/hooks/useAuth';
import type { NexyfabProject, NexyfabProjectPatchPayload } from '@/hooks/useProjects';
import { prefGetString, prefSetString, PREF_KEY_CAM_POST } from '@/lib/platform';
import { downloadProjectFile, pickProjectFile, openProjectByPath } from '../io/projectFile';
import {
  serializeProject,
  toJsonString,
  type SerializeInput,
  type NfabAssemblySnapshotV1,
  type NfabConfigurationV1,
  type NfabProjectV1,
  type NfabStudioViewV1,
} from '../io/nfabFormat';
import { usePdmProjectMetaStore } from '../store/pdmProjectMetaStore';
import { useCloudProjectAccessStore } from '../store/cloudProjectAccessStore';
import { SHAPE_MAP, computeSceneParamApply } from '../shapes';
import { useProjectsStore } from '@/hooks/useProjects';
import type { FeatureHistory, HistoryNode } from '../useFeatureStack';
import type { Toast } from '../useToast';

type AddToast = (type: Toast['type'], msg: string, duration?: number, action?: Toast['action']) => void;

function notifyProjectVersionConflict(addToast: AddToast, lang: string, projectId: string) {
  const isKo = lang === 'ko' || lang === 'kr';
  const msg = isKo
    ? '서버에 더 최신 프로젝트가 있습니다(다른 탭·기기에서 먼저 저장됨). 버튼을 누르면 이 탭을 서버 최신본으로 다시 불러옵니다. 이 탭에만 있는 변경은 사라집니다.'
    : 'A newer version exists on the server (saved from another tab or device). Use the button to reload this tab from the server. Changes only in this tab will be lost.';
  addToast(
    'warning',
    msg,
    14_000,
    {
      label: isKo ? '서버에서 다시 불러오기' : 'Reload from server',
      onClick: () => {
        const u = new URL(window.location.href);
        u.searchParams.set('projectId', projectId);
        window.location.assign(u.toString());
      },
    },
  );
}


interface Deps {
  featureHistory: FeatureHistory | null;
  replaceHistory: (nodes: HistoryNode[], rootId: string, activeNodeId: string) => void;
  saveProject: (data: Partial<NexyfabProject>) => Promise<NexyfabProject | null>;
  updateProject: (id: string, data: NexyfabProjectPatchPayload) => Promise<NexyfabProject | null>;
  addToast: AddToast;
  lang: string;
  /** Current assembly snapshot for .nfab / cloud serialize */
  getAssemblySnapshot?: () => NfabAssemblySnapshotV1;
  /** After tree + scene hydrate — restore or clear assembly from file */
  restoreAssemblySnapshot?: (snapshot: NfabAssemblySnapshotV1 | undefined) => void;
  getStudioViewSnapshot?: () => NfabStudioViewV1 | undefined;
  restoreStudioViewSnapshot?: (snapshot: NfabStudioViewV1 | undefined) => void;
  getConfigurationsBlock?: () => {
    configurations: NfabConfigurationV1[];
    activeConfigurationId: string | null;
    /** Session-only master snapshot from
     *  src/app/[lang]/shape-generator/configurations/masterSnapshot.ts.
     *  When `activeConfigurationId !== null` AND this is set, the save
     *  path serializes scene.params + paramExpressions + node.enabled
     *  from the snapshot instead of the (config-mutated) live state. */
    masterSnapshot?: {
      scene: { params: Record<string, number>; paramExpressions: Record<string, string> };
      featureEnabled: Record<string, boolean>;
    } | null;
  };
  restoreConfigurationsSnapshot?: (
    configurations: NfabConfigurationV1[] | undefined,
    activeConfigurationId: string | null | undefined,
  ) => void;
}

/**
 * .nfab native project I/O — local (Tauri) save/load + cloud save + 3-min auto-flush.
 * Owns desktop file path + dirty flag and cloud project id/dirty/saving refs.
 * Call `markDirty()` from a watcher effect when scene state changes.
 */
export function useNfabFileIO(deps: Deps) {
  const {
    featureHistory,
    replaceHistory,
    saveProject,
    updateProject,
    addToast,
    lang,
    getAssemblySnapshot,
    restoreAssemblySnapshot,
    getStudioViewSnapshot,
    restoreStudioViewSnapshot,
    getConfigurationsBlock,
    restoreConfigurationsSnapshot,
  } = deps;

  const [desktopFilePath, setDesktopFilePath] = useState<string | null>(null);
  const [desktopDirty, setDesktopDirty] = useState(false);

  // Manufacturing Route state — persisted in .nfab, restored on load
  const [mfgCamPost, _setMfgCamPost] = useState<string>(() => prefGetString(PREF_KEY_CAM_POST) ?? 'linuxcnc');
  const setMfgCamPost = useCallback((id: string) => {
    _setMfgCamPost(id);
    prefSetString(PREF_KEY_CAM_POST, id);
  }, []);
  const [mfgSmMaterial, setMfgSmMaterial] = useState<string>('mildSteel');
  const [mfgSmThickness, setMfgSmThickness] = useState<number>(2);
  const [mfgSmKFactor, setMfgSmKFactor] = useState<number | null>(null);
  const [mfgCurrency, setMfgCurrency] = useState<string>('KRW');
  const [mfgQuoteQty, setMfgQuoteQty] = useState<number>(1);

  const cloudProjectIdRef = useRef<string | null>(null);
  /** Server `nf_projects.updated_at` from last GET/POST/PATCH — drives optional if-match. */
  const cloudServerUpdatedAtRef = useRef<number | null>(null);
  const cloudDirtyRef = useRef(false);
  const cloudSavingRef = useRef(false);

  const buildSerializeInput = useCallback((): SerializeInput | null => {
    if (!featureHistory) return null;
    const sceneSnapshot = useSceneStore.getState();
    const studioView = getStudioViewSnapshot?.();
    const cfgBlock = getConfigurationsBlock?.();

    // ── Master tree protection (session-only defensive layer).
    // When a non-master config is active AND a master snapshot was
    // captured this session, serialize the MASTER values into scene.params,
    // paramExpressions, and history.nodes[*].enabled — not the live
    // (config-mutated) values. This prevents the .nfab on disk from
    // silently replacing master with the active overlay. Phase 2 deletes
    // this whole branch (pipeline will route through ConfigurationTable
    // and master is never mutated to begin with).
    const useMasterForSave =
      cfgBlock?.activeConfigurationId != null && cfgBlock.masterSnapshot != null;
    const masterScene = useMasterForSave ? cfgBlock.masterSnapshot!.scene : null;
    const masterEnabled = useMasterForSave ? cfgBlock.masterSnapshot!.featureEnabled : null;

    const historyForSave = masterEnabled
      ? {
          ...featureHistory,
          nodes: featureHistory.nodes.map(n => {
            if (n.id === featureHistory.rootId) return n;
            if (n.type === 'baseShape') return n;
            return Object.prototype.hasOwnProperty.call(masterEnabled, n.id)
              ? { ...n, enabled: masterEnabled[n.id]! }
              : n;
          }),
        }
      : featureHistory;

    return {
      name: sceneSnapshot.selectedId || 'nexyfab-project',
      history: historyForSave,
      scene: {
        selectedId: sceneSnapshot.selectedId,
        params: masterScene ? { ...masterScene.params } : sceneSnapshot.params,
        paramExpressions: masterScene ? { ...masterScene.paramExpressions } : sceneSnapshot.paramExpressions,
        materialId: sceneSnapshot.materialId,
        color: sceneSnapshot.color,
        isSketchMode: sceneSnapshot.isSketchMode,
        sketchPlane: sceneSnapshot.sketchPlane,
        sketchProfile: sceneSnapshot.sketchProfile,
        sketchConfig: sceneSnapshot.sketchConfig,
        renderMode: sceneSnapshot.renderMode,
        explodeFactor: sceneSnapshot.explodeFactor,
        sketchViewMode: sceneSnapshot.sketchViewMode,
        ribbonTheme: sceneSnapshot.ribbonTheme,
        // Phase-2 "Sketch on tilted face" frame — without this, reopen
        // would collapse the tilted-face sketch back to the world XY/XZ/YZ
        // plane and the extrude would land in the wrong place.
        sketchFaceFrame: sceneSnapshot.sketchFaceFrame ?? null,
        ...(studioView ? { studioView } : {}),
      },
      manufacturing: {
        camPostProcessorId: mfgCamPost,
        smMaterial: mfgSmMaterial,
        smThickness: mfgSmThickness,
        smKFactorOverride: mfgSmKFactor,
        currency: mfgCurrency,
        quoteQuantity: mfgQuoteQty,
      },
      assembly: getAssemblySnapshot?.(),
      ...(cfgBlock && cfgBlock.configurations.length > 0
        ? {
            configurations: cfgBlock.configurations,
            activeConfigurationId: cfgBlock.activeConfigurationId,
          }
        : {}),
      meta: (() => {
        const m = usePdmProjectMetaStore.getState().metaForNfabSerialize();
        return m && Object.keys(m).length > 0 ? m : undefined;
      })(),
    };
  }, [
    featureHistory,
    mfgCamPost,
    mfgSmMaterial,
    mfgSmThickness,
    mfgSmKFactor,
    mfgCurrency,
    mfgQuoteQty,
    getAssemblySnapshot,
    getStudioViewSnapshot,
    getConfigurationsBlock,
  ]);

  /** 로컬 .nfab 저장 (Tauri: 네이티브 다이얼로그 또는 기존 경로에 덮어쓰기) */
  const handleSaveNfab = useCallback(async (forceSaveAs = false) => {
    const input = buildSerializeInput();
    if (!input) return;
    try {
      const savedPath = await downloadProjectFile(
        input,
        forceSaveAs ? null : desktopFilePath,
      );
      if (savedPath) setDesktopFilePath(savedPath);
      setDesktopDirty(false);
      addToast('success', lang === 'ko' ? '프로젝트 파일이 저장되었습니다 (.nfab)' : 'Project saved (.nfab)');
    } catch (err) {
      addToast('error', (err instanceof Error ? err.message : String(err)));
    }
  }, [buildSerializeInput, desktopFilePath, addToast, lang]);

  // Cloud save: serialize same payload as local, store in NexyfabProject.sceneData
  const handleSaveNfabCloud = useCallback(async () => {
    if (!featureHistory) return;
    const acc = useCloudProjectAccessStore.getState();
    if (acc.hydrated && !acc.canEdit) {
      addToast(
        'warning',
        lang === 'ko' ? '이 프로젝트는 보기 전용입니다. 클라우드에 저장할 수 없습니다.' : 'This project is read-only. Cloud save is disabled.',
      );
      return;
    }
    if (!useAuthStore.getState().user) {
      // Demo→signed-in flow: stash the in-flight save and pop the auth modal
      // via a custom event so the user gets one-click signup → resume.
      // The existing Round 23 pending-intent listener flushes the save once
      // authUser?.id is set after signup completes.
      if (typeof window !== 'undefined') {
        const sceneSnapshot = useSceneStore.getState();
        void import('@/lib/pending-intents').then(({ stashPendingIntent }) => {
          stashPendingIntent({
            kind: 'cloud_save_project',
            shapeId: sceneSnapshot.selectedId ?? null,
            materialId: sceneSnapshot.materialId ?? null,
            sceneData: null,  // useCloudSaveFlow rebuilds from current state on resume
            stashedAt: Date.now(),
          });
        }).catch(() => { /* ignore — fallback toast still fires */ });
        window.dispatchEvent(new CustomEvent('nexyfab:request-signup', {
          detail: { source: 'cloud-save' },
        }));
      }
      addToast(
        'info',
        lang === 'ko'
          ? '저장하려면 가입이 필요합니다 — 가입하시면 작업이 자동으로 저장됩니다'
          : 'Sign up to save — your work will be saved automatically',
      );
      return;
    }
    const input = buildSerializeInput();
    if (!input) return;
    try {
      const project = serializeProject(input);
      const sceneData = toJsonString(project);
      const sceneSnapshot = useSceneStore.getState();
      const existingId = cloudProjectIdRef.current;
      if (existingId) {
        const patch: NexyfabProjectPatchPayload = {
          name: project.name,
          shapeId: sceneSnapshot.selectedId,
          materialId: sceneSnapshot.materialId,
          sceneData,
        };
        if (cloudServerUpdatedAtRef.current != null) {
          patch.ifMatchUpdatedAt = cloudServerUpdatedAtRef.current;
        }
        const updated = await updateProject(existingId, patch);
        if (updated) {
          cloudServerUpdatedAtRef.current = updated.updatedAt;
          cloudDirtyRef.current = false;
          addToast('success', lang === 'ko' ? `클라우드에 저장되었습니다: ${project.name}` : `Saved to cloud: ${project.name}`);
        } else {
          const code = useProjectsStore.getState().lastErrorCode;
          const err = useProjectsStore.getState().error;
          if (code === 'PROJECT_READ_ONLY') {
            useCloudProjectAccessStore.getState().setFromApiProject(existingId, { role: 'viewer', canEdit: false });
            addToast(
              'warning',
              lang === 'ko' ? '이 프로젝트는 보기 전용입니다.' : 'This project is read-only.',
            );
            useProjectsStore.getState().clearError();
          } else if (code === 'PROJECT_VERSION_CONFLICT') {
            notifyProjectVersionConflict(addToast, lang, existingId);
            useProjectsStore.getState().clearError();
          } else {
            addToast('error', err ?? (lang === 'ko' ? '클라우드 저장 실패' : 'Cloud save failed'));
          }
        }
      } else {
        const saved = await saveProject({
          name: project.name,
          shapeId: sceneSnapshot.selectedId,
          materialId: sceneSnapshot.materialId,
          sceneData,
        });
        if (saved) {
          cloudProjectIdRef.current = saved.id;
          cloudServerUpdatedAtRef.current = saved.updatedAt;
          cloudDirtyRef.current = false;
          addToast('success', lang === 'ko' ? `클라우드에 저장되었습니다: ${project.name}` : `Saved to cloud: ${project.name}`);
        } else {
          addToast('error', lang === 'ko' ? '클라우드 저장 실패' : 'Cloud save failed');
        }
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err));
    }
  }, [featureHistory, buildSerializeInput, saveProject, updateProject, addToast, lang]);

  // Cloud auto-save: 3-min interval flush while dirty + logged in
  useEffect(() => {
    const FLUSH_MS = 180_000;
    const tick = async () => {
      if (!cloudDirtyRef.current) return;
      if (cloudSavingRef.current) return;
      if (!useAuthStore.getState().user) return;
      const accFlush = useCloudProjectAccessStore.getState();
      if (accFlush.hydrated && !accFlush.canEdit) return;
      if (!featureHistory) return;
      cloudSavingRef.current = true;
      try {
        const input = buildSerializeInput();
        if (!input) return;
        const project = serializeProject(input);
        const sceneData = toJsonString(project);
        const sceneSnapshot = useSceneStore.getState();
        const existingId = cloudProjectIdRef.current;
        if (existingId) {
          const patch: NexyfabProjectPatchPayload = {
            name: project.name,
            shapeId: sceneSnapshot.selectedId,
            materialId: sceneSnapshot.materialId,
            sceneData,
          };
          if (cloudServerUpdatedAtRef.current != null) {
            patch.ifMatchUpdatedAt = cloudServerUpdatedAtRef.current;
          }
          const updated = await updateProject(existingId, patch);
          if (updated) {
            cloudServerUpdatedAtRef.current = updated.updatedAt;
            cloudDirtyRef.current = false;
          } else if (useProjectsStore.getState().lastErrorCode === 'PROJECT_VERSION_CONFLICT') {
            notifyProjectVersionConflict(addToast, lang, existingId);
            useProjectsStore.getState().clearError();
          }
        } else {
          const saved = await saveProject({
            name: project.name,
            shapeId: sceneSnapshot.selectedId,
            materialId: sceneSnapshot.materialId,
            sceneData,
          });
          if (saved) {
            cloudProjectIdRef.current = saved.id;
            cloudServerUpdatedAtRef.current = saved.updatedAt;
            cloudDirtyRef.current = false;
          }
        }
      } catch {
        // Silent — local autoSave still active; retry next tick.
      } finally {
        cloudSavingRef.current = false;
      }
    };
    const id = window.setInterval(() => { void tick(); }, FLUSH_MS);
    return () => window.clearInterval(id);
  }, [featureHistory, buildSerializeInput, saveProject, updateProject, addToast, lang]);

  /** Apply parsed .nfab payload — shared by disk open, recent file, and dashboard cloud open */
  const applyLoadedNfabProject = useCallback(
    (project: NfabProjectV1) => {
      const sid = project.scene.selectedId;
      const rawParams = (project.scene.params ?? {}) as Record<string, number>;
      const sd = SHAPE_MAP[sid];
      let nextParams = rawParams;
      let nextExpr: Record<string, string> = { ...(project.scene.paramExpressions ?? {}) };
      if (sd) {
        const applied = computeSceneParamApply(sd, rawParams, {
          mergeExpressionsFrom: project.scene.paramExpressions ?? {},
        });
        nextParams = applied.params;
        nextExpr = applied.paramExpressions;
      }
      useSceneStore.setState({
        selectedId: sid,
        params: nextParams,
        paramExpressions: nextExpr,
        materialId: project.scene.materialId,
        color: project.scene.color,
        isSketchMode: project.scene.isSketchMode,
        sketchPlane: project.scene.sketchPlane,
        sketchProfile: project.scene.sketchProfile,
        sketchConfig: project.scene.sketchConfig,
        renderMode: project.scene.renderMode ?? 'standard',
        explodeFactor: (() => {
          const ef = project.scene.explodeFactor;
          if (typeof ef !== 'number' || !Number.isFinite(ef)) return 0;
          return Math.max(0, Math.min(1, ef));
        })(),
        sketchViewMode:
          project.scene.sketchViewMode === '2d' ||
          project.scene.sketchViewMode === '3d' ||
          project.scene.sketchViewMode === 'drawing'
            ? project.scene.sketchViewMode
            : '2d',
        ribbonTheme:
          project.scene.ribbonTheme === 'lightRibbon' ? 'lightRibbon' : 'dark',
        // Restore Phase-2 face frame — `?? null` keeps legacy files
        // (which never had this field) starting in fast-path mode.
        sketchFaceFrame: project.scene.sketchFaceFrame ?? null,
      });
      restoreStudioViewSnapshot?.(project.scene.studioView);
      replaceHistory(project.tree.nodes, project.tree.rootId, project.tree.activeNodeId);
      restoreConfigurationsSnapshot?.(project.configurations, project.activeConfigurationId);
      restoreAssemblySnapshot?.(project.assembly);

      const at =
        project.scene.activeTab === 'optimize' ? 'optimize' : 'design';
      const cwRaw = project.scene.cadWorkspace;
      if (cwRaw && isCadWorkspaceId(cwRaw) && cwRaw !== 'design' && cwRaw !== 'optimize') {
        useUIStore.getState().hydrateMainTabFromProject(at);
        applyCadWorkspace(cwRaw, { isSketchMode: project.scene.isSketchMode });
      } else {
        const cw = cwRaw && isCadWorkspaceId(cwRaw) ? cwRaw : at;
        useUIStore.getState().hydrateMainTabFromProject(cw === 'optimize' || cw === 'design' ? cw : at);
      }

      if (project.manufacturing) {
        const m = project.manufacturing;
        if (m.camPostProcessorId) setMfgCamPost(m.camPostProcessorId);
        if (m.smMaterial) setMfgSmMaterial(m.smMaterial);
        if (typeof m.smThickness === 'number') setMfgSmThickness(m.smThickness);
        setMfgSmKFactor(m.smKFactorOverride ?? null);
        if (m.currency) setMfgCurrency(m.currency);
        if (typeof m.quoteQuantity === 'number') setMfgQuoteQty(m.quoteQuantity);
      }

      usePdmProjectMetaStore.getState().hydrateFromProjectMeta(project.meta);
    },
    [
      replaceHistory,
      restoreAssemblySnapshot,
      setMfgCamPost,
      setMfgSmMaterial,
      setMfgSmThickness,
      setMfgSmKFactor,
      setMfgCurrency,
      setMfgQuoteQty,
      restoreStudioViewSnapshot,
      restoreConfigurationsSnapshot,
    ],
  );

  /** Align nfab cloud auto-flush ref with an existing server project id (e.g. dashboard deep-link). */
  const syncCloudNfabProjectId = useCallback((id: string | null, serverUpdatedAt?: number | null) => {
    cloudProjectIdRef.current = id;
    cloudDirtyRef.current = false;
    if (id === null) {
      cloudServerUpdatedAtRef.current = null;
    } else if (typeof serverUpdatedAt === 'number' && Number.isFinite(serverUpdatedAt)) {
      cloudServerUpdatedAtRef.current = serverUpdatedAt;
    }
  }, []);

  const handleLoadNfab = useCallback(async () => {
    try {
      const project = await pickProjectFile();
      useCloudProjectAccessStore.getState().reset();
      applyLoadedNfabProject(project);
      if (project.__path) {
        setDesktopFilePath(project.__path);
        setDesktopDirty(false);
      }
      addToast('success', lang === 'ko' ? `프로젝트를 불러왔습니다: ${project.name}` : `Loaded: ${project.name}`);
    } catch (err) {
      if (err instanceof Error && err.message === 'No file selected') return;
      addToast('error', lang === 'ko' ? `프로젝트 불러오기 실패: ${err instanceof Error ? err.message : String(err)}` : `Load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [applyLoadedNfabProject, addToast, lang]);

  /** 최근 파일 경로로 직접 열기 (Tauri only) */
  const handleOpenRecentFile = useCallback(async (path: string) => {
    try {
      const project = await openProjectByPath(path);
      useCloudProjectAccessStore.getState().reset();
      applyLoadedNfabProject(project);
      setDesktopFilePath(project.__path);
      setDesktopDirty(false);
      addToast('success', lang === 'ko' ? `불러옴: ${project.name}` : `Opened: ${project.name}`);
    } catch {
      addToast('error', lang === 'ko' ? `파일 열기 실패: ${path}` : `Failed to open: ${path}`);
    }
  }, [applyLoadedNfabProject, addToast, lang]);

  /** Mark both desktop and cloud state dirty — call from a watcher effect. */
  const markDirty = useCallback(() => {
    cloudDirtyRef.current = true;
    setDesktopDirty(true);
  }, []);

  /** Reset file tracking (used by "New File" menu action). */
  const resetFile = useCallback(() => {
    setDesktopFilePath(null);
    setDesktopDirty(false);
    cloudProjectIdRef.current = null;
    cloudServerUpdatedAtRef.current = null;
    usePdmProjectMetaStore.getState().reset();
    useCloudProjectAccessStore.getState().reset();
  }, []);

  return {
    desktopFilePath,
    desktopDirty,
    handleSaveNfab,
    handleSaveNfabCloud,
    handleLoadNfab,
    handleOpenRecentFile,
    applyLoadedNfabProject,
    syncCloudNfabProjectId,
    markDirty,
    resetFile,
    // Manufacturing route (persisted in .nfab)
    mfgCamPost, setMfgCamPost,
    mfgSmMaterial, setMfgSmMaterial,
    mfgSmThickness, setMfgSmThickness,
    mfgSmKFactor, setMfgSmKFactor,
    mfgCurrency, setMfgCurrency,
    mfgQuoteQty, setMfgQuoteQty,
  };
}
