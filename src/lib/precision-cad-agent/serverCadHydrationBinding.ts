import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CanonicalCadGeometryMapping } from '@/lib/ai/scad-agent/precisionCadSessionBootstrap';

/**
 * Server-to-worker reference for a future OCCT-capable isolated worker.
 *
 * This is deliberately only a CAS key.  It contains no artifact bytes,
 * object keys, ownership maps, or process-local handles.  The worker may use
 * the key to read the authoritative mapping/artifact itself once its
 * DB/storage adapter exists; until then it must return HOLD.
 */
export const SERVER_CAD_HYDRATION_BINDING_SCHEMA = 'nexyfab.precision-cad-worker-hydration.v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SIGNATURE = /^[a-f0-9]{64}$/;
const DEFAULT_TTL_MS = 30_000;

export type ServerCadHydrationBinding = {
  schema: typeof SERVER_CAD_HYDRATION_BINDING_SCHEMA;
  userId: string;
  projectId: string;
  workspaceId: string;
  revision: number;
  workspaceContentHash: string;
  geometryContentHash: string;
  shapeIdentityHash: string;
  sourceRecordId: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
};

type UnsignedBinding = Omit<ServerCadHydrationBinding, 'signature'>;

function secret(): string | null {
  const value = (process.env.NEXYFAB_CAD_WORKER_BINDING_SECRET
    ?? process.env.SCAD_AGENT_SESSION_SECRET
    ?? process.env.JWT_SECRET
    ?? process.env.NEXYFAB_SERVER_SECRET
    ?? '').trim();
  return value.length >= 16 ? value : null;
}

function canonical(value: UnsignedBinding): string {
  return JSON.stringify({
    schema: value.schema,
    userId: value.userId,
    projectId: value.projectId,
    workspaceId: value.workspaceId,
    revision: value.revision,
    workspaceContentHash: value.workspaceContentHash,
    geometryContentHash: value.geometryContentHash,
    shapeIdentityHash: value.shapeIdentityHash,
    sourceRecordId: value.sourceRecordId,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  });
}

function mac(value: UnsignedBinding, signingSecret: string): string {
  return createHmac('sha256', signingSecret).update(canonical(value)).digest('hex');
}

function unsigned(binding: ServerCadHydrationBinding): UnsignedBinding {
  const { signature: _signature, ...value } = binding;
  return value;
}

export function validateServerCadHydrationBinding(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['binding_invalid'];
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = [
    'expiresAt', 'geometryContentHash', 'issuedAt', 'projectId', 'revision',
    'schema', 'shapeIdentityHash', 'signature', 'sourceRecordId', 'userId',
    'workspaceContentHash', 'workspaceId',
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return ['binding_keys_invalid'];
  const issues: string[] = [];
  if (candidate.schema !== SERVER_CAD_HYDRATION_BINDING_SCHEMA) issues.push('schema_invalid');
  for (const key of ['userId', 'projectId', 'workspaceId', 'sourceRecordId'] as const) {
    if (typeof candidate[key] !== 'string' || !SAFE_ID.test(candidate[key])) issues.push(`${key}_invalid`);
  }
  if (typeof candidate.revision !== 'number' || !Number.isSafeInteger(candidate.revision) || candidate.revision < 0) issues.push('revision_invalid');
  for (const key of ['workspaceContentHash', 'geometryContentHash', 'shapeIdentityHash'] as const) {
    if (typeof candidate[key] !== 'string' || !SHA256.test(candidate[key])) issues.push(`${key}_invalid`);
  }
  for (const key of ['issuedAt', 'expiresAt'] as const) {
    if (typeof candidate[key] !== 'number' || !Number.isSafeInteger(candidate[key]) || candidate[key] <= 0) issues.push(`${key}_invalid`);
  }
  if (typeof candidate.signature !== 'string' || !SIGNATURE.test(candidate.signature)) issues.push('signature_invalid');
  if (typeof candidate.issuedAt === 'number' && typeof candidate.expiresAt === 'number' && candidate.expiresAt <= candidate.issuedAt) issues.push('expiry_invalid');
  return [...new Set(issues)];
}

export function issueServerCadHydrationBinding(input: {
  userId: string;
  mapping: Pick<CanonicalCadGeometryMapping, 'projectId' | 'workspaceId' | 'revision' | 'workspaceContentHash' | 'geometryContentHash' | 'shapeIdentityHash' | 'sourceRecordId'>;
  now?: number;
  ttlMs?: number;
}): ServerCadHydrationBinding | null {
  const issuedAt = input.now ?? Date.now();
  const expiresAt = issuedAt + Math.min(DEFAULT_TTL_MS, Math.max(1_000, input.ttlMs ?? DEFAULT_TTL_MS));
  const value: UnsignedBinding = {
    schema: SERVER_CAD_HYDRATION_BINDING_SCHEMA,
    userId: input.userId,
    projectId: input.mapping.projectId,
    workspaceId: input.mapping.workspaceId,
    revision: input.mapping.revision,
    workspaceContentHash: input.mapping.workspaceContentHash,
    geometryContentHash: input.mapping.geometryContentHash,
    shapeIdentityHash: input.mapping.shapeIdentityHash,
    sourceRecordId: input.mapping.sourceRecordId,
    issuedAt,
    expiresAt,
  };
  if (validateServerCadHydrationBinding({ ...value, signature: '0'.repeat(64) }).some(issue => issue !== 'signature_invalid')) return null;
  const signingSecret = secret();
  if (!signingSecret) return null;
  return { ...value, signature: mac(value, signingSecret) };
}

export function verifyServerCadHydrationBinding(input: {
  binding: unknown;
  userId: string;
  now?: number;
}): boolean {
  if (validateServerCadHydrationBinding(input.binding).length > 0) return false;
  const binding = input.binding as ServerCadHydrationBinding;
  if (binding.userId !== input.userId) return false;
  const now = input.now ?? Date.now();
  if (binding.issuedAt > now || binding.expiresAt <= now) return false;
  const signingSecret = secret();
  if (!signingSecret) return false;
  const expected = Buffer.from(mac(unsigned(binding), signingSecret), 'hex');
  const supplied = Buffer.from(binding.signature, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
