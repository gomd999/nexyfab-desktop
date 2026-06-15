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

import './ensureWorkerWindow';
import * as THREE from 'three';
import type { FeatureInstance } from '../features/types';
import { collectDowngrades, type MeshDowngradeNotice } from '../features/downgradeNotice';
import {
  extractFaceProvenance,
  applyFaceProvenance,
  faceProvenanceTransferables,
  type FaceProvenancePayload,
} from './faceProvenanceTransfer';

// ─── Message types ───────────────────────────────────────────────────────────

export interface PipelineWorkerInput {
  type: 'RUN_PIPELINE';
  payload: {
    positions: Float32Array;
    normals?: Float32Array;
    indices?: Uint32Array;
    features: FeatureInstance[];
    occtMode?: boolean;
    baseSpec?: { shapeId: string; params: Record<string, number> };
    /** Face provenance of the base geometry (per-vertex feature-id attribute
     *  + topology userData maps) — BufferAttributes/userData don't survive
     *  postMessage, so the caller ships them explicitly and we re-attach
     *  before running the pipeline (base-shape topo stamps feed the carried
     *  `topoFaceMapByFeature` merge in pipelineManager). */
    faceProvenance?: FaceProvenancePayload;
  };
}

export interface PipelineWorkerOutput {
  type: 'PIPELINE_RESULT' | 'PIPELINE_ERROR' | 'PIPELINE_PROGRESS';
  /** Progress percentage */
  progress?: number;
  /** Progress label */
  label?: string;
  /** Serialised output geometry — present on PIPELINE_RESULT */
  positions?: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
  errors?: Record<string, string>;
  error?: string;
  /** Stable topology data (plain JSON) so the main thread can tag selections
   *  with rebuild-stable edge ids — userData itself doesn't cross the boundary. */
  topoEdgeSignatures?: { id: string; mid: [number, number, number]; dir: [number, number, number]; length: number }[];
  /** OCCT→mesh downgrade notices (plain JSON) — like topoEdgeSignatures, userData
   *  is dropped at the worker boundary, so we ferry them as an explicit field and
   *  re-attach on the main thread (else the downgrade banner is blind to the
   *  worker path, the primary production eval). */
  meshDowngrades?: MeshDowngradeNotice[];
  /** Face provenance (per-vertex `nfabFaceFeatureId` attribute + topology
   *  userData maps) — same boundary problem as topoEdgeSignatures: without
   *  this explicit ferry, persistent face selection silently degrades to
   *  coplanar-group heuristics on the worker path. */
  faceProvenance?: FaceProvenancePayload;
}

// ─── Worker handler ──────────────────────────────────────────────────────────

const ctx = self as unknown as Worker;

ctx.addEventListener('message', async (event: MessageEvent<PipelineWorkerInput>) => {
  const { type, payload } = event.data;
  if (type !== 'RUN_PIPELINE') return;

  try {
    const { positions, normals, indices, features, occtMode, baseSpec, faceProvenance } = payload;

    // Reconstruct base geometry from transferable arrays
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normals) baseGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (indices) baseGeo.setIndex(new THREE.BufferAttribute(indices, 1));
    if (!normals) baseGeo.computeVertexNormals();
    // Restore the base geometry's face provenance (attribute + topo userData)
    // so the pipeline carries it forward exactly like the sync path does.
    applyFaceProvenance(baseGeo, faceProvenance);

    // Run pipeline (uses built-in FEATURE_MAP; no function refs needed from caller)
    const { applyFeaturePipelineDetailedAsync, applyFeaturePipelineDetailed } =
      await import('../features/index');

    let result: { geometry: THREE.BufferGeometry; errors: Record<string, string> };
    const onProgress = (progress: number, label: string) => {
      ctx.postMessage({
        type: 'PIPELINE_PROGRESS',
        progress,
        label,
      } satisfies PipelineWorkerOutput);
    };

    if (occtMode) {
      result = await applyFeaturePipelineDetailedAsync(baseGeo, features, { occtMode: true, onProgress, baseSpec });
    } else {
      result = applyFeaturePipelineDetailed(baseGeo, features);
    }

    // Serialise output geometry as transferable arrays
    const outGeo = result.geometry;
    const posAttr = outGeo.getAttribute('position') as THREE.BufferAttribute | null;
    if (!posAttr?.array) {
      ctx.postMessage({
        type: 'PIPELINE_ERROR',
        error: 'Pipeline output has no position buffer (cannot serialise mesh).',
      } satisfies PipelineWorkerOutput);
      return;
    }
    const outPositions = new Float32Array(posAttr.array);
    const normAttr = outGeo.getAttribute('normal') as THREE.BufferAttribute | null;
    const outNormals = normAttr?.array
      ? new Float32Array(normAttr.array)
      : undefined;
    const outIndices = outGeo.index?.array
      ? new Uint32Array(outGeo.index.array)
      : undefined;

    const outFaceProvenance = extractFaceProvenance(outGeo);

    const output: PipelineWorkerOutput = {
      type: 'PIPELINE_RESULT',
      positions: outPositions,
      normals: outNormals,
      indices: outIndices,
      errors: result.errors,
      topoEdgeSignatures: outGeo.userData?.topoEdgeSignatures as PipelineWorkerOutput['topoEdgeSignatures'],
      meshDowngrades: collectDowngrades(outGeo),
      faceProvenance: outFaceProvenance,
    };

    const transferables: ArrayBuffer[] = [outPositions.buffer as ArrayBuffer];
    if (outNormals) transferables.push(outNormals.buffer as ArrayBuffer);
    if (outIndices) transferables.push(outIndices.buffer as ArrayBuffer);
    transferables.push(...faceProvenanceTransferables(outFaceProvenance));

    ctx.postMessage(output, transferables as unknown as Transferable[]);
  } catch (err) {
    const output: PipelineWorkerOutput = {
      type: 'PIPELINE_ERROR',
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(output);
  }
});
