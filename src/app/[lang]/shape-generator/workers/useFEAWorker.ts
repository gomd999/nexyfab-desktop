'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { FEAMaterial, FEABoundaryCondition, FEAResult } from '../analysis/simpleFEA';
import type { FEAWorkerInput, FEAWorkerOutput } from './feaWorker';

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

export function useFEAWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    resolve: (result: FEAResult) => void;
    reject: (err: Error) => void;
  } | null>(null);

  const [loading, setLoading] = useState(false);

  // Spin up worker once
  useEffect(() => {
    try {
      const worker = new Worker(
        /* webpackChunkName: "fea-worker" */
        new URL('./feaWorker.ts', import.meta.url),
      );

      worker.addEventListener('message', (event: MessageEvent<FEAWorkerOutput>) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);

        if (!pending) return;

        const data = event.data;
        if (data.type === 'FEA_RESULT' && data.result) {
          pending.resolve(data.result);
        } else {
          pending.reject(new Error(data.error ?? 'FEA worker returned unknown error'));
        }
      });

      worker.addEventListener('error', (event: ErrorEvent) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);

        if (pending) {
          pending.reject(new Error(event.message || 'FEA worker error'));
        }
      });

      workerRef.current = worker;
    } catch {
      // Worker creation can fail in SSR or unsupported environments.
      // runFEA will fall back to synchronous execution on the main thread.
      workerRef.current = null;
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;

      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        pending.reject(new Error('FEA worker terminated'));
      }
    };
  }, []);

  /**
   * Run FEA, preferring the Web Worker and falling back to synchronous
   * execution on the main thread when the worker is unavailable.
   */
  const runFEA = useCallback(
    async (
      geo: THREE.BufferGeometry,
      material: FEAMaterial,
      conditions: FEABoundaryCondition[],
    ): Promise<FEAResult> => {
      // If worker is available and idle, use it
      if (workerRef.current && !pendingRef.current) {
        return new Promise<FEAResult>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            pendingRef.current = null;
            setLoading(false);
            reject(new Error('FEA analysis timed out (30s)'));
          }, 30_000);

          pendingRef.current = {
            resolve: (r: FEAResult) => { clearTimeout(timeoutId); resolve(r); },
            reject: (e: Error) => { clearTimeout(timeoutId); reject(e); },
          };
          setLoading(true);
          try {
            const { positions, normals, indices } = serializeGeometry(geo);

            const message: FEAWorkerInput = {
              type: 'RUN_FEA',
              payload: { positions, normals, indices, material, conditions },
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
            reject(new Error('Failed to start FEA: ' + err));
          }
        });
      }

      // Fallback: synchronous on main thread
      const { runSimpleFEA } = await import('../analysis/simpleFEA');
      return runSimpleFEA(geo, { material, conditions });
    },
    [],
  );

  /** Cancel any in-flight FEA work and terminate the worker. */
  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      pending.reject(new Error('FEA cancelled'));
    }
    setLoading(false);
  }, []);

  return { runFEA, loading, cancel };
}
