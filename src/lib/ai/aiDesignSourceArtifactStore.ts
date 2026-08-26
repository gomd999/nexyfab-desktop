import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import type { StorageAdapter } from '@/lib/storage';

export const AI_DESIGN_SOURCE_MAX_BYTES = 6 * 1024 * 1024;
export const AI_DESIGN_SOURCE_MIGRATION_VERSION = 2026082602;
export const AI_DESIGN_SOURCE_MIGRATION_CHECKSUM_ENV = 'POSTGRES_MIGRATION_CHECKSUM_2026082602';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type AiDesignSourceKind = 'image' | 'drawing_2d';

export type AiDesignSourceArtifact = {
  artifactId: string;
  projectId: string;
  sessionId: string;
  sourceHash: string;
  objectKey: string;
  filename: string;
  mimeType: string;
  kind: AiDesignSourceKind;
  byteLength: number;
  createdAt: number;
};

type SourceRow = {
  artifact_id: string;
  project_id: string;
  session_id: string;
  user_id: string;
  object_key: string;
  filename: string;
  mime_type: string;
  input_kind: AiDesignSourceKind;
  content_sha256: string;
  byte_length: number | string;
  created_at: number | string;
};

function magicMatches(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/webp') return bytes.length >= 12
    && new TextDecoder('ascii').decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder('ascii').decode(bytes.slice(8, 12)) === 'WEBP';
  return false;
}

export function validateAiDesignSourceFile(input: {
  filename: string;
  mimeType: string;
  kind: string;
  bytes: Uint8Array;
}): { ok: true; filename: string; mimeType: string; kind: AiDesignSourceKind; sourceHash: string }
  | { ok: false; code: string } {
  const filename = input.filename.trim();
  if (!filename || filename.length > 255 || filename.includes('/') || filename.includes('\\') || filename.includes('\0') || filename.includes('..')) return { ok: false, code: 'INVALID_FILENAME' };
  if (!MIME.has(input.mimeType)) return { ok: false, code: 'UNSUPPORTED_SOURCE_TYPE' };
  if (input.kind !== 'image' && input.kind !== 'drawing_2d') return { ok: false, code: 'INVALID_SOURCE_KIND' };
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > AI_DESIGN_SOURCE_MAX_BYTES) return { ok: false, code: 'SOURCE_SIZE_INVALID' };
  if (!magicMatches(input.bytes, input.mimeType)) return { ok: false, code: 'SOURCE_SIGNATURE_INVALID' };
  return {
    ok: true,
    filename,
    mimeType: input.mimeType,
    kind: input.kind,
    sourceHash: createHash('sha256').update(input.bytes).digest('hex'),
  };
}

export async function assertAiDesignSourceArtifactSchema(db: DbAdapter): Promise<void> {
  if (db.backend !== 'postgres') return;
  const expected = process.env[AI_DESIGN_SOURCE_MIGRATION_CHECKSUM_ENV]?.trim();
  if (!expected || !SHA256.test(expected)) throw new Error('AI_DESIGN_SOURCE_MIGRATION_ENV_REQUIRED');
  const applied = await db.queryOne<{ version: number | string; checksum?: string }>(
    'SELECT version, checksum FROM nf_schema_migrations WHERE version = ?',
    AI_DESIGN_SOURCE_MIGRATION_VERSION,
  );
  if (Number(applied?.version) !== AI_DESIGN_SOURCE_MIGRATION_VERSION || applied?.checksum !== expected) {
    throw new Error('AI_DESIGN_SOURCE_MIGRATION_REQUIRED');
  }
}

export async function persistAiDesignSourceArtifact(input: {
  db: DbAdapter;
  storage: StorageAdapter;
  userId: string;
  projectId: string;
  sessionId: string;
  tenantNamespace: string;
  filename: string;
  mimeType: string;
  kind: AiDesignSourceKind;
  bytes: Uint8Array;
  sourceHash: string;
  classification?: unknown;
}): Promise<AiDesignSourceArtifact> {
  if (!SAFE_ID.test(input.projectId) || !SAFE_ID.test(input.sessionId) || !SHA256.test(input.sourceHash)) throw new Error('AI_DESIGN_SOURCE_BINDING_INVALID');
  const uploaded = await input.storage.uploadPrivate(
    Buffer.from(input.bytes),
    input.filename,
    `ai-design-sources/${input.tenantNamespace}/projects/${input.projectId}`,
  );
  const artifact: AiDesignSourceArtifact = {
    artifactId: `ai-source:${randomUUID()}`,
    projectId: input.projectId,
    sessionId: input.sessionId,
    sourceHash: input.sourceHash,
    objectKey: uploaded.key,
    filename: input.filename,
    mimeType: input.mimeType,
    kind: input.kind,
    byteLength: input.bytes.byteLength,
    createdAt: Date.now(),
  };
  try {
    await input.db.execute(
      `INSERT INTO nf_ai_design_source_artifacts
       (artifact_id, project_id, session_id, user_id, object_key, filename, mime_type, input_kind, content_sha256, byte_length, classification_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      artifact.artifactId, artifact.projectId, artifact.sessionId, input.userId,
      artifact.objectKey, artifact.filename, artifact.mimeType, artifact.kind,
      artifact.sourceHash, artifact.byteLength,
      input.classification === undefined ? null : JSON.stringify(input.classification),
      artifact.createdAt,
    );
  } catch (error) {
    await input.storage.delete(uploaded.key).catch(() => undefined);
    throw error;
  }
  return artifact;
}

export async function verifyAiDesignSourceBinding(db: DbAdapter, input: {
  projectId: string;
  sessionId: string;
  artifactId: string;
  sourceHash: string;
  mimeType: string;
  byteLength: number;
}): Promise<boolean> {
  const row = await db.queryOne<SourceRow>(
    `SELECT artifact_id, project_id, session_id, user_id, object_key, filename, mime_type, input_kind, content_sha256, byte_length, created_at
     FROM nf_ai_design_source_artifacts WHERE artifact_id = ? AND project_id = ? AND session_id = ?`,
    input.artifactId, input.projectId, input.sessionId,
  ).catch(() => null);
  return Boolean(row
    && row.content_sha256 === input.sourceHash
    && row.mime_type === input.mimeType
    && Number(row.byte_length) === input.byteLength
    && row.object_key.startsWith('private/'));
}
