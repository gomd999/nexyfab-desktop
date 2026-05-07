'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { ManufacturingProcess, DFMResult, DFMOptions } from '../analysis/dfmAnalysis';
import type { DFMWorkerInput, DFMWorkerOutput } from './dfmWorker';

// ─── Serialisation helpers ──────────────────────────────────────────────────

interface SerializedGeometry {
  positions: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
}

function serializeGeometry(geo: THREE.BufferGeometry): SerializedGeometry {
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

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useDFMWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    resolve: (results: DFMResult[]) => void;
    reject: (err: Error) => void;
  } | null>(null);

  const [loading, setLoading] = useState(false);

  const spawnWorker = useCallback(() => {
    try {
      const worker = new Worker(
        /* webpackChunkName: "dfm-worker" */
        new URL('./dfmWorker.ts', import.meta.url),
      );

      worker.addEventListener('message', (event: MessageEvent<DFMWorkerOutput>) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);

        if (!pending) return;

        const data = event.data;
        if (data.type === 'DFM_RESULT' && data.results) {
          pending.resolve(data.results);
        } else {
          pending.reject(new Error(data.error ?? 'DFM worker returned unknown error'));
        }
      });

      worker.addEventListener('error', (event: ErrorEvent) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);

        if (pending) {
          pending.reject(new Error(event.message || 'DFM worker error'));
        }
      });

      workerRef.current = worker;
    } catch {
      workerRef.current = null;
    }
  }, []);

  // Spin up worker once
  useEffect(() => {
    spawnWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;

      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        pending.reject(new Error('DFM worker terminated'));
      }
    };
  }, [spawnWorker]);

  /**
   * Run DFM analysis, preferring the Web Worker and falling back to synchronous
   * execution on the main thread when the worker is unavailable.
   */
  const analyzeDFM = useCallback(
    async (
      geo: THREE.BufferGeometry,
      processes: ManufacturingProcess[],
      options?: DFMOptions,
    ): Promise<DFMResult[]> => {
      // If worker is available and idle, use it
      if (workerRef.current && !pendingRef.current) {
        return new Promise<DFMResult[]>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            pendingRef.current = null;
            setLoading(false);
            reject(new Error('FEA analysis timed out (30s)'));
          }, 30_000);

          pendingRef.current = {
            resolve: (r: DFMResult[]) => { clearTimeout(timeoutId); resolve(r); },
            reject: (e: Error) => { clearTimeout(timeoutId); reject(e); },
          };
          setLoading(true);
          try {
            const { positions, normals, indices } = serializeGeometry(geo);

            const message: DFMWorkerInput = {
              type: 'RUN_DFM',
              payload: { positions, normals, indices, processes, options },
            };

            const transferables: ArrayBuffer[] = [positions.buffer as ArrayBuffer];
            if (normals) transferables.push(normals.buffer as ArrayBuffer);
            if (indices) transferables.push(indices.buffer as ArrayBuffer);

            workerRef.current!.postMessage(
              message,
              transferables as unknown as Transferable[],
            );
          } catch (err) {
            clearTimeout(timeoutId);
            pendingRef.current = null;
            setLoading(false);
            reject(new Error('Failed to start DFM: ' + err));
          }
        });
      }

      // Fallback: synchronous on main thread
      const { analyzeDFM: analyzeDFMSync } = await import('../analysis/dfmAnalysis');
      return analyzeDFMSync(geo, processes, options);
    },
    [],
  );

  /** Cancel any in-flight DFM work, terminate the worker, and re-spawn for next run. */
  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      pending.reject(new Error('DFM cancelled'));
    }
    setLoading(false);
    spawnWorker();
  }, [spawnWorker]);

  return { analyzeDFM, loading, cancel };
}
