/**
 * DFM Web Worker — performs Design for Manufacturability analysis off the main thread.
 *
 * Receives serialized geometry data (positions, normals, indices) as transferable
 * ArrayBuffers, reconstructs a BufferGeometry, runs analyzeDFM, then posts the
 * result back.
 */

/* webpackChunkName: "dfm-worker" */

import * as THREE from 'three';
import type { ManufacturingProcess, DFMResult, DFMOptions } from '../analysis/dfmAnalysis';

// ─── Message types ──────────────────────────────────────────────────────────

export interface DFMWorkerInput {
  type: 'RUN_DFM';
  payload: {
    positions: Float32Array;
    normals?: Float32Array;
    indices?: Uint32Array;
    processes: ManufacturingProcess[];
    options?: DFMOptions;
  };
}

export interface DFMWorkerOutput {
  type: 'DFM_RESULT' | 'DFM_ERROR';
  results?: DFMResult[];
  error?: string;
}

// ─── Worker message handler ─────────────────────────────────────────────────

const ctx = self as unknown as Worker;

ctx.addEventListener('message', async (event: MessageEvent<DFMWorkerInput>) => {
  const { type, payload } = event.data;

  if (type === 'RUN_DFM') {
    try {
      const { positions, normals, indices, processes, options } = payload;

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

      const { analyzeDFM } = await import('../analysis/dfmAnalysis');
      const results = analyzeDFM(geo, processes, options);

      const output: DFMWorkerOutput = { type: 'DFM_RESULT', results };
      ctx.postMessage(output);
    } catch (err) {
      const output: DFMWorkerOutput = {
        type: 'DFM_ERROR',
        error: err instanceof Error ? err.message : String(err),
      };
      ctx.postMessage(output);
    }
  }
});
