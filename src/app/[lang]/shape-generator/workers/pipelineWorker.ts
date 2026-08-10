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
import {
  handleProjectViewsRequest,
  type DrawingViewName,
  type ProjectedViewData,
} from './projectViewsRpc';
import { handleExportStepRequest } from './exportStepRpc';

// ─── Message types ───────────────────────────────────────────────────────────

/** F-4 후속(260808g) — 워커 소유 B-rep 핸들의 HLR 투영 RPC. 워커 파이프라인
 *  결과의 occtHandle 은 워커측 레지스트리 소속이라 메인 스레드 occtProjectViews
 *  로는 조회 불가(실측) — 투영을 핸들이 사는 컨텍스트에서 수행한다. */
export interface ProjectViewsInput {
  type: 'PROJECT_VIEWS';
  payload: {
    requestId: number;
    handle: string;
    views: DrawingViewName[];
  };
}

export interface ExportStepInput {
  type: 'EXPORT_STEP';
  payload: { requestId: number; handle: string };
}

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
  type: 'PIPELINE_RESULT' | 'PIPELINE_ERROR' | 'PIPELINE_PROGRESS' | 'PROJECT_RESULT' | 'EXPORT_STEP_RESULT';
  /** PROJECT_VIEWS RPC 상관관계 id — PROJECT_RESULT 에만. */
  requestId?: number;
  /** PROJECT_RESULT: 뷰별 SVG 경로(직렬화 가능한 순수 데이터) 또는 실패 null. */
  projectedViews?: Record<string, ProjectedViewData> | null;
  /** Exact STEP text exported inside the registry-owning worker. */
  stepText?: string | null;
  /** 파이프라인 결과의 B-rep 핸들(워커 레지스트리 소속 — PROJECT_VIEWS 로만
   *  사용 가능, 메인 스레드 레지스트리에선 조회 불가). */
  occtHandle?: string | null;
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

ctx.addEventListener('message', async (event: MessageEvent<PipelineWorkerInput | ProjectViewsInput | ExportStepInput>) => {
  const { type } = event.data;
  if (type === 'PROJECT_VIEWS') {
    const response = await handleProjectViewsRequest(event.data.payload);
    ctx.postMessage(response satisfies PipelineWorkerOutput);
    return;
  }
  if (type === 'EXPORT_STEP') {
    const response = await handleExportStepRequest(event.data.payload);
    ctx.postMessage(response satisfies PipelineWorkerOutput);
    return;
  }
  if (type !== 'RUN_PIPELINE') return;
  const { payload } = event.data;

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
      // F-4 후속 — 핸들 페리(워커 레지스트리 소속임을 소비자가 알도록 명시).
      occtHandle: (outGeo.userData?.occtHandle as string | undefined) ?? null,
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
