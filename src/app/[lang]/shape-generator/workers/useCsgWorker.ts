'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { CSGWorkerInput, CSGWorkerOutput } from './csgWorker';
import { applyBooleanSync } from '../features/boolean';
import { reportError } from '../lib/telemetry';
import { trackGeometry } from '../hooks/useGeometryGC';

// ─── Serialisation helpers ──────────────────────────────────────────────────

interface SerializedMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

function serializeGeometry(geo: THREE.BufferGeometry): SerializedMesh {
  // Ensure normals are computed
  if (!geo.attributes.normal) {
    geo.computeVertexNormals();
  }

  const positions = new Float32Array(
    (geo.attributes.position as THREE.BufferAttribute).array,
  );
  const normals = new Float32Array(
    (geo.attributes.normal as THREE.BufferAttribute).array,
  );

  let indices: Uint32Array;
  if (geo.index) {
    indices = new Uint32Array(geo.index.array);
  } else {
    // Non-indexed — create trivial index
    indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }

  return { positions, normals, indices };
}

function deserializeGeometry(data: {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  trackGeometry(geo);
  return geo;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useCsgWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    resolve: (geo: THREE.BufferGeometry) => void;
    reject: (err: Error) => void;
  } | null>(null);

  const [loading, setLoading] = useState(false);

  const spawnWorker = useCallback(() => {
    try {
      const worker = new Worker(
        new URL('./csgWorker.ts', import.meta.url),
      );

      worker.addEventListener('message', (event: MessageEvent<CSGWorkerOutput>) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);

        if (!pending) return;

        const data = event.data;
        if (data.success && data.positions && data.normals && data.indices) {
          const geo = deserializeGeometry({
            positions: data.positions,
            normals: data.normals,
            indices: data.indices,
          });
          pending.resolve(geo);
        } else {
          const msg = data.error ?? 'CSG worker returned unknown error';
          reportError('csg', msg, { path: 'worker' });
          pending.reject(new Error(msg));
        }
      });

      worker.addEventListener('error', (event: ErrorEvent) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);

        const msg = event.message || 'CSG worker error';
        reportError('csg', msg, {
          path: 'worker_error_event',
          filename: event.filename,
          lineno: event.lineno,
        });
        if (pending) {
          pending.reject(new Error(msg));
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
        pending.reject(new Error('CSG worker terminated'));
      }
    };
  }, [spawnWorker]);

  /**
   * Run a CSG boolean operation, preferring the Web Worker and falling back to
   * synchronous execution on the main thread when the worker is unavailable.
   */
  const performCSG = useCallback(
    (
      type: 'union' | 'subtract' | 'intersect',
      geoA: THREE.BufferGeometry,
      geoB: THREE.BufferGeometry,
    ): Promise<THREE.BufferGeometry> => {
      // If worker is available and idle, use it
      if (workerRef.current && !pendingRef.current) {
        return new Promise<THREE.BufferGeometry>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            pendingRef.current = null;
            setLoading(false);
            const msg = 'CSG worker timed out (30s)';
            reportError('csg', msg, { path: 'worker_timeout', type });
            reject(new Error(msg));
          }, 30_000);

          pendingRef.current = {
            resolve: (r: THREE.BufferGeometry) => { clearTimeout(timeoutId); resolve(r); },
            reject: (e: Error) => { clearTimeout(timeoutId); reject(e); },
          };
          setLoading(true);
          try {
            const meshA = serializeGeometry(geoA);
            const meshB = serializeGeometry(geoB);

            const message: CSGWorkerInput = { type, meshA, meshB };

            workerRef.current!.postMessage(message, [
              meshA.positions.buffer,
              meshA.normals.buffer,
              meshA.indices.buffer,
              meshB.positions.buffer,
              meshB.normals.buffer,
              meshB.indices.buffer,
            ] as unknown as Transferable[]);
          } catch (err) {
            clearTimeout(timeoutId);
            pendingRef.current = null;
            setLoading(false);
            reportError('csg', err, { path: 'worker_postmessage_failure', type });
            reject(new Error('Failed to start CSG: ' + err));
          }
        });
      }

      // Fallback: synchronous on main thread
      return Promise.resolve(applyBooleanSync(type, geoA, geoB));
    },
    [],
  );

  /** Cancel any in-flight CSG work, terminate the worker, and re-spawn. */
  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      pending.reject(new Error('CSG cancelled'));
    }
    setLoading(false);
    spawnWorker();
  }, [spawnWorker]);

  return { performCSG, loading, cancel };
}
