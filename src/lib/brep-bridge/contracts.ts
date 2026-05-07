/**
 * Shared types for the server-side STEP/B-Rep bridge.
 *
 * HTTP: `POST /api/nexyfab/brep/step-import`, poll `GET …/brep/step-import/job/[id]`.
 * Multi-instance queue: `REDIS_URL` → Redis keys `nf:brep:queue`, `nf:brep:job:{id}` (same pattern as OpenSCAD jobs).
 * Optional tessellation: set `BREP_WORKER_URL`; worker must expose `POST {url}/tessellate` with JSON
 * `{ filename, base64, jobId }` and optional JSON body `{ previewMeshBase64?, artifactUrl?, brepSessionToken?, error? }`.
 */

export type BrepStepJobStatus = 'queued' | 'processing' | 'complete' | 'failed';

/** Input reference: inline base64 (dev) or object-store key (prod). */
export type BrepStepInput =
  | { kind: 'inlineBase64'; base64: string; filename: string }
  | { kind: 'objectKey'; key: string; filename: string };

export interface BrepStepJobRequest {
  /** Correlates with analytics / PDM; optional for anonymous import. */
  userId?: string;
  input: BrepStepInput;
  /** Tessellation quality hint for mesh preview. */
  linearDeflectionMm?: number;
  angularDeflectionDeg?: number;
}

/** Mesh or glTF URL for viewer; B-Rep kept server-side until client can consume. */
export interface BrepStepJobResult {
  jobId: string;
  status: BrepStepJobStatus;
  /** Optional tessellated preview (small models only). */
  previewMeshBase64?: string;
  /** Signed GET URL for STL/glTF/blob when large. */
  artifactUrl?: string;
  /** Stable handle for later boolean/feature ops if OCCT session stays warm. */
  brepSessionToken?: string;
  errorMessage?: string;
}
