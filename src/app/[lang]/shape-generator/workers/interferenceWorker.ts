/**
 * Interference-detection Web Worker.
 *
 * Runs the O(n²) part-pair intersection check off the main thread so large
 * assemblies (50+ parts) don't freeze the UI. Receives serialized geometry +
 * transform matrices as transferable ArrayBuffers; returns serialized pair
 * results (the main thread reconstructs THREE.Box3 from min/max arrays).
 *
 * **M3-P2:** Matrices must match the same world frames as assembly preview / nfab
 * placement — built upstream via `bomPartWorldMatrixFromBom` + `placedPartsToBomResults`.
 */

/* webpackChunkName: "interference-worker" */

import * as THREE from 'three';
import { recommendedMaxTriPairsForPartCount } from '@/lib/assemblyLoadPolicy';

export interface SerializedPart {
  id: string;
  positions: Float32Array;
  indices?: Uint32Array;
  /** 16-element column-major matrix */
  transform: Float32Array;
}

export interface SerializedInterferenceResult {
  partA: string;
  partB: string;
  volume: number;
  /** Overlap AABB min (x,y,z) in world space */
  min: [number, number, number];
  max: [number, number, number];
}

export interface InterferenceWorkerInput {
  type: 'RUN_INTERFERENCE';
  payload: {
    parts: SerializedPart[];
    maxTriPairsPerCheck?: number;
  };
}

export interface InterferenceWorkerOutput {
  type: 'INTERFERENCE_RESULT' | 'INTERFERENCE_ERROR';
  results?: SerializedInterferenceResult[];
  error?: string;
}

const ctx = self as unknown as Worker;

ctx.addEventListener('message', async (event: MessageEvent<InterferenceWorkerInput>) => {
  const { type, payload } = event.data;
  if (type !== 'RUN_INTERFERENCE') return;

  try {
    const partsInput = payload.parts.map(p => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      if (p.indices) geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
      geo.computeBoundingBox();
      const mat = new THREE.Matrix4().fromArray(p.transform);
      return { id: p.id, geometry: geo, transform: mat };
    });

    const { detectInterference } = await import('../assembly/InterferenceDetection');
    const triBudget =
      payload.maxTriPairsPerCheck ?? recommendedMaxTriPairsForPartCount(partsInput.length);
    const raw = detectInterference(partsInput, triBudget);

    const results: SerializedInterferenceResult[] = raw.map(r => ({
      partA: r.partA,
      partB: r.partB,
      volume: r.volume,
      min: [r.boundingBox.min.x, r.boundingBox.min.y, r.boundingBox.min.z],
      max: [r.boundingBox.max.x, r.boundingBox.max.y, r.boundingBox.max.z],
    }));

    const output: InterferenceWorkerOutput = { type: 'INTERFERENCE_RESULT', results };
    ctx.postMessage(output);
  } catch (err) {
    const output: InterferenceWorkerOutput = {
      type: 'INTERFERENCE_ERROR',
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(output);
  }
});
