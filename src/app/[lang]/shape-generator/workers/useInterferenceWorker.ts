'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { recommendedMaxTriPairsForPartCount } from '@/lib/assemblyLoadPolicy';
import * as THREE from 'three';
import type { InterferenceResult } from '../assembly/InterferenceDetection';
import type {
  InterferenceWorkerInput,
  InterferenceWorkerOutput,
  SerializedPart,
} from './interferenceWorker';

export interface PartInput {
  id: string;
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
}

function serializePart(p: PartInput): { part: SerializedPart; transfers: ArrayBuffer[] } {
  const positions = new Float32Array(
    (p.geometry.attributes.position as THREE.BufferAttribute).array,
  );
  const indices = p.geometry.index
    ? new Uint32Array(p.geometry.index.array)
    : undefined;
  const transform = new Float32Array(p.transform.elements);

  const transfers: ArrayBuffer[] = [
    positions.buffer as ArrayBuffer,
    transform.buffer as ArrayBuffer,
  ];
  if (indices) transfers.push(indices.buffer as ArrayBuffer);

  return {
    part: { id: p.id, positions, indices, transform },
    transfers,
  };
}

export function useInterferenceWorker() {
  const workerRef = useRef<Worker | null>(null);
  /** 메인 스레드 cooperative 간섭 실행 중 취소용 */
  const cooperativeAbortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<{
    resolve: (r: InterferenceResult[]) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const spawnWorker = useCallback(() => {
    try {
      const worker = new Worker(
        /* webpackChunkName: "interference-worker" */
        new URL('./interferenceWorker.ts', import.meta.url),
      );

      worker.addEventListener('message', (event: MessageEvent<InterferenceWorkerOutput>) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        if (!pending) return;

        const data = event.data;
        if (data.type === 'INTERFERENCE_RESULT' && data.results) {
          const hydrated: InterferenceResult[] = data.results.map(r => ({
            partA: r.partA,
            partB: r.partB,
            volume: r.volume,
            boundingBox: new THREE.Box3(
              new THREE.Vector3(...r.min),
              new THREE.Vector3(...r.max),
            ),
          }));
          pending.resolve(hydrated);
        } else {
          pending.reject(new Error(data.error ?? 'Interference worker error'));
        }
      });

      worker.addEventListener('error', (event: ErrorEvent) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        if (pending) pending.reject(new Error(event.message || 'Interference worker error'));
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
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        pending.reject(new Error('Interference worker terminated'));
      }
    };
  }, [spawnWorker]);

  /** Same `PartInput` transforms the viewport would use for interference (see M3-P2). */
  const detect = useCallback(
    async (parts: PartInput[], maxTriPairsPerCheck?: number): Promise<InterferenceResult[]> => {
      if (workerRef.current && !pendingRef.current) {
        cooperativeAbortRef.current?.abort();
        cooperativeAbortRef.current = null;
        return new Promise<InterferenceResult[]>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            pendingRef.current = null;
            setLoading(false);
            reject(new Error('Interference detection timed out (60s)'));
          }, 60_000);

          pendingRef.current = {
            resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
            reject: (e) => { clearTimeout(timeoutId); reject(e); },
          };
          setLoading(true);
          try {
            const serialized = parts.map(serializePart);
            const msg: InterferenceWorkerInput = {
              type: 'RUN_INTERFERENCE',
              payload: {
                parts: serialized.map(s => s.part),
                maxTriPairsPerCheck,
              },
            };
            const transfers = serialized.flatMap(s => s.transfers);
            workerRef.current!.postMessage(msg, transfers as unknown as Transferable[]);
          } catch (err) {
            clearTimeout(timeoutId);
            pendingRef.current = null;
            setLoading(false);
            reject(new Error('Failed to start interference check: ' + err));
          }
        });
      }

      // Fallback: cooperative scheduling on main thread (sweep broad-phase + idle yield).
      cooperativeAbortRef.current?.abort();
      const ac = new AbortController();
      cooperativeAbortRef.current = ac;
      setLoading(true);
      try {
        const { detectInterferenceCooperative } = await import('../assembly/InterferenceDetection');
        const triBudget = maxTriPairsPerCheck ?? recommendedMaxTriPairsForPartCount(parts.length);
        return await detectInterferenceCooperative(parts, triBudget, { signal: ac.signal });
      } finally {
        setLoading(false);
        if (cooperativeAbortRef.current === ac) cooperativeAbortRef.current = null;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    cooperativeAbortRef.current?.abort();
    cooperativeAbortRef.current = null;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      pending.reject(new Error('Interference check cancelled'));
    }
    setLoading(false);
    spawnWorker();
  }, [spawnWorker]);

  return { detect, loading, cancel };
}
