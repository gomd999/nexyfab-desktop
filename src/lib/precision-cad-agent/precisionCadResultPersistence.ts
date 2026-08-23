import { createHash, randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import type { StorageAdapter } from '@/lib/storage';
import {
  validateRemotePrecisionCadBinding,
  validateRemotePrecisionCadToolCall,
  type RemotePrecisionCadProjectBinding,
  type RemotePrecisionCadToolCall,
} from './remoteCadContract';
import { ARTIFACT_CONTRACT_VERSION, validateCadArtifact, type CadArtifact } from '../../../packages/artifact-contracts/src/index';
import { ensureDirectArtifactUploadTables } from '@/lib/artifacts/directArtifactUploadStore';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_REPORT_BYTES = 512 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_MODEL_BYTES = 500 * 1024 * 1024;

export type PrecisionCadExecutionSuccess = {
  ok: true;
  tool: string;
  scope: 'read' | 'propose' | 'apply' | 'export';
  result: unknown;
  auditId: string;
};

export type PrecisionCadArtifactRef = CadArtifact & {
  revision: number;
  kind: 'model' | 'preview' | 'report';
  filename: string;
};

export type PersistPrecisionCadResult =
  | {
    ok: true;
    binding: RemotePrecisionCadProjectBinding;
    runId: string;
    callId: string;
    exactGeometryProduced: boolean;
    honesty: 'exact_brep' | 'preview_and_report_only';
    releaseReady: boolean;
    promotionStatus: 'promoted_exact_brep' | 'report_preview_only';
    artifacts: PrecisionCadArtifactRef[];
    revision?: { revisionId: string; revision: number; contentHash: string };
  }
  | {
    ok: false;
    code: 'INVALID_INPUT' | 'BINDING_STALE' | 'EXACT_GEOMETRY_REQUIRED' | 'STORAGE_UNAVAILABLE' | 'PERSISTENCE_FAILED' | 'REVISION_CONFLICT';
    issues: string[];
  };

export type PersistPrecisionCadResultInput = {
  db: DbAdapter;
  storage: StorageAdapter;
  userId: string;
  tenantId: string;
  binding: RemotePrecisionCadProjectBinding;
  runId: string;
  call: RemotePrecisionCadToolCall;
  execution: PrecisionCadExecutionSuccess;
  /** The current project row CAS value, if already read by the route. */
  currentUpdatedAt?: number;
  producerBuildId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stableJson(value: unknown): string {
  try { return JSON.stringify(value) ?? 'null'; } catch { return 'null'; }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeFilename(value: string): boolean {
  return Boolean(value && value.length <= 255 && SAFE_SEGMENT.test(value) && !value.includes('..'));
}

function privateProjectKey(key: string, projectId: string): boolean {
  if (!key.startsWith('private/') || key.includes('..') || key.includes('\\') || /[\u0000-\u001f\u007f]/.test(key)) return false;
  const pieces = key.split('/');
  const projects = pieces.indexOf('projects');
  return projects >= 0 && pieces[projects + 1] === projectId && pieces.every(piece => Boolean(piece) && piece !== '.' && piece !== '..');
}

function decodeBase64(value: unknown, limit: number): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(limit * 4 / 3) + 16 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) return null;
  try {
    const decoded = Buffer.from(value, 'base64');
    if (!decoded.length || decoded.length > limit) return null;
    const normalized = value.replace(/=+$/, '');
    if (decoded.toString('base64').replace(/=+$/, '') !== normalized) return null;
    return decoded;
  } catch { return null; }
}

function summarize(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (depth > 8) return '[depth_limit]';
  if (typeof value === 'string') return value.length > 2048 ? `${value.slice(0, 2048)}…[truncated]` : value;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Buffer.isBuffer(value)) return { type: 'binary', byteLength: value.byteLength };
  if (Array.isArray(value)) return value.slice(0, 32).map(item => summarize(item, depth + 1, seen));
  if (!isRecord(value)) return String(value);
  if (seen.has(value)) return '[cycle]';
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 96)) {
    if (key === 'views' && isRecord(child)) {
      output[key] = Object.fromEntries(Object.entries(child).slice(0, 16).map(([view, encoded]) => [view, {
        type: 'base64-artifact', byteLength: typeof encoded === 'string' ? Math.floor(encoded.length * 3 / 4) : 0,
      }]));
    } else if (/^(?:stepBase64|modelBase64|stlBase64)$/i.test(key)) {
      output[key] = { type: 'binary-artifact', byteLength: typeof child === 'string' ? Math.floor(child.length * 3 / 4) : 0 };
    } else output[key] = summarize(child, depth + 1, seen);
  }
  seen.delete(value);
  return output;
}

function resultHash(value: unknown): string {
  return sha256(Buffer.from(stableJson(value), 'utf8'));
}

export function summarizePrecisionCadToolResult(value: unknown): unknown {
  const summary = summarize(value);
  const serialized = stableJson(summary);
  return Buffer.byteLength(serialized, 'utf8') <= 64 * 1024
    ? summary
    : { truncated: true, resultSha256: resultHash(value) };
}

function exactStepPayload(result: unknown): Buffer | null {
  if (!isRecord(result) || result.exactBrep !== true || result.kernelIdentity === undefined) return null;
  const encoded = result.stepBase64 ?? result.modelBase64;
  const step = decodeBase64(encoded, MAX_MODEL_BYTES);
  if (!step) return null;
  const text = step.toString('utf8');
  if (!text.startsWith('ISO-10303-21;') || !text.includes('END-ISO-10303-21;')) return null;
  return step;
}

function previewPayloads(result: unknown): Array<{ name: string; bytes: Buffer }> {
  if (!isRecord(result) || !isRecord(result.views)) return [];
  return Object.entries(result.views).slice(0, 16).flatMap(([view, encoded]) => {
    const normalizedView = view.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 48) || 'view';
    const bytes = decodeBase64(encoded, MAX_PREVIEW_BYTES);
    return bytes ? [{ name: `preview-${normalizedView}.png`, bytes }] : [];
  });
}

async function ensurePrecisionCadResultTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_precision_cad_result_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      result_sha256 TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      exact_geometry INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      immutability_state TEXT NOT NULL,
      UNIQUE(project_id, revision, run_id, call_id, kind, filename, content_sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_precision_cad_result_project
      ON nf_precision_cad_result_artifacts(project_id, revision, created_at DESC);
  `);
}

async function persistArtifact(input: {
  db: DbAdapter;
  storage: StorageAdapter;
  projectId: string;
  tenantId: string;
  revision: number;
  runId: string;
  callId: string;
  kind: 'model' | 'preview' | 'report';
  bytes: Buffer;
  filename: string;
  mediaType: string;
  format: string;
  resultHash: string;
  exactGeometry: boolean;
  userId: string;
  producerBuildId: string;
}): Promise<PrecisionCadArtifactRef> {
  if (!safeFilename(input.filename) || input.bytes.length === 0) throw new Error('artifact_filename_invalid');
  const contentSha256 = sha256(input.bytes);
  const uploaded = await input.storage.uploadPrivate(
    input.bytes,
    input.filename,
    `precision-cad/projects/${input.projectId}/revisions/${input.revision}`,
  );
  if (!privateProjectKey(uploaded.key, input.projectId)) {
    await input.storage.delete(uploaded.key).catch(() => {});
    throw new Error('artifact_object_key_invalid');
  }
  const artifact: PrecisionCadArtifactRef = {
    contractVersion: ARTIFACT_CONTRACT_VERSION,
    artifactId: randomUUID(),
    projectId: input.projectId,
    tenantId: input.tenantId,
    objectKey: uploaded.key,
    mediaType: input.mediaType,
    format: input.format,
    byteLength: input.bytes.byteLength,
    contentSha256,
    producerBuildId: input.producerBuildId,
    kernelIdentity: 'NOT_APPLICABLE',
    createdAt: new Date().toISOString(),
    immutabilityState: 'IMMUTABLE',
    revision: input.revision,
    kind: input.kind,
    filename: input.filename,
  };
  const artifactIssues = validateCadArtifact(artifact);
  if (artifactIssues.length) {
    await input.storage.delete(uploaded.key).catch(() => {});
    throw new Error(artifactIssues.join(','));
  }
  try {
    await input.db.transaction(async tx => {
      await tx.execute(
        `INSERT INTO nf_cad_artifacts
         (id, contract_version, project_id, tenant_id, object_key, media_type, format,
          byte_length, content_sha256, shape_identity_sha256, producer_build_id, kernel_identity,
          created_by, created_at, immutability_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        artifact.artifactId, artifact.contractVersion, artifact.projectId, artifact.tenantId,
        artifact.objectKey, artifact.mediaType, artifact.format, artifact.byteLength,
        artifact.contentSha256, null, artifact.producerBuildId, artifact.kernelIdentity,
        input.userId, Date.parse(artifact.createdAt), artifact.immutabilityState,
      );
      await tx.execute(
        `INSERT INTO nf_precision_cad_result_artifacts
         (id, project_id, revision, run_id, call_id, artifact_id, kind, filename, result_sha256,
          content_sha256, exact_geometry, created_by, created_at, immutability_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), input.projectId, input.revision, input.runId, input.callId,
        artifact.artifactId, input.kind, input.filename, input.resultHash, artifact.contentSha256, input.exactGeometry ? 1 : 0,
        input.userId, Date.parse(artifact.createdAt), 'IMMUTABLE',
      );
    });
  } catch (error) {
    await input.storage.delete(uploaded.key).catch(() => {});
    throw error;
  }
  return artifact;
}

export async function persistPrecisionCadResult(input: PersistPrecisionCadResultInput): Promise<PersistPrecisionCadResult> {
  const bindingIssues = validateRemotePrecisionCadBinding(input.binding);
  const callIssues = validateRemotePrecisionCadToolCall(input.call);
  const bindingMatch = input.call.scope === input.execution.scope && input.call.name === input.execution.tool;
  if (bindingIssues.length || callIssues.length || !bindingMatch || input.call.callId.trim() === '' || !input.runId.trim()) {
    return { ok: false, code: 'INVALID_INPUT', issues: [...bindingIssues, ...callIssues, ...(bindingMatch ? [] : ['execution_call_mismatch'])] };
  }
  if (input.currentUpdatedAt !== undefined && input.currentUpdatedAt !== input.binding.updatedAt) {
    return { ok: false, code: 'BINDING_STALE', issues: ['updated_at_stale'] };
  }
  const currentProject = await input.db.queryOne<{ updated_at: number }>('SELECT updated_at FROM nf_projects WHERE id = ?', input.binding.projectId).catch(() => undefined);
  if (!currentProject || Number(currentProject.updated_at) !== input.binding.updatedAt) return { ok: false, code: 'BINDING_STALE', issues: ['updated_at_stale'] };
  await ensureDirectArtifactUploadTables(input.db);
  await ensurePrecisionCadResultTables(input.db);

  const outputHash = resultHash(input.execution.result);
  const exactStep = exactStepPayload(input.execution.result);
  const previews = previewPayloads(input.execution.result);
  // Browser-agent tools only produce candidates. Exact B-rep promotion and a
  // new workspace revision belong to the trusted CAD-job receipt boundary.
  const targetRevision = input.binding.revision;
  const exactGeometryProduced = false;
  const report = {
    schema: 'nexyfab.precision-cad-result-report.v1',
    projectId: input.binding.projectId,
    revision: targetRevision,
    runId: input.runId,
    callId: input.call.callId,
    tool: input.call.name,
    scope: input.call.scope,
    resultSha256: outputHash,
    exactGeometryProduced,
    exactGeometryCandidate: Boolean(exactStep),
    modelArtifactPersisted: exactGeometryProduced,
    releaseReady: exactGeometryProduced,
    promotionStatus: exactGeometryProduced ? 'promoted_exact_brep' : 'report_preview_only',
    previewArtifactCount: previews.length,
    status: exactGeometryProduced ? 'exact_brep' : 'preview_and_report_only',
    honestLimitation: exactGeometryProduced ? undefined : 'The remote tool returned no verified STEP/B-rep payload bound to a committed workspace revision; no exact model release was created.',
    result: summarizePrecisionCadToolResult(input.execution.result),
  };
  const reportBytes = Buffer.from(JSON.stringify(report), 'utf8');
  if (reportBytes.length > MAX_REPORT_BYTES) return { ok: false, code: 'PERSISTENCE_FAILED', issues: ['report_too_large'] };
  const artifacts: PrecisionCadArtifactRef[] = [];
  const producerBuildId = input.producerBuildId?.trim() || process.env.CF_VERSION_METADATA_ID || process.env.RAILWAY_GIT_COMMIT_SHA || 'development-unversioned';
  try {
    artifacts.push(await persistArtifact({
      db: input.db, storage: input.storage, projectId: input.binding.projectId, tenantId: input.tenantId,
      revision: targetRevision, runId: input.runId, callId: input.call.callId, kind: 'report',
      bytes: reportBytes, filename: 'precision-cad-result.json', mediaType: 'application/json', format: 'json',
      resultHash: outputHash, exactGeometry: exactGeometryProduced, userId: input.userId, producerBuildId,
    }));
    for (const preview of previews) artifacts.push(await persistArtifact({
      db: input.db, storage: input.storage, projectId: input.binding.projectId, tenantId: input.tenantId,
      revision: targetRevision, runId: input.runId, callId: input.call.callId, kind: 'preview',
      bytes: preview.bytes, filename: preview.name, mediaType: 'image/png', format: 'png',
      resultHash: outputHash, exactGeometry: exactGeometryProduced, userId: input.userId, producerBuildId,
    }));
  } catch (error) {
    return { ok: false, code: 'PERSISTENCE_FAILED', issues: [error instanceof Error ? error.message : 'artifact_persistence_failed'] };
  }

  return {
    ok: true,
    binding: input.binding,
    runId: input.runId,
    callId: input.call.callId,
    exactGeometryProduced,
    honesty: exactGeometryProduced ? 'exact_brep' : 'preview_and_report_only',
    releaseReady: exactGeometryProduced,
    promotionStatus: exactGeometryProduced ? 'promoted_exact_brep' : 'report_preview_only',
    artifacts,
  };
}

export { ensurePrecisionCadResultTables };
