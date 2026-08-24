import { createHash } from 'node:crypto';

export const AI_DESIGN_DURABLE_JOB_MAX_PAYLOAD_BYTES = 512 * 1024;
export const AI_DESIGN_DURABLE_JOB_MAX_ATTEMPTS = 8;
export const AI_DESIGN_DURABLE_OUTBOX_MAX_PAYLOAD_BYTES = 256 * 1024;
export const AI_DESIGN_DURABLE_OUTBOX_MAX_DELIVERY_ATTEMPTS = 12;
export const AI_DESIGN_DURABLE_BACKOFF_BASE_MS = 1_000;
export const AI_DESIGN_DURABLE_BACKOFF_MAX_MS = 15 * 60 * 1_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export type DurableStoreMode = 'reference' | 'commercial';
export type DurableStoreErrorCode = 'COMMERCIAL_PERSISTENCE_REQUIRED' | 'INVALID_INPUT' | 'NOT_FOUND' | 'CAS_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'LEASE_CONFLICT' | 'TERMINAL' | 'PAYLOAD_TOO_LARGE' | 'ORDERING_BLOCKED' | 'RETRY_EXHAUSTED';
export class DurableStoreError extends Error {
  readonly code: DurableStoreErrorCode;
  constructor(code: DurableStoreErrorCode, message: string = code) { super(message); this.name = 'DurableStoreError'; this.code = code; }
}
export function assertId(value: string, field: string): void { if (typeof value !== 'string' || !ID.test(value)) throw new DurableStoreError('INVALID_INPUT', `${field}_invalid`); }
export function assertProjectSession(projectId: string, sessionId: string): void { assertId(projectId, 'project_id'); assertId(sessionId, 'session_id'); }
export function assertRevision(revision: number): void { if (!Number.isSafeInteger(revision) || revision < 0) throw new DurableStoreError('INVALID_INPUT', 'revision_invalid'); }
export function assertTimestamp(timestamp: string): void { if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) throw new DurableStoreError('INVALID_INPUT', 'timestamp_invalid'); }
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new DurableStoreError('INVALID_INPUT', 'payload_number_invalid'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new DurableStoreError('INVALID_INPUT', 'payload_value_invalid');
}
export function payloadDigest(payload: unknown, maxBytes: number): { digest: string; bytes: number } {
  let encoded: Uint8Array;
  try { encoded = new TextEncoder().encode(canonical(payload)); } catch { throw new DurableStoreError('INVALID_INPUT', 'payload_not_serializable'); }
  if (encoded.byteLength > maxBytes) throw new DurableStoreError('PAYLOAD_TOO_LARGE', 'payload_too_large');
  return { digest: createHash('sha256').update(Buffer.from(encoded)).digest('hex'), bytes: encoded.byteLength };
}
export function backoffMs(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new DurableStoreError('INVALID_INPUT', 'attempt_invalid');
  return Math.min(AI_DESIGN_DURABLE_BACKOFF_MAX_MS, AI_DESIGN_DURABLE_BACKOFF_BASE_MS * (2 ** Math.min(attempt - 1, 20)));
}
export function clone<T>(value: T): T { return structuredClone(value); }
export function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
