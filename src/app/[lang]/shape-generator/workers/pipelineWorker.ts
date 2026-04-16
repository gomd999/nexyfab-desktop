/**
 * Geometry Feature Pipeline Web Worker.
 *
 * Runs applyFeaturePipelineDetailed off the main thread so heavy CSG /
 * fillet / sweep computations don't freeze the viewport.
 *
 * Protocol
 * ────────
 * IN  { type: 'RUN_PIPELINE', payload: { positions, normals?, indices?,
 *         features: FeatureInstance[], occtMode?: boolean } }
 *
 * OUT { type: 'PIPELINE_RESULT',
 *         positions, normals, indices, errors: Record<string, string> }
 *   | { type: 'PIPELINE_ERROR', error: string }
 */

/* webpackChunkName: "pipeline-worker" */

import * as THREE from 'three';
import type { FeatureInstance } from '../features/types';

// ─── Message types ───────────────────────────────────────────────────────────

export interface PipelineWorkerInput {
  type: 'RUN_PIPELINE';
  payload: {
    positions: Float32Array;
    normals?: Float32Array;
    indices?: Uint32Array;
    features: FeatureInstance[];
    occtMode?: boolean;
  };
}

export interface PipelineWorkerOutput {
  type: 'PIPELINE_RESULT' | 'PIPELINE_ERROR';
  /** Serialised output geometry — present on PIPELINE_RESULT */
  positions?: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
  errors?: Record<string, string>;
  error?: string;
}

// ─── Worker handler ──────────────────────────────────────────────────────────

const ctx = self as unknown as Worker;

ctx.addEventListener('message', async (event: MessageEvent<PipelineWorkerInput>) => {
  const { type, payload } = event.data;
  if (type !== 'RUN_PIPELINE') return;

  try {
    const { positions, normals, indices, features, occtMode } = payload;

    // Reconstruct base geometry from transferable arrays
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normals) baseGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (indices) baseGeo.setIndex(new THREE.BufferAttribute(indices, 1));
    if (!normals) baseGeo.computeVertexNormals();

    // Run pipeline (uses built-in FEATURE_MAP; no function refs needed from caller)
    const { applyFeaturePipelineDetailedAsync, applyFeaturePipelineDetailed } =
      await import('../features/index');

    let result: { geometry: THREE.BufferGeometry; errors: Record<string, string> };
    if (occtMode) {
      result = await applyFeaturePipelineDetailedAsync(baseGeo, features, { occtMode: true });
    } else {
      result = applyFeaturePipelineDetailed(baseGeo, features);
    }

    // Serialise output geometry as transferable arrays
    const outGeo = result.geometry;
    const outPositions = new Float32Array(
      (outGeo.attributes.position as THREE.BufferAttribute).array,
    );
    const outNormals = outGeo.attributes.normal
      ? new Float32Array((outGeo.attributes.normal as THREE.BufferAttribute).array)
      : undefined;
    const outIndices = outGeo.index
      ? new Uint32Array(outGeo.index.array)
      : undefined;

    const output: PipelineWorkerOutput = {
      type: 'PIPELINE_RESULT',
      positions: outPositions,
      normals: outNormals,
      indices: outIndices,
      errors: result.errors,
    };

    const transferables: ArrayBuffer[] = [outPositions.buffer as ArrayBuffer];
    if (outNormals) transferables.push(outNormals.buffer as ArrayBuffer);
    if (outIndices) transferables.push(outIndices.buffer as ArrayBuffer);

    ctx.postMessage(output, transferables as unknown as Transferable[]);
  } catch (err) {
    const output: PipelineWorkerOutput = {
      type: 'PIPELINE_ERROR',
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(output);
  }
});
