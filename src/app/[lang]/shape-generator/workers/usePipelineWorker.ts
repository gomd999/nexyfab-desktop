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

export interface PipelineRunOptions {
  occtMode?: boolean;
}

export interface PipelineRunResult {
  geometry: THREE.BufferGeometry;
  errors: Record<string, string>;
}

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
  return { positions, normals, indices };
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

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePipelineWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    resolve: (r: PipelineRunResult) => void;
    reject: (e: Error) => void;
  } | null>(null);

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

        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        setProgress(0);
        setProgressLabel('');
        if (!pending) return;

        if (data.type === 'PIPELINE_RESULT' && data.positions) {
          const geo = deserializeGeometry(data.positions, data.normals, data.indices);
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
              reject(new Error('Pipeline worker timed out (60s)'));
            }, 60_000);

          pendingRef.current = {
            resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
            reject: (e) => { clearTimeout(timeoutId); reject(e); },
          };
          setLoading(true);
          setProgress(0);
          setProgressLabel('Starting calculation...');

          try {
            const { positions, normals, indices } = serializeGeometry(baseGeo);

            const message: PipelineWorkerInput = {
              type: 'RUN_PIPELINE',
              payload: { positions, normals, indices, features, occtMode: opts.occtMode },
            };

            const transferables: ArrayBuffer[] = [positions.buffer as ArrayBuffer];
            if (normals) transferables.push(normals.buffer as ArrayBuffer);
            if (indices) transferables.push(indices.buffer as ArrayBuffer);

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
        return mod.applyFeaturePipelineDetailedAsync(baseGeo, features, { occtMode: true });
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
    setLoading(false);
    setProgress(0);
    setProgressLabel('');
    spawnWorker();
  }, [spawnWorker]);

  return { runPipeline, loading, progress, progressLabel, cancel };
}
