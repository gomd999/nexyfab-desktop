/**
 * FEA Web Worker — performs Finite Element Analysis off the main thread.
 *
 * Receives serialized geometry data (positions, normals, indices) as transferable
 * ArrayBuffers, reconstructs a BufferGeometry, runs runSimpleFEA, then serialises
 * the Float32Array results back.
 */

/* webpackChunkName: "fea-worker" */

import * as THREE from 'three';
import type { FEAMaterial, FEABoundaryCondition, FEAResult } from '../analysis/simpleFEA';

// ─── Message types ──────────────────────────────────────────────────────────

export interface FEAWorkerInput {
  type: 'RUN_FEA';
  payload: {
    positions: Float32Array;
    normals?: Float32Array;
    indices?: Uint32Array;
    material: FEAMaterial;
    conditions: FEABoundaryCondition[];
  };
}

export interface FEAWorkerOutput {
  type: 'FEA_RESULT' | 'FEA_ERROR';
  result?: FEAResult;
  error?: string;
}

// ─── Worker message handler ─────────────────────────────────────────────────

const ctx = self as unknown as Worker;

ctx.addEventListener('message', async (event: MessageEvent<FEAWorkerInput>) => {
  const { type, payload } = event.data;

  if (type === 'RUN_FEA') {
    try {
      const { positions, normals, indices, material, conditions } = payload;

      // Reconstruct BufferGeometry from raw arrays
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      if (normals) {
        geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      }
      if (indices) {
        geo.setIndex(new THREE.BufferAttribute(indices, 1));
      }
      if (!normals) {
        geo.computeVertexNormals();
      }

      const { runSimpleFEA } = await import('../analysis/simpleFEA');
      const result = runSimpleFEA(geo, { material, conditions });

      const output: FEAWorkerOutput = { type: 'FEA_RESULT', result };

      // Transfer the underlying buffers (zero-copy)
      ctx.postMessage(output, [
        result.vonMisesStress.buffer,
        result.displacement.buffer,
        result.displacementVectors.buffer,
      ] as unknown as Transferable[]);
    } catch (err) {
      const output: FEAWorkerOutput = {
        type: 'FEA_ERROR',
        error: err instanceof Error ? err.message : String(err),
      };
      ctx.postMessage(output);
    }
  }
});
