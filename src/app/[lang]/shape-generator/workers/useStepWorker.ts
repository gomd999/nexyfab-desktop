'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { StepWorkerInput, StepWorkerOutput, SerializedGeometry, StepAnalysisStats } from './stepWorker';
import { trackGeometry } from '../hooks/useGeometryGC';

export interface StepWorkerResult {
  stats: StepAnalysisStats;
  dfmSuggestions: string[];
  geometry: THREE.BufferGeometry;
  parts: { name: string; geometry: THREE.BufferGeometry }[];
}

function deserializeGeometry(serialized: SerializedGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(serialized.positions, 3));
  if (serialized.normals) {
    geo.setAttribute('normal', new THREE.BufferAttribute(serialized.normals, 3));
  }
  if (serialized.indices) {
    geo.setIndex(new THREE.BufferAttribute(serialized.indices, 1));
  }
  if (!serialized.normals) {
    geo.computeVertexNormals();
  }
  trackGeometry(geo);
  return geo;
}

export function useStepWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    resolve: (r: StepWorkerResult) => void;
    reject: (e: Error) => void;
  } | null>(null);

  const [loading, setLoading] = useState(false);

  const spawnWorker = useCallback(() => {
    try {
      const worker = new Worker(
        new URL('./stepWorker.ts', import.meta.url)
      );

      worker.addEventListener('message', (event: MessageEvent<StepWorkerOutput>) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        if (!pending) return;

        const data = event.data;
        if (data.type === 'STEP_RESULT' && data.globalGeometry && data.stats) {
          const globalGeometry = deserializeGeometry(data.globalGeometry);
          const parts = (data.partsGeometry ?? []).map(p => ({
            name: p.name,
            geometry: deserializeGeometry(p.geometry)
          }));

          pending.resolve({
            stats: data.stats,
            dfmSuggestions: data.dfmSuggestions ?? [],
            geometry: globalGeometry,
            parts
          });
        } else {
          pending.reject(new Error(data.error ?? 'Step worker returned unknown error'));
        }
      });

      worker.addEventListener('error', (event: ErrorEvent) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        if (pending) pending.reject(new Error(event.message || 'Step worker error'));
      });

      workerRef.current = worker;
    } catch {
      workerRef.current = null;
    }
  }, []);

  useEffect(() => {
    spawnWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      if (pendingRef.current) {
        pendingRef.current.reject(new Error('Step worker terminated'));
        pendingRef.current = null;
      }
    };
  }, [spawnWorker]);

  const parseStep = useCallback(
    (buffer: ArrayBuffer, filename: string): Promise<StepWorkerResult> => {
      if (!workerRef.current) {
        return Promise.reject(new Error('Step worker not initialized'));
      }
      if (pendingRef.current) {
        pendingRef.current.reject(new Error('Step parsing superseded'));
        workerRef.current.terminate();
        spawnWorker();
      }

      return new Promise<StepWorkerResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingRef.current = null;
          setLoading(false);
          reject(new Error('Step parsing timed out (60s)'));
        }, 60_000);

        pendingRef.current = {
          resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
          reject: (e) => { clearTimeout(timeoutId); reject(e); },
        };
        setLoading(true);

        try {
          const message: StepWorkerInput = {
            type: 'PARSE_STEP',
            payload: { buffer, filename },
          };
          workerRef.current!.postMessage(message, [buffer]);
        } catch (err) {
          clearTimeout(timeoutId);
          pendingRef.current = null;
          setLoading(false);
          reject(new Error('Failed to post message to step worker: ' + err));
        }
      });
    },
    [spawnWorker]
  );

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (pendingRef.current) {
      pendingRef.current.reject(new Error('Step parsing cancelled'));
      pendingRef.current = null;
    }
    setLoading(false);
    spawnWorker();
  }, [spawnWorker]);

  return { parseStep, loading, cancel };
}
