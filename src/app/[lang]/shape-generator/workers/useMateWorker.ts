'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
import type { MateWorkerInput, MateWorkerOutput } from './mateWorker';
import {
  solveAssembly,
  type AssemblyState,
  type AssemblyBody,
  type Mate,
  type SolveResult,
} from '../assembly/matesSolver';
import { reportError } from '../lib/telemetry';

// ─── Serialisation ──────────────────────────────────────────────────────────

type Vec3Tuple = [number, number, number];

function bodyToWire(b: AssemblyBody): MateWorkerInput['bodies'][number] {
  return {
    name: b.name,
    position: [b.position.x, b.position.y, b.position.z],
    rotation: [b.rotation.x, b.rotation.y, b.rotation.z],
    fixed: b.fixed,
  };
}

function mateToWire(m: Mate): MateWorkerInput['mates'][number] {
  const s0 = m.selections[0];
  const s1 = m.selections[1];
  return {
    id: m.id,
    type: m.type,
    selections: [
      {
        bodyIndex: s0.bodyIndex,
        type: s0.type,
        localPoint: [s0.localPoint.x, s0.localPoint.y, s0.localPoint.z],
        localNormal: [s0.localNormal.x, s0.localNormal.y, s0.localNormal.z],
        localAxis: s0.localAxis ? [s0.localAxis.x, s0.localAxis.y, s0.localAxis.z] : undefined,
      },
      {
        bodyIndex: s1.bodyIndex,
        type: s1.type,
        localPoint: [s1.localPoint.x, s1.localPoint.y, s1.localPoint.z],
        localNormal: [s1.localNormal.x, s1.localNormal.y, s1.localNormal.z],
        localAxis: s1.localAxis ? [s1.localAxis.x, s1.localAxis.y, s1.localAxis.z] : undefined,
      },
    ],
    distance: m.distance,
    angle: m.angle,
    gearRatio: m.gearRatio,
    enabled: m.enabled,
    conflict: m.conflict,
  };
}

function wireToSolveResult(out: MateWorkerOutput): SolveResult {
  const bodies = (out.bodies ?? []).map(b => ({
    position: new THREE.Vector3(b.position[0], b.position[1], b.position[2]),
    rotation: new THREE.Euler(b.rotation[0], b.rotation[1], b.rotation[2]),
  }));
  return {
    bodies,
    unsatisfied: out.unsatisfied ?? [],
    conflicts: out.conflicts ?? [],
    remainingDOF: out.remainingDOF ?? 0,
    converged: out.converged ?? false,
    iterations: out.iterations ?? 0,
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useMateWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    resolve: (r: SolveResult) => void;
    reject: (err: Error) => void;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const spawnWorker = useCallback(() => {
    try {
      const worker = new Worker(new URL('./mateWorker.ts', import.meta.url));
      worker.addEventListener('message', (event: MessageEvent<MateWorkerOutput>) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        if (!pending) return;
        const data = event.data;
        if (data.success) {
          pending.resolve(wireToSolveResult(data));
        } else {
          pending.reject(new Error(data.error ?? 'mate worker failed'));
        }
      });
      worker.addEventListener('error', (e) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setLoading(false);
        pending?.reject(new Error(e.message || 'mate worker error'));
      });
      workerRef.current = worker;
      return worker;
    } catch (err) {
      reportError('feature_pipeline', err, { phase: 'mate_worker_spawn' });
      return null;
    }
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingRef.current = null;
    };
  }, []);

  /**
   * Solve the assembly off the main thread, falling back to the synchronous
   * solver if the worker can't be spawned (Tauri/SSR/older browsers).
   */
  const performSolve = useCallback(
    async (state: AssemblyState, maxIterations = 200): Promise<SolveResult> => {
      // Fallback: no Worker support
      if (typeof Worker === 'undefined') {
        return solveAssembly(state, maxIterations);
      }

      let worker = workerRef.current;
      if (!worker) worker = spawnWorker();
      if (!worker) {
        return solveAssembly(state, maxIterations);
      }

      // Drop any in-flight call (last-write-wins for Solve clicks).
      if (pendingRef.current) {
        pendingRef.current.reject(new Error('superseded'));
        pendingRef.current = null;
      }

      setLoading(true);
      const promise = new Promise<SolveResult>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
      });

      const input: MateWorkerInput = {
        bodies: state.bodies.map(bodyToWire),
        mates: state.mates.map(mateToWire),
        maxIterations,
      };
      worker.postMessage(input);

      return promise;
    },
    [spawnWorker],
  );

  return { performSolve, loading };
}

// Re-exported for tests/debugging.
export type { Vec3Tuple };
