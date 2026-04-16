'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { useAuthStore } from '@/hooks/useAuth';
import type { NexyfabProject } from '@/hooks/useProjects';
import { downloadProjectFile, pickProjectFile, openProjectByPath } from '../io/projectFile';
import { serializeProject, toJsonString, type SerializeInput } from '../io/nfabFormat';
import type { FeatureHistory, HistoryNode } from '../useFeatureStack';
import type { Toast } from '../useToast';

type AddToast = (type: Toast['type'], msg: string) => void;

interface Deps {
  featureHistory: FeatureHistory | null;
  replaceHistory: (nodes: HistoryNode[], rootId: string, activeNodeId: string) => void;
  saveProject: (data: Partial<NexyfabProject>) => Promise<NexyfabProject | null>;
  updateProject: (id: string, data: Partial<NexyfabProject>) => Promise<void>;
  addToast: AddToast;
  lang: string;
}

/**
 * .nfab native project I/O — local (Tauri) save/load + cloud save + 3-min auto-flush.
 * Owns desktop file path + dirty flag and cloud project id/dirty/saving refs.
 * Call `markDirty()` from a watcher effect when scene state changes.
 */
export function useNfabFileIO(deps: Deps) {
  const { featureHistory, replaceHistory, saveProject, updateProject, addToast, lang } = deps;

  const [desktopFilePath, setDesktopFilePath] = useState<string | null>(null);
  const [desktopDirty, setDesktopDirty] = useState(false);

  // Manufacturing Route state — persisted in .nfab, restored on load
  const [mfgCamPost, setMfgCamPost] = useState<string>('linuxcnc');
  const [mfgSmMaterial, setMfgSmMaterial] = useState<string>('mildSteel');
  const [mfgSmThickness, setMfgSmThickness] = useState<number>(2);
  const [mfgSmKFactor, setMfgSmKFactor] = useState<number | null>(null);
  const [mfgCurrency, setMfgCurrency] = useState<string>('KRW');
  const [mfgQuoteQty, setMfgQuoteQty] = useState<number>(1);

  const cloudProjectIdRef = useRef<string | null>(null);
  const cloudDirtyRef = useRef(false);
  const cloudSavingRef = useRef(false);

  const buildSerializeInput = useCallback((): SerializeInput | null => {
    if (!featureHistory) return null;
    const sceneSnapshot = useSceneStore.getState();
    return {
      name: sceneSnapshot.selectedId || 'nexyfab-project',
      history: featureHistory,
      scene: {
        selectedId: sceneSnapshot.selectedId,
        params: sceneSnapshot.params,
        paramExpressions: sceneSnapshot.paramExpressions,
        materialId: sceneSnapshot.materialId,
        color: sceneSnapshot.color,
        isSketchMode: sceneSnapshot.isSketchMode,
        sketchPlane: sceneSnapshot.sketchPlane,
        sketchProfile: sceneSnapshot.sketchProfile,
        sketchConfig: sceneSnapshot.sketchConfig,
        renderMode: sceneSnapshot.renderMode,
      },
      manufacturing: {
        camPostProcessorId: mfgCamPost,
        smMaterial: mfgSmMaterial,
        smThickness: mfgSmThickness,
        smKFactorOverride: mfgSmKFactor,
        currency: mfgCurrency,
        quoteQuantity: mfgQuoteQty,
      },
    };
  }, [featureHistory, mfgCamPost, mfgSmMaterial, mfgSmThickness, mfgSmKFactor, mfgCurrency, mfgQuoteQty]);

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
    if (!useAuthStore.getState().user) {
      addToast('warning', lang === 'ko' ? '클라우드 저장은 로그인이 필요합니다' : 'Cloud save requires login');
      return;
    }
    const input = buildSerializeInput();
    if (!input) return;
    try {
      const project = serializeProject(input);
      const sceneData = toJsonString(project);
      const sceneSnapshot = useSceneStore.getState();
      const saved = await saveProject({
        name: project.name,
        shapeId: sceneSnapshot.selectedId,
        materialId: sceneSnapshot.materialId,
        sceneData,
      });
      if (saved) {
        cloudProjectIdRef.current = saved.id;
        cloudDirtyRef.current = false;
        addToast('success', lang === 'ko' ? `클라우드에 저장되었습니다: ${project.name}` : `Saved to cloud: ${project.name}`);
      } else {
        addToast('error', lang === 'ko' ? '클라우드 저장 실패' : 'Cloud save failed');
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err));
    }
  }, [featureHistory, buildSerializeInput, saveProject, addToast, lang]);

  // Cloud auto-save: 3-min interval flush while dirty + logged in
  useEffect(() => {
    const FLUSH_MS = 180_000;
    const tick = async () => {
      if (!cloudDirtyRef.current) return;
      if (cloudSavingRef.current) return;
      if (!useAuthStore.getState().user) return;
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
          await updateProject(existingId, {
            name: project.name,
            shapeId: sceneSnapshot.selectedId,
            materialId: sceneSnapshot.materialId,
            sceneData,
          });
          cloudDirtyRef.current = false;
        } else {
          const saved = await saveProject({
            name: project.name,
            shapeId: sceneSnapshot.selectedId,
            materialId: sceneSnapshot.materialId,
            sceneData,
          });
          if (saved) {
            cloudProjectIdRef.current = saved.id;
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
  }, [featureHistory, buildSerializeInput, saveProject, updateProject]);

  const handleLoadNfab = useCallback(async () => {
    try {
      const project = await pickProjectFile();
      useSceneStore.setState({
        selectedId: project.scene.selectedId,
        params: project.scene.params,
        paramExpressions: project.scene.paramExpressions,
        materialId: project.scene.materialId,
        color: project.scene.color,
        isSketchMode: project.scene.isSketchMode,
        sketchPlane: project.scene.sketchPlane,
        sketchProfile: project.scene.sketchProfile,
        sketchConfig: project.scene.sketchConfig,
        renderMode: project.scene.renderMode ?? 'standard',
      });
      replaceHistory(project.tree.nodes, project.tree.rootId, project.tree.activeNodeId);
      if (project.manufacturing) {
        const m = project.manufacturing;
        if (m.camPostProcessorId) {
          setMfgCamPost(m.camPostProcessorId);
          try { localStorage.setItem('nexyfab.cam.post', m.camPostProcessorId); } catch {}
        }
        if (m.smMaterial) setMfgSmMaterial(m.smMaterial);
        if (typeof m.smThickness === 'number') setMfgSmThickness(m.smThickness);
        setMfgSmKFactor(m.smKFactorOverride ?? null);
        if (m.currency) setMfgCurrency(m.currency);
        if (typeof m.quoteQuantity === 'number') setMfgQuoteQty(m.quoteQuantity);
      }
      if (project.__path) { setDesktopFilePath(project.__path); setDesktopDirty(false); }
      addToast('success', lang === 'ko' ? `프로젝트를 불러왔습니다: ${project.name}` : `Loaded: ${project.name}`);
    } catch (err) {
      if (err instanceof Error && err.message === 'No file selected') return;
      addToast('error', lang === 'ko' ? `프로젝트 불러오기 실패: ${err instanceof Error ? err.message : String(err)}` : `Load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [replaceHistory, setMfgCamPost, setMfgSmMaterial, setMfgSmThickness, setMfgSmKFactor, setMfgCurrency, setMfgQuoteQty, addToast, lang]);

  /** 최근 파일 경로로 직접 열기 (Tauri only) */
  const handleOpenRecentFile = useCallback(async (path: string) => {
    try {
      const project = await openProjectByPath(path);
      useSceneStore.setState({
        selectedId: project.scene.selectedId,
        params: project.scene.params,
        paramExpressions: project.scene.paramExpressions,
        materialId: project.scene.materialId,
        color: project.scene.color,
        isSketchMode: project.scene.isSketchMode,
        sketchPlane: project.scene.sketchPlane,
        sketchProfile: project.scene.sketchProfile,
        sketchConfig: project.scene.sketchConfig,
        renderMode: project.scene.renderMode ?? 'standard',
      });
      replaceHistory(project.tree.nodes, project.tree.rootId, project.tree.activeNodeId);
      setDesktopFilePath(project.__path);
      setDesktopDirty(false);
      addToast('success', lang === 'ko' ? `불러옴: ${project.name}` : `Opened: ${project.name}`);
    } catch {
      addToast('error', lang === 'ko' ? `파일 열기 실패: ${path}` : `Failed to open: ${path}`);
    }
  }, [replaceHistory, addToast, lang]);

  /** Mark both desktop and cloud state dirty — call from a watcher effect. */
  const markDirty = useCallback(() => {
    cloudDirtyRef.current = true;
    setDesktopDirty(true);
  }, []);

  /** Reset file tracking (used by "New File" menu action). */
  const resetFile = useCallback(() => {
    setDesktopFilePath(null);
    setDesktopDirty(false);
  }, []);

  return {
    desktopFilePath,
    desktopDirty,
    handleSaveNfab,
    handleSaveNfabCloud,
    handleLoadNfab,
    handleOpenRecentFile,
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
