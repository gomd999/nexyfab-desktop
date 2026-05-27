'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { JscadWorkerInput, JscadWorkerOutput, SerializedGeometry } from './jscadWorker';

export interface JscadWorkerResult {
  geometry: THREE.BufferGeometry;
  warnings: string[];
  triCount: number;
}

const HARD_TIMEOUT_MS = 12_000; // worker is terminate()d past this — real kill

function deserialize(s: SerializedGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
  if (s.normals) geo.setAttribute('normal', new THREE.BufferAttribute(s.normals, 3));
  if (s.indices) geo.setIndex(new THREE.BufferAttribute(s.indices, 1));
  if (!s.normals) geo.computeVertexNormals();
  return geo;
}

/**
 * useJscadWorker — runs AI-generated @jscad/modeling code off the main thread.
 *
 * Unlike the legacy main-thread `runJscadCode` (which can only *soft*-guard via
 * a deadline-aware Math proxy), this can hard-`terminate()` a runaway worker on
 * timeout, then respawn a fresh one — the UI never blocks or hangs.
 *
 * Mirrors the proven `useStepWorker` lifecycle (spawn on mount, terminate on
 * unmount, supersede in-flight runs, timeout → kill + respawn).
 */
export function useJscadWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{ resolve: (r: JscadWorkerResult) => void; reject: (e: Error) => void } | null>(null);
  const [loading, setLoading] = useState(false);

  const spawnWorker = useCallback(() => {
    try {
      const worker = new Worker(new URL('./jscadWorker.ts', import.meta.url));
      worker.addEventListener('message', (event: MessageEvent<JscadWorkerOutput>) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        if (!pending) return;
        const d = event.data;
        if (d.type === 'JSCAD_RESULT' && d.geometry) {
          pending.resolve({ geometry: deserialize(d.geometry), warnings: d.warnings ?? [], triCount: d.triCount ?? 0 });
        } else {
          pending.reject(new Error(d.error ?? 'JSCAD worker returned no geometry'));
        }
      });
      worker.addEventListener('error', (event: ErrorEvent) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        if (pending) pending.reject(new Error(event.message || 'JSCAD worker error'));
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
        pendingRef.current.reject(new Error('JSCAD worker terminated'));
        pendingRef.current = null;
      }
    };
  }, [spawnWorker]);

  const runJscad = useCallback((code: string): Promise<JscadWorkerResult> => {
    if (!workerRef.current) return Promise.reject(new Error('JSCAD worker not initialized'));
    if (pendingRef.current) {
      pendingRef.current.reject(new Error('JSCAD run superseded'));
      workerRef.current.terminate();
      spawnWorker();
    }
    return new Promise<JscadWorkerResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Hard kill: terminate the runaway worker and respawn a clean one.
        workerRef.current?.terminate();
        workerRef.current = null;
        pendingRef.current = null;
        setLoading(false);
        spawnWorker();
        reject(new Error('JSCAD run timed out — worker terminated'));
      }, HARD_TIMEOUT_MS);

      pendingRef.current = {
        resolve: (r) => { clearTimeout(timeoutId); resolve(r); },
        reject: (e) => { clearTimeout(timeoutId); reject(e); },
      };
      setLoading(true);
      try {
        const message: JscadWorkerInput = { type: 'RUN_JSCAD', payload: { code } };
        workerRef.current!.postMessage(message);
      } catch (err) {
        clearTimeout(timeoutId);
        pendingRef.current = null;
        setLoading(false);
        reject(new Error('Failed to post message to JSCAD worker: ' + err));
      }
    });
  }, [spawnWorker]);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (pendingRef.current) {
      pendingRef.current.reject(new Error('JSCAD run cancelled'));
      pendingRef.current = null;
    }
    setLoading(false);
    spawnWorker();
  }, [spawnWorker]);

  return { runJscad, loading, cancel };
}
