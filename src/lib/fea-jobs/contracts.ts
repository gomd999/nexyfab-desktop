export const FEA_QUEUE_KEY = 'nf:fea:queue';
export const FEA_PROCESSING_KEY = 'nf:fea:processing';
export const FEA_JOB_PREFIX = 'nf:fea:job:';
export const FEA_IDEMPOTENCY_PREFIX = 'nf:fea:idem:';
export const FEA_OWNER_PENDING_PREFIX = 'nf:fea:owner-pending:';

export const FEA_JOB_TTL_SECONDS = 24 * 60 * 60;
export const FEA_MAX_STL_BYTES = 20 * 1024 * 1024;
export const FEA_MAX_SCAD_BYTES = 512 * 1024;
export const FEA_MAX_DOF = 90_000;
export const FEA_DEFAULT_TIMEOUT_MS = 180_000;
export const FEA_MAX_TIMEOUT_MS = 300_000;
export const FEA_DEFAULT_MEMORY_MB = 1024;
export const FEA_MAX_ATTEMPTS = 3;
export const FEA_MAX_OWNER_PENDING = 3;

export type FeaJobStatus =
  | 'queued'
  | 'processing'
  | 'retrying'
  | 'cancel_requested'
  | 'cancelled'
  | 'complete'
  | 'failed';

export type FeaResultGrade = 'certification-candidate' | 'engineering' | 'screening';

export type FeaJobSource =
  | { kind: 'stl'; dataBase64: string }
  | { kind: 'scad'; source: string };

export interface FeaJobRequest {
  source: FeaJobSource;
  materialKey: string;
  loadN: number;
  loadNote: string;
  precise: boolean;
  limits: {
    maxDof: number;
    timeoutMs: number;
    memoryMb: number;
  };
}

export interface FeaJobResult {
  method: 'linear-fem-tet' | 'beam-theory';
  grade: FeaResultGrade;
  maxStressMPa: number;
  minStressMPa: number;
  maxDisplacementMm: number;
  safetyFactor: number | null;
  elementCount: number;
  dofCount: number;
  converged: boolean;
  material: { key: string; label: string; yieldMPa: number };
  mesh: { triangles: number; fixedTris: number; loadTris: number };
  refined: { maxNodes: number; screeningSF: number; screeningMaxStress: number } | null;
  raiser: {
    detected: boolean;
    applied: boolean;
    grade: FeaResultGrade;
    meshMode?: 'refined' | 'gmsh-conforming';
    gmshError?: string;
    dofCount: number;
    converged: boolean;
    wallMs: number;
    note: string;
  } | null;
  reportHtml: string;
  expertApproval: null;
  manufacturingReady: false;
  completedAt: number;
}

export interface FeaJobProgress {
  percent: number;
  stage: 'queued' | 'preparing' | 'rendering' | 'solving' | 'packaging' | 'retrying' | 'cancelled' | 'complete';
  message?: string;
}

export interface SerializedFeaJob {
  id: string;
  ownerUserId: string;
  scopeId: string;
  projectId?: string;
  status: FeaJobStatus;
  progress: FeaJobProgress;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  attempts: number;
  maxAttempts: number;
  requestHash: string;
  idempotencyHash: string;
  request?: FeaJobRequest;
  result?: FeaJobResult;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  cancelRequested?: boolean;
  leaseToken?: string;
  leaseExpiresAt?: number;
  heartbeatAt?: number;
}

export interface FeaJobSubmission {
  ownerUserId: string;
  scopeId: string;
  projectId?: string;
  idempotencyKey?: string;
  request: unknown;
}

export type FeaSubmissionValidation =
  | { ok: true; request: FeaJobRequest }
  | { ok: false; code: string; message: string };

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validBinaryStl(buffer: Buffer): boolean {
  if (buffer.length < 84) return false;
  const triangles = buffer.readUInt32LE(80);
  return 84 + triangles * 50 === buffer.length;
}

function validateScadSource(source: string): boolean {
  if (source.includes('\0')) return false;
  // The worker's WASM FS has no host mount, but reject every external-file
  // primitive as an additional boundary. Parametric primitives remain valid.
  return !/\b(?:include|use|import|surface)\b/i.test(source);
}

export function validateFeaJobRequest(value: unknown): FeaSubmissionValidation {
  if (!value || typeof value !== 'object') {
    return { ok: false, code: 'INVALID_REQUEST', message: 'Request body must be an object.' };
  }
  const raw = value as Record<string, unknown>;
  const sourceRaw = raw.source as Record<string, unknown> | undefined;
  let source: FeaJobSource;
  if (sourceRaw?.kind === 'stl' && typeof sourceRaw.dataBase64 === 'string') {
    let buffer: Buffer;
    try { buffer = Buffer.from(sourceRaw.dataBase64, 'base64'); } catch {
      return { ok: false, code: 'INVALID_STL', message: 'STL payload is not valid base64.' };
    }
    if (buffer.length === 0 || buffer.length > FEA_MAX_STL_BYTES) {
      return { ok: false, code: 'STL_SIZE_LIMIT', message: `STL must be 1..${FEA_MAX_STL_BYTES} bytes.` };
    }
    if (!validBinaryStl(buffer)) {
      return { ok: false, code: 'INVALID_STL', message: 'Only structurally valid binary STL is accepted.' };
    }
    source = { kind: 'stl', dataBase64: sourceRaw.dataBase64 };
  } else if (sourceRaw?.kind === 'scad' && typeof sourceRaw.source === 'string') {
    const bytes = Buffer.byteLength(sourceRaw.source, 'utf8');
    if (bytes < 10 || bytes > FEA_MAX_SCAD_BYTES) {
      return { ok: false, code: 'SCAD_SIZE_LIMIT', message: `SCAD must be 10..${FEA_MAX_SCAD_BYTES} bytes.` };
    }
    if (!validateScadSource(sourceRaw.source)) {
      return { ok: false, code: 'SCAD_EXTERNAL_ACCESS_BLOCKED', message: 'External-file SCAD commands are not allowed.' };
    }
    source = { kind: 'scad', source: sourceRaw.source.replace(/\r\n?/g, '\n') };
  } else {
    return { ok: false, code: 'SOURCE_REQUIRED', message: 'source.kind must be stl or scad.' };
  }

  const loadN = finiteNumber(raw.loadN);
  if (loadN === null || loadN <= 0 || loadN > 9.81e9) {
    return { ok: false, code: 'LOAD_LIMIT', message: 'loadN must be greater than 0 and at most 9.81e9 N.' };
  }
  const materialKey = typeof raw.materialKey === 'string' ? raw.materialKey : 'steel';
  if (!['STS316', 'STS304', 'steel', 'aluminum', 'concrete', 'timber', 'PVC'].includes(materialKey)) {
    return { ok: false, code: 'MATERIAL_INVALID', message: 'Unsupported FEA material.' };
  }
  const maxDofRaw = finiteNumber((raw.limits as Record<string, unknown> | undefined)?.maxDof);
  const maxDof = maxDofRaw === null ? FEA_MAX_DOF : Math.round(maxDofRaw);
  if (maxDof < 3_000 || maxDof > FEA_MAX_DOF) {
    return { ok: false, code: 'DOF_LIMIT_INVALID', message: `maxDof must be 3000..${FEA_MAX_DOF}.` };
  }
  const timeoutRaw = finiteNumber((raw.limits as Record<string, unknown> | undefined)?.timeoutMs);
  const timeoutMs = timeoutRaw === null ? FEA_DEFAULT_TIMEOUT_MS : Math.round(timeoutRaw);
  if (timeoutMs < 10_000 || timeoutMs > FEA_MAX_TIMEOUT_MS) {
    return { ok: false, code: 'TIMEOUT_LIMIT_INVALID', message: `timeoutMs must be 10000..${FEA_MAX_TIMEOUT_MS}.` };
  }

  return {
    ok: true,
    request: {
      source,
      materialKey,
      loadN,
      loadNote: typeof raw.loadNote === 'string' ? raw.loadNote.slice(0, 1000) : 'User-specified equivalent load.',
      precise: raw.precise !== false,
      limits: { maxDof, timeoutMs, memoryMb: FEA_DEFAULT_MEMORY_MB },
    },
  };
}

export function publicFeaJob(job: SerializedFeaJob): Omit<SerializedFeaJob, 'ownerUserId' | 'request' | 'requestHash' | 'idempotencyHash' | 'leaseToken' | 'leaseExpiresAt' | 'heartbeatAt'> {
  const {
    ownerUserId: _ownerUserId,
    request: _request,
    requestHash: _requestHash,
    idempotencyHash: _idempotencyHash,
    leaseToken: _leaseToken,
    leaseExpiresAt: _leaseExpiresAt,
    heartbeatAt: _heartbeatAt,
    ...safe
  } = job;
  return safe;
}

export function isTerminalFeaStatus(status: FeaJobStatus): boolean {
  return status === 'complete' || status === 'failed' || status === 'cancelled';
}
