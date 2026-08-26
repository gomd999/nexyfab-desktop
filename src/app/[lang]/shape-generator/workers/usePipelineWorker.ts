'use client';

/**
 * usePipelineWorker — runs the geometry feature pipeline in a Web Worker.
 *
 * Falls back to synchronous main-thread execution when the worker is
 * unavailable (SSR, unsupported browser, or worker creation failure).
 *
 * Usage
 * ─────
 *   const { runPipeline, loading, cancel } = usePipelineWorker();
 *
 *   const result = await runPipeline(baseGeometry, features, { occtMode });
 *   // result: { geometry: THREE.BufferGeometry, errors: Record<string, string> }
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { FeatureInstance } from '../features/types';
import type { PipelineWorkerInput, PipelineWorkerOutput } from './pipelineWorker';
import { trackGeometry } from '../hooks/useGeometryGC';
import {
  extractFaceProvenance,
  applyFaceProvenance,
  faceProvenanceTransferables,
} from './faceProvenanceTransfer';
import {
  settlePendingProjections,
  type DrawingViewName,
  type ProjectedViewData,
} from './projectViewsRpc';

export interface PipelineRunOptions {
  occtMode?: boolean;
  /** Base primitive spec — lets the worker rebuild a real B-rep base solid in
   *  its own OCCT context (the handle can't cross the worker boundary). */
  baseSpec?: { shapeId: string; params: Record<string, number> };
}

export interface PipelineRunResult {
  geometry: THREE.BufferGeometry;
  errors: Record<string, string>;
}

// Cold exact-kernel initialization plus a multi-feature rebuild can exceed one
// minute on software-rendered or low-power clients. Keep the operation bounded,
// but do not discard a valid worker B-rep just before it reaches the UI.
export const PIPELINE_WORKER_TIMEOUT_MS = 150_000;

// ─── Geometry serialisation helpers ─────────────────────────────────────────

function serializeGeometry(geo: THREE.BufferGeometry) {
  const positions = new Float32Array(
    (geo.attributes.position as THREE.BufferAttribute).array,
  );
  const normals = geo.attributes.normal
    ? new Float32Array((geo.attributes.normal as THREE.BufferAttribute).array)
    : undefined;
  const indices = geo.index
    ? new Uint32Array(geo.index.array)
    : undefined;
  // Face provenance (per-vertex feature-id attribute + topo userData maps)
  // does not survive postMessage — ferry it explicitly so the worker-side
  // pipeline sees the same base geometry the sync path would.
  const faceProvenance = extractFaceProvenance(geo);
  return { positions, normals, indices, faceProvenance };
}

function deserializeGeometry(
  positions: Float32Array,
  normals?: Float32Array,
  indices?: Uint32Array,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (indices) geo.setIndex(new THREE.BufferAttribute(indices, 1));
  if (!normals) geo.computeVertexNormals();
  trackGeometry(geo);
  return geo;
}

/** 뷰별 SVG 경로(워커 직렬화 그대로) — DrawingView HLR 소비 형태와 동일. */
export type ProjectedViewsResult = Record<string, ProjectedViewData>;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePipelineWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    resolve: (r: PipelineRunResult) => void;
    reject: (e: Error) => void;
  } | null>(null);
  /** PROJECT_VIEWS RPC pending — requestId → resolve(null=실패/워커소멸). */
  const projPendingRef = useRef<Map<number, (v: ProjectedViewsResult | null) => void>>(new Map());
  const projSeqRef = useRef(0);
  const stepPendingRef = useRef<Map<number, (v: string | null) => void>>(new Map());
  const stepSeqRef = useRef(0);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');

  const spawnWorker = useCallback(() => {
    try {
      const worker = new Worker(
        /* webpackChunkName: "pipeline-worker" */
        new URL('./pipelineWorker.ts', import.meta.url),
      );

      worker.addEventListener('message', (event: MessageEvent<PipelineWorkerOutput>) => {
        const data = event.data;
        if (data.type === 'PIPELINE_PROGRESS') {
          if (data.progress !== undefined) setProgress(data.progress);
          if (data.label !== undefined) setProgressLabel(data.label);
          return;
        }
        // F-4 후속 — PROJECT_VIEWS RPC 응답은 파이프라인 pending 과 무관하게
        // requestId 로 상관(파이프라인 pending 을 지우면 안 된다).
        if (data.type === 'PROJECT_RESULT') {
          const req = data.requestId !== undefined ? projPendingRef.current.get(data.requestId) : undefined;
          if (data.requestId !== undefined) projPendingRef.current.delete(data.requestId);
          req?.(data.projectedViews ?? null);
          return;
        }
        if (data.type === 'EXPORT_STEP_RESULT') {
          const req = data.requestId !== undefined ? stepPendingRef.current.get(data.requestId) : undefined;
          if (data.requestId !== undefined) stepPendingRef.current.delete(data.requestId);
          req?.(data.stepText ?? null);
          return;
        }

        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        setProgress(0);
        setProgressLabel('');
        if (!pending) return;

        if (data.type === 'PIPELINE_RESULT' && data.positions) {
          const geo = deserializeGeometry(data.positions, data.normals, data.indices);
          // F-4 후속 — 워커 레지스트리 소속 B-rep 핸들 페리(HLR 등은
          // projectViews RPC 로만 사용 가능함을 플래그로 명시).
          if (data.occtHandle) {
            geo.userData = { ...geo.userData, occtHandle: data.occtHandle, occtHandleInWorker: true };
          }
          if (data.occtShapeEvidence) {
            geo.userData = { ...geo.userData, occtShapeEvidence: data.occtShapeEvidence };
          }
          // Re-attach stable topology ids (userData doesn't cross the worker
          // boundary, so the worker ships them as plain JSON alongside the mesh).
          if (data.topoEdgeSignatures) {
            geo.userData = { ...geo.userData, topoEdgeSignatures: data.topoEdgeSignatures };
          }
          // Re-attach OCCT→mesh downgrade notices so the banner sees the worker
          // path too (the same userData-doesn't-cross-the-boundary issue).
          if (data.meshDowngrades && data.meshDowngrades.length > 0) {
            geo.userData = { ...geo.userData, meshDowngrades: data.meshDowngrades };
          }
          if (data.workerDiagnostic) {
            geo.userData = { ...geo.userData, pipelineWorkerDiagnostic: data.workerDiagnostic };
          }
          // Re-attach face provenance (nfabFaceFeatureId attribute +
          // topoFaceMapByFeature/topoSketchExtrudeHashes/nfabFeatureIdMap)
          // so persistent face selection works on worker-path geometry.
          applyFaceProvenance(geo, data.faceProvenance);
          pending.resolve({ geometry: geo, errors: data.errors ?? {} });
        } else {
          pending.reject(new Error(data.error ?? 'Pipeline worker returned unknown error'));
        }
      });

      worker.addEventListener('error', (event: ErrorEvent) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        setProgress(0);
        setProgressLabel('');
        if (pending) pending.reject(new Error(event.message || 'Pipeline worker error'));
        settlePendingProjections(projPendingRef.current);
        settlePendingProjections(stepPendingRef.current);
      });

      workerRef.current = worker;
    } catch {
      workerRef.current = null;
    }
  }, []);

  // Spin up worker once on mount
  useEffect(() => {
    spawnWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        pending.reject(new Error('Pipeline worker terminated'));
      }
      settlePendingProjections(projPendingRef.current);
      settlePendingProjections(stepPendingRef.current);
    };
  }, [spawnWorker]);

  /**
   * Run the feature pipeline, preferring the Worker.
   * Falls back to the synchronous main-thread path when the worker is busy
   * or unavailable.
   */
  const runPipeline = useCallback(
    async (
      baseGeo: THREE.BufferGeometry,
      features: FeatureInstance[],
      opts: PipelineRunOptions = {},
    ): Promise<PipelineRunResult> => {
      // Latest run wins — supersede an in-flight worker job instead of falling through to sync duplicate work.
      if (workerRef.current && pendingRef.current) {
        const stale = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        setProgress(0);
        setProgressLabel('');
        stale.reject(new Error('Pipeline superseded'));
        // 워커 교체 = 투영 RPC pending·핸들 레지스트리 소멸 — null 로 정리.
        settlePendingProjections(projPendingRef.current);
        settlePendingProjections(stepPendingRef.current);
        workerRef.current.terminate();
        workerRef.current = null;
        spawnWorker();
      }

      // Worker path — only when idle after optional supersede above
      if (workerRef.current && !pendingRef.current) {
        return new Promise<PipelineRunResult>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              pendingRef.current = null;
              setLoading(false);
              setProgress(0);
              setProgressLabel('');
              reject(new Error(`Pipeline worker timed out (${PIPELINE_WORKER_TIMEOUT_MS / 1000}s)`));
            }, PIPELINE_WORKER_TIMEOUT_MS);

          pendingRef.current = {
            resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
            reject: (e) => { clearTimeout(timeoutId); reject(e); },
          };
          setLoading(true);
          setProgress(0);
          setProgressLabel('Starting calculation...');

          try {
            const { positions, normals, indices, faceProvenance } = serializeGeometry(baseGeo);

            const message: PipelineWorkerInput = {
              type: 'RUN_PIPELINE',
              payload: { positions, normals, indices, features, occtMode: opts.occtMode, baseSpec: opts.baseSpec, faceProvenance },
            };

            const transferables: ArrayBuffer[] = [positions.buffer as ArrayBuffer];
            if (normals) transferables.push(normals.buffer as ArrayBuffer);
            if (indices) transferables.push(indices.buffer as ArrayBuffer);
            transferables.push(...faceProvenanceTransferables(faceProvenance));

            workerRef.current!.postMessage(message, transferables as unknown as Transferable[]);
          } catch (err) {
            clearTimeout(timeoutId);
            pendingRef.current = null;
            setLoading(false);
            setProgress(0);
            setProgressLabel('');
            reject(new Error('Failed to start pipeline worker: ' + err));
          }
        });
      }

      // Fallback: synchronous on main thread
      const mod = await import('../features/index');
      if (opts.occtMode) {
        return mod.applyFeaturePipelineDetailedAsync(baseGeo, features, { occtMode: true, baseSpec: opts.baseSpec });
      }
      return mod.applyFeaturePipelineDetailed(baseGeo, features);
    },
    [spawnWorker],
  );

  /** Terminate in-flight work, reset state, and re-spawn the worker. */
  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      pending.reject(new Error('Pipeline cancelled'));
    }
    settlePendingProjections(projPendingRef.current);
    settlePendingProjections(stepPendingRef.current);
    setLoading(false);
    setProgress(0);
    setProgressLabel('');
    spawnWorker();
  }, [spawnWorker]);

  /** F-4 후속(260808g) — 워커 레지스트리 소속 핸들의 HLR 투영 RPC.
   *  워커 부재/실패/10s 초과 → null(호출측 fail-closed). */
  const projectViews = useCallback((
    handle: string,
    views: DrawingViewName[],
  ): Promise<ProjectedViewsResult | null> => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve(null);
    const requestId = ++projSeqRef.current;
    return new Promise<ProjectedViewsResult | null>(resolve => {
      const timeoutId = setTimeout(() => {
        projPendingRef.current.delete(requestId);
        resolve(null);
      }, 10_000);
      projPendingRef.current.set(requestId, v => { clearTimeout(timeoutId); resolve(v); });
      try {
        worker.postMessage({ type: 'PROJECT_VIEWS', payload: { requestId, handle, views } });
      } catch {
        clearTimeout(timeoutId);
        projPendingRef.current.delete(requestId);
        resolve(null);
      }
    });
  }, []);

  const exportStep = useCallback((handle: string): Promise<string | null> => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve(null);
    const requestId = ++stepSeqRef.current;
    return new Promise<string | null>(resolve => {
      const timeoutId = setTimeout(() => {
        stepPendingRef.current.delete(requestId);
        resolve(null);
      }, 30_000);
      stepPendingRef.current.set(requestId, value => { clearTimeout(timeoutId); resolve(value); });
      try {
        worker.postMessage({ type: 'EXPORT_STEP', payload: { requestId, handle } });
      } catch {
        clearTimeout(timeoutId);
        stepPendingRef.current.delete(requestId);
        resolve(null);
      }
    });
  }, []);

  return { runPipeline, loading, progress, progressLabel, cancel, projectViews, exportStep };
}
