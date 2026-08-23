import { randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import type { StorageAdapter, StorageMultipartPart } from '@/lib/storage';
import {
  ARTIFACT_CONTRACT_VERSION,
  validateCadArtifact,
  type CadArtifact,
} from '../../../packages/artifact-contracts/src/index';

export const DIRECT_ARTIFACT_MAX_BYTES = 500 * 1024 * 1024;
export const DIRECT_ARTIFACT_UPLOAD_TTL_MS = 15 * 60_000;
export const DIRECT_ARTIFACT_MULTIPART_TTL_MS = 24 * 60 * 60_000;
export const DIRECT_ARTIFACT_MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024;
export const DIRECT_ARTIFACT_MULTIPART_PART_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const FORMAT_MEDIA_TYPES = {
  step: 'application/step',
  stp: 'application/step',
  iges: 'model/iges',
  igs: 'model/iges',
  stl: 'model/stl',
  obj: 'model/obj',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  ifc: 'application/x-step',
  dxf: 'image/vnd.dxf',
  dwg: 'image/vnd.dwg',
} as const;

export type DirectArtifactFormat = keyof typeof FORMAT_MEDIA_TYPES;
export type ArtifactUploadStatus = 'PENDING' | 'VERIFYING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
export type ArtifactUploadMode = 'SINGLE_PUT' | 'MULTIPART';

export interface ArtifactUploadIntentInput {
  filename: string;
  byteLength: number;
  contentSha256: string;
  shapeIdentitySha256?: string;
}

export interface ValidatedArtifactUploadIntent extends ArtifactUploadIntentInput {
  format: DirectArtifactFormat;
  mediaType: string;
}

export interface ArtifactUploadSessionRow {
  id: string;
  project_id: string;
  tenant_id: string;
  user_id: string;
  object_key: string;
  filename: string;
  media_type: string;
  format: DirectArtifactFormat;
  expected_size: number;
  expected_sha256: string;
  shape_identity_sha256: string | null;
  status: ArtifactUploadStatus;
  created_at: number;
  expires_at: number;
  completed_at: number | null;
  artifact_id: string | null;
  failure_code: string | null;
  upload_mode: ArtifactUploadMode;
  storage_upload_id: string | null;
  part_size: number | null;
  total_parts: number | null;
  multipart_completed_at: number | null;
}

export type ArtifactCompletionResult =
  | { ok: true; artifact: CadArtifact; idempotent: boolean }
  | { ok: false; code: 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED' | 'SESSION_UNAVAILABLE' | 'OBJECT_UNAVAILABLE' | 'SIZE_MISMATCH' | 'SHA256_MISMATCH' | 'ARTIFACT_INVALID' };

export type MultipartOperationResult =
  | { ok: true; session: ArtifactUploadSessionRow; parts: StorageMultipartPart[] }
  | { ok: false; code: 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED' | 'SESSION_UNAVAILABLE' | 'MULTIPART_UNAVAILABLE' | 'PARTS_INCOMPLETE' | 'SIZE_MISMATCH' | 'OBJECT_UNAVAILABLE' };

export function safeArtifactNamespaceSegment(value: string): string | null {
  return SAFE_SEGMENT.test(value) ? value : null;
}

export function resolveArtifactTenantId(projectOrgId: unknown, ownerUserId: string): string {
  return typeof projectOrgId === 'string' && projectOrgId.trim()
    ? projectOrgId.trim()
    : `personal:${ownerUserId}`;
}

export function artifactTenantNamespace(tenantId: string): string {
  const prefix = tenantId.startsWith('personal:') ? 'personal-' : 'org-';
  const raw = tenantId.startsWith('personal:') ? tenantId.slice('personal:'.length) : tenantId;
  const safe = safeArtifactNamespaceSegment(raw);
  if (!safe) throw new Error('invalid tenant namespace');
  return `${prefix}${safe}`;
}

export function validateArtifactUploadIntent(input: ArtifactUploadIntentInput):
  | { ok: true; value: ValidatedArtifactUploadIntent }
  | { ok: false; code: 'INVALID_FILENAME' | 'UNSUPPORTED_FORMAT' | 'INVALID_SIZE' | 'INVALID_SHA256' | 'INVALID_SHAPE_IDENTITY' } {
  const filename = input.filename.trim();
  if (!filename || filename.length > 255 || filename.includes('/') || filename.includes('\\') || filename.includes('\0') || filename.includes('..')) {
    return { ok: false, code: 'INVALID_FILENAME' };
  }
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!(extension in FORMAT_MEDIA_TYPES)) return { ok: false, code: 'UNSUPPORTED_FORMAT' };
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength <= 0 || input.byteLength > DIRECT_ARTIFACT_MAX_BYTES) {
    return { ok: false, code: 'INVALID_SIZE' };
  }
  const contentSha256 = input.contentSha256.toLowerCase();
  if (!SHA256.test(contentSha256)) return { ok: false, code: 'INVALID_SHA256' };
  const shapeIdentitySha256 = input.shapeIdentitySha256?.toLowerCase();
  if (shapeIdentitySha256 !== undefined && !SHA256.test(shapeIdentitySha256)) {
    return { ok: false, code: 'INVALID_SHAPE_IDENTITY' };
  }
  const format = extension as DirectArtifactFormat;
  return {
    ok: true,
    value: {
      filename,
      byteLength: input.byteLength,
      contentSha256,
      shapeIdentitySha256,
      format,
      mediaType: FORMAT_MEDIA_TYPES[format],
    },
  };
}

export async function ensureDirectArtifactUploadTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_artifact_upload_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      media_type TEXT NOT NULL,
      format TEXT NOT NULL,
      expected_size BIGINT NOT NULL,
      expected_sha256 TEXT NOT NULL,
      shape_identity_sha256 TEXT,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      completed_at BIGINT,
      artifact_id TEXT,
      failure_code TEXT,
      upload_mode TEXT NOT NULL DEFAULT 'SINGLE_PUT',
      storage_upload_id TEXT,
      part_size BIGINT,
      total_parts INTEGER,
      multipart_completed_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_nf_artifact_upload_project ON nf_artifact_upload_sessions(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_nf_artifact_upload_owner ON nf_artifact_upload_sessions(user_id, status, expires_at);
    CREATE TABLE IF NOT EXISTS nf_cad_artifacts (
      id TEXT PRIMARY KEY,
      contract_version TEXT NOT NULL,
      project_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      media_type TEXT NOT NULL,
      format TEXT NOT NULL,
      byte_length BIGINT NOT NULL,
      content_sha256 TEXT NOT NULL,
      shape_identity_sha256 TEXT,
      producer_build_id TEXT NOT NULL,
      kernel_identity TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      immutability_state TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nf_cad_artifact_project ON nf_cad_artifacts(project_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_cad_artifact_project_hash ON nf_cad_artifacts(project_id, content_sha256);
  `);
  // Compatibility for environments where the Wave 2 single-PUT table was
  // created before resumable multipart support was rolled out.
  await db.execute("ALTER TABLE nf_artifact_upload_sessions ADD COLUMN upload_mode TEXT NOT NULL DEFAULT 'SINGLE_PUT'").catch(() => ({ changes: 0 }));
  await db.execute('ALTER TABLE nf_artifact_upload_sessions ADD COLUMN storage_upload_id TEXT').catch(() => ({ changes: 0 }));
  await db.execute('ALTER TABLE nf_artifact_upload_sessions ADD COLUMN part_size BIGINT').catch(() => ({ changes: 0 }));
  await db.execute('ALTER TABLE nf_artifact_upload_sessions ADD COLUMN total_parts INTEGER').catch(() => ({ changes: 0 }));
  await db.execute('ALTER TABLE nf_artifact_upload_sessions ADD COLUMN multipart_completed_at BIGINT').catch(() => ({ changes: 0 }));
}

export async function createArtifactUploadSession(
  db: DbAdapter,
  input: {
    projectId: string;
    tenantId: string;
    userId: string;
    objectKey: string;
    intent: ValidatedArtifactUploadIntent;
    uploadMode?: ArtifactUploadMode;
    storageUploadId?: string;
    partSize?: number;
    totalParts?: number;
    expiresInMs?: number;
    now?: number;
  },
): Promise<ArtifactUploadSessionRow> {
  const now = input.now ?? Date.now();
  const row: ArtifactUploadSessionRow = {
    id: randomUUID(),
    project_id: input.projectId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    object_key: input.objectKey,
    filename: input.intent.filename,
    media_type: input.intent.mediaType,
    format: input.intent.format,
    expected_size: input.intent.byteLength,
    expected_sha256: input.intent.contentSha256,
    shape_identity_sha256: input.intent.shapeIdentitySha256 ?? null,
    status: 'PENDING',
    created_at: now,
    expires_at: now + (input.expiresInMs ?? DIRECT_ARTIFACT_UPLOAD_TTL_MS),
    completed_at: null,
    artifact_id: null,
    failure_code: null,
    upload_mode: input.uploadMode ?? 'SINGLE_PUT',
    storage_upload_id: input.storageUploadId ?? null,
    part_size: input.partSize ?? null,
    total_parts: input.totalParts ?? null,
    multipart_completed_at: null,
  };
  await db.execute(
    `INSERT INTO nf_artifact_upload_sessions
     (id, project_id, tenant_id, user_id, object_key, filename, media_type, format,
      expected_size, expected_sha256, shape_identity_sha256, status, created_at, expires_at,
      completed_at, artifact_id, failure_code, upload_mode, storage_upload_id,
      part_size, total_parts, multipart_completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.project_id, row.tenant_id, row.user_id, row.object_key, row.filename,
    row.media_type, row.format, row.expected_size, row.expected_sha256,
    row.shape_identity_sha256, row.status, row.created_at, row.expires_at,
    row.completed_at, row.artifact_id, row.failure_code, row.upload_mode,
    row.storage_upload_id, row.part_size, row.total_parts, row.multipart_completed_at,
  );
  return row;
}

export function storageSupportsMultipart(storage: StorageAdapter): boolean {
  return Boolean(
    storage.createPrivateMultipartUpload
    && storage.createPrivateMultipartPartUrl
    && storage.listPrivateMultipartParts
    && storage.completePrivateMultipartUpload
    && storage.abortPrivateMultipartUpload,
  );
}

export async function readOwnedArtifactUploadSession(
  db: DbAdapter,
  input: { uploadId: string; projectId: string; userId: string },
): Promise<ArtifactUploadSessionRow | null> {
  return await db.queryOne<ArtifactUploadSessionRow>(
    'SELECT * FROM nf_artifact_upload_sessions WHERE id = ? AND project_id = ? AND user_id = ?',
    input.uploadId, input.projectId, input.userId,
  ) ?? null;
}

async function expireSession(
  db: DbAdapter,
  storage: StorageAdapter,
  session: ArtifactUploadSessionRow,
): Promise<void> {
  if (session.upload_mode === 'MULTIPART' && session.storage_upload_id && storage.abortPrivateMultipartUpload) {
    await storage.abortPrivateMultipartUpload(session.object_key, session.storage_upload_id).catch(() => {});
  } else {
    await storage.delete(session.object_key).catch(() => {});
  }
  await db.execute(
    "UPDATE nf_artifact_upload_sessions SET status = 'EXPIRED', failure_code = 'SESSION_EXPIRED' WHERE id = ? AND status = 'PENDING'",
    session.id,
  );
}

export async function listArtifactMultipartParts(
  db: DbAdapter,
  storage: StorageAdapter,
  input: { uploadId: string; projectId: string; userId: string; now?: number },
): Promise<MultipartOperationResult> {
  const session = await readOwnedArtifactUploadSession(db, input);
  if (!session) return { ok: false, code: 'SESSION_NOT_FOUND' };
  if (session.status !== 'PENDING' || session.upload_mode !== 'MULTIPART' || !session.storage_upload_id) {
    return { ok: false, code: 'SESSION_UNAVAILABLE' };
  }
  if (Number(session.expires_at) < (input.now ?? Date.now())) {
    await expireSession(db, storage, session);
    return { ok: false, code: 'SESSION_EXPIRED' };
  }
  if (!storage.listPrivateMultipartParts) return { ok: false, code: 'MULTIPART_UNAVAILABLE' };
  try {
    const parts = await storage.listPrivateMultipartParts(session.object_key, session.storage_upload_id);
    return { ok: true, session, parts };
  } catch {
    return { ok: false, code: 'OBJECT_UNAVAILABLE' };
  }
}

export async function finalizeArtifactMultipartUpload(
  db: DbAdapter,
  storage: StorageAdapter,
  input: { uploadId: string; projectId: string; userId: string; now?: number },
): Promise<MultipartOperationResult> {
  const session = await readOwnedArtifactUploadSession(db, input);
  if (!session) return { ok: false, code: 'SESSION_NOT_FOUND' };
  if (session.status !== 'PENDING' || session.upload_mode !== 'MULTIPART' || !session.storage_upload_id) {
    return { ok: false, code: 'SESSION_UNAVAILABLE' };
  }
  if (Number(session.expires_at) < (input.now ?? Date.now())) {
    await expireSession(db, storage, session);
    return { ok: false, code: 'SESSION_EXPIRED' };
  }
  if (session.multipart_completed_at) return { ok: true, session, parts: [] };
  if (!storage.listPrivateMultipartParts || !storage.completePrivateMultipartUpload) {
    return { ok: false, code: 'MULTIPART_UNAVAILABLE' };
  }

  let parts: StorageMultipartPart[];
  try {
    parts = await storage.listPrivateMultipartParts(session.object_key, session.storage_upload_id);
  } catch {
    if (storage.stat) {
      const assembled = await storage.stat(session.object_key).catch(() => null);
      if (assembled?.size === Number(session.expected_size)) {
        await db.execute(
          'UPDATE nf_artifact_upload_sessions SET multipart_completed_at = ? WHERE id = ? AND status = ?',
          input.now ?? Date.now(), session.id, 'PENDING',
        );
        return { ok: true, session: { ...session, multipart_completed_at: input.now ?? Date.now() }, parts: [] };
      }
    }
    return { ok: false, code: 'OBJECT_UNAVAILABLE' };
  }
  const expectedParts = Number(session.total_parts);
  const partSize = Number(session.part_size);
  const contiguous = Number.isSafeInteger(expectedParts) && expectedParts > 0
    && Number.isSafeInteger(partSize) && partSize > 0
    && parts.length === expectedParts
    && parts.every((part, index) => part.partNumber === index + 1
      && part.size > 0
      && (index === parts.length - 1 ? part.size <= partSize : part.size === partSize));
  if (!contiguous) return { ok: false, code: 'PARTS_INCOMPLETE' };
  const totalBytes = parts.reduce((total, part) => total + part.size, 0);
  if (totalBytes !== Number(session.expected_size)) return { ok: false, code: 'SIZE_MISMATCH' };

  try {
    await storage.completePrivateMultipartUpload(session.object_key, session.storage_upload_id, parts);
  } catch {
    const assembled = storage.stat ? await storage.stat(session.object_key).catch(() => null) : null;
    if (assembled?.size !== Number(session.expected_size)) return { ok: false, code: 'OBJECT_UNAVAILABLE' };
  }
  const completedAt = input.now ?? Date.now();
  await db.execute(
    'UPDATE nf_artifact_upload_sessions SET multipart_completed_at = ? WHERE id = ? AND status = ?',
    completedAt, session.id, 'PENDING',
  );
  return { ok: true, session: { ...session, multipart_completed_at: completedAt }, parts };
}

export async function abortArtifactMultipartUpload(
  db: DbAdapter,
  storage: StorageAdapter,
  input: { uploadId: string; projectId: string; userId: string },
): Promise<{ ok: true } | { ok: false; code: 'SESSION_NOT_FOUND' | 'SESSION_UNAVAILABLE' | 'MULTIPART_UNAVAILABLE' }> {
  const session = await readOwnedArtifactUploadSession(db, input);
  if (!session) return { ok: false, code: 'SESSION_NOT_FOUND' };
  if (session.status !== 'PENDING' || session.upload_mode !== 'MULTIPART' || !session.storage_upload_id) {
    return { ok: false, code: 'SESSION_UNAVAILABLE' };
  }
  if (!storage.abortPrivateMultipartUpload) return { ok: false, code: 'MULTIPART_UNAVAILABLE' };
  await storage.abortPrivateMultipartUpload(session.object_key, session.storage_upload_id);
  await db.execute(
    "UPDATE nf_artifact_upload_sessions SET status = 'FAILED', failure_code = 'CLIENT_ABORTED' WHERE id = ? AND status = 'PENDING'",
    session.id,
  );
  return { ok: true };
}

function artifactFromRow(row: Record<string, unknown>): CadArtifact {
  return {
    contractVersion: row.contract_version as typeof ARTIFACT_CONTRACT_VERSION,
    artifactId: String(row.id),
    projectId: String(row.project_id),
    tenantId: String(row.tenant_id),
    objectKey: String(row.object_key),
    mediaType: String(row.media_type),
    format: String(row.format),
    byteLength: Number(row.byte_length),
    contentSha256: String(row.content_sha256),
    ...(typeof row.shape_identity_sha256 === 'string' ? { shapeIdentitySha256: row.shape_identity_sha256 } : {}),
    producerBuildId: String(row.producer_build_id),
    kernelIdentity: String(row.kernel_identity),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    immutabilityState: row.immutability_state as CadArtifact['immutabilityState'],
  };
}

async function readArtifact(db: DbAdapter, artifactId: string): Promise<CadArtifact | null> {
  const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_cad_artifacts WHERE id = ?', artifactId);
  return row ? artifactFromRow(row) : null;
}

/**
 * Read an immutable CAD artifact only through its server-owned project and
 * artifact identity.  This is deliberately not an upload-session lookup:
 * workspace bootstrap may consume an artifact only after the authoritative
 * workspace graph has selected its id and hash.  Callers still compare the
 * returned content/shape hashes with their workspace CAS before downloading
 * the private object.
 */
export async function readAuthoritativeCadArtifact(
  db: DbAdapter,
  input: { projectId: string; artifactId: string },
): Promise<CadArtifact | null> {
  if (!input.projectId.trim() || !input.artifactId.trim()) return null;
  const row = await db.queryOne<Record<string, unknown>>(
    `SELECT * FROM nf_cad_artifacts
     WHERE id = ? AND project_id = ? AND immutability_state = 'IMMUTABLE'`,
    input.artifactId,
    input.projectId,
  );
  if (!row) return null;
  const artifact = artifactFromRow(row);
  return artifact.projectId === input.projectId && artifact.artifactId === input.artifactId
    ? artifact
    : null;
}

export async function completeArtifactUpload(
  db: DbAdapter,
  storage: StorageAdapter,
  input: { uploadId: string; projectId: string; userId: string; producerBuildId: string; now?: number },
): Promise<ArtifactCompletionResult> {
  const session = await db.queryOne<ArtifactUploadSessionRow>(
    'SELECT * FROM nf_artifact_upload_sessions WHERE id = ? AND project_id = ? AND user_id = ?',
    input.uploadId, input.projectId, input.userId,
  );
  if (!session) return { ok: false, code: 'SESSION_NOT_FOUND' };
  if (session.status === 'COMPLETED' && session.artifact_id) {
    const artifact = await readArtifact(db, session.artifact_id);
    return artifact ? { ok: true, artifact, idempotent: true } : { ok: false, code: 'SESSION_UNAVAILABLE' };
  }
  if (session.status !== 'PENDING') return { ok: false, code: 'SESSION_UNAVAILABLE' };
  const now = input.now ?? Date.now();
  if (session.expires_at < now) {
    await storage.delete(session.object_key).catch(() => {});
    await db.execute(
      "UPDATE nf_artifact_upload_sessions SET status = 'EXPIRED', failure_code = 'SESSION_EXPIRED' WHERE id = ? AND status = 'PENDING'",
      session.id,
    );
    return { ok: false, code: 'SESSION_EXPIRED' };
  }
  if (!storage.sha256) return { ok: false, code: 'SESSION_UNAVAILABLE' };
  const claimed = await db.execute(
    "UPDATE nf_artifact_upload_sessions SET status = 'VERIFYING' WHERE id = ? AND status = 'PENDING'",
    session.id,
  );
  if (claimed.changes !== 1) return { ok: false, code: 'SESSION_UNAVAILABLE' };

  let observed: { size: number; contentSha256: string };
  try {
    observed = await storage.sha256(session.object_key);
  } catch {
    await db.execute(
      "UPDATE nf_artifact_upload_sessions SET status = 'FAILED', failure_code = 'OBJECT_UNAVAILABLE' WHERE id = ? AND status = 'VERIFYING'",
      session.id,
    );
    return { ok: false, code: 'OBJECT_UNAVAILABLE' };
  }
  const mismatchCode = observed.size !== Number(session.expected_size)
    ? 'SIZE_MISMATCH'
    : observed.contentSha256 !== session.expected_sha256
      ? 'SHA256_MISMATCH'
      : null;
  if (mismatchCode) {
    await storage.delete(session.object_key).catch(() => {});
    await db.execute(
      "UPDATE nf_artifact_upload_sessions SET status = 'FAILED', failure_code = ? WHERE id = ? AND status = 'VERIFYING'",
      mismatchCode, session.id,
    );
    return { ok: false, code: mismatchCode };
  }

  const artifactId = randomUUID();
  const artifact: CadArtifact = {
    contractVersion: ARTIFACT_CONTRACT_VERSION,
    artifactId,
    projectId: session.project_id,
    tenantId: session.tenant_id,
    objectKey: session.object_key,
    mediaType: session.media_type,
    format: session.format,
    byteLength: observed.size,
    contentSha256: observed.contentSha256,
    ...(session.shape_identity_sha256 ? { shapeIdentitySha256: session.shape_identity_sha256 } : {}),
    producerBuildId: input.producerBuildId,
    kernelIdentity: 'NOT_APPLICABLE',
    createdAt: new Date(now).toISOString(),
    immutabilityState: 'IMMUTABLE',
  };
  if (validateCadArtifact(artifact).length) {
    await db.execute(
      "UPDATE nf_artifact_upload_sessions SET status = 'FAILED', failure_code = 'ARTIFACT_INVALID' WHERE id = ? AND status = 'VERIFYING'",
      session.id,
    );
    return { ok: false, code: 'ARTIFACT_INVALID' };
  }

  return db.transaction(async tx => {
    await tx.execute(
      `INSERT INTO nf_cad_artifacts
       (id, contract_version, project_id, tenant_id, object_key, media_type, format,
        byte_length, content_sha256, shape_identity_sha256, producer_build_id, kernel_identity,
        created_by, created_at, immutability_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      artifact.artifactId, artifact.contractVersion, artifact.projectId, artifact.tenantId,
      artifact.objectKey, artifact.mediaType, artifact.format, artifact.byteLength,
      artifact.contentSha256, artifact.shapeIdentitySha256 ?? null, artifact.producerBuildId,
      artifact.kernelIdentity, input.userId, now, artifact.immutabilityState,
    );
    const completed = await tx.execute(
      `UPDATE nf_artifact_upload_sessions
       SET status = 'COMPLETED', completed_at = ?, artifact_id = ?, failure_code = NULL
       WHERE id = ? AND status = 'VERIFYING'`,
      now, artifact.artifactId, session.id,
    );
    if (completed.changes !== 1) throw new Error('artifact upload completion compare-and-swap failed');
    return { ok: true, artifact, idempotent: false };
  });
}
