import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';

export const COMMERCIAL_AGENT_EXECUTION_BOUNDARY_SCHEMA = 'nexyfab.precision-cad-commercial-execution-boundary.v1' as const;
export const MAX_APPROVAL_TTL_MS = 5 * 60 * 1000;
export const COMMERCIAL_EXECUTION_MIGRATION_VERSION = 2026082202;
const MAX_ARGUMENT_BYTES = 256 * 1024;
const MAX_ID_BYTES = 256;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type BoundaryRole = 'owner' | 'editor' | 'viewer';
export type BoundaryScope = 'apply' | 'export';
export type ApprovalBindingInput = {
  actorId: string;
  role: BoundaryRole;
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
  workspaceContentHash: string;
  tool: string;
  scope: BoundaryScope;
  callId: string;
  arguments: Readonly<Record<string, unknown>>;
};
export type ApprovalChallenge = {
  schema: typeof COMMERCIAL_AGENT_EXECUTION_BOUNDARY_SCHEMA;
  challengeId: string;
  nonce: string;
  actorId: string;
  role: BoundaryRole;
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
  workspaceContentHash: string;
  tool: string;
  scope: BoundaryScope;
  callId: string;
  argumentsHash: string;
  commandHash: string;
  issuedAt: number;
  expiresAt: number;
  mac: string;
};
export type ApprovalConsumeInput = ApprovalBindingInput & { challengeId: string; nonce: string; mac: string };
export type BoundaryResult = { ok: true; challenge: ApprovalChallenge } | { ok: false; code: 'INVALID_INPUT' | 'SECRET_REQUIRED' | 'EXPIRED' | 'REPLAY' | 'BINDING_MISMATCH' | 'MAC_INVALID' };

function canonical(value: unknown, depth = 0): string {
  if (depth > 12) throw new Error('canonical_depth_exceeded');
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('canonical_nonfinite'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key], depth + 1)}`).join(',')}}`; }
  throw new Error('canonical_unsupported');
}
export function canonicalBoundaryJson(value: unknown): string { return canonical(value); }
export function hashBoundaryValue(value: unknown): string { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
export function hashBoundaryArguments(value: unknown): string { const encoded = canonical(value); if (Buffer.byteLength(encoded, 'utf8') > MAX_ARGUMENT_BYTES) throw new Error('arguments_too_large'); return hashBoundaryValue(value); }

function validId(value: unknown): value is string { return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_ID_BYTES && SAFE_ID.test(value); }
function validHash(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
function validBinding(input: ApprovalBindingInput): boolean {
  return Boolean(input && validId(input.actorId) && validId(input.projectId) && validId(input.workspaceId) && validId(input.tool) && validId(input.callId)
    && (input.role === 'owner' || input.role === 'editor') && (input.scope === 'apply' || input.scope === 'export')
    && Number.isSafeInteger(input.workspaceRevision) && input.workspaceRevision >= 0 && validHash(input.workspaceContentHash)
    && input.arguments && !Array.isArray(input.arguments));
}
export function fullBoundaryCommandHash(input: ApprovalBindingInput): string { return hashBoundaryValue({ schema: COMMERCIAL_AGENT_EXECUTION_BOUNDARY_SCHEMA, purpose: 'full-command', tool: input.tool, scope: input.scope, callId: input.callId, arguments: input.arguments }); }
function bindingHash(input: ApprovalBindingInput): string { return hashBoundaryValue({ actorId: input.actorId, role: input.role, projectId: input.projectId, workspaceId: input.workspaceId, workspaceRevision: input.workspaceRevision, workspaceContentHash: input.workspaceContentHash, tool: input.tool, scope: input.scope, callId: input.callId, argumentsHash: hashBoundaryArguments(input.arguments), commandHash: fullBoundaryCommandHash(input) }); }
function macPayload(challenge: Omit<ApprovalChallenge, 'mac'>): string { return canonical({ purpose: 'approval-challenge', ...challenge }); }
export function approvalChallengeMac(secret: string, challenge: Omit<ApprovalChallenge, 'mac'>): string { return createHmac('sha256', secret).update(macPayload(challenge), 'utf8').digest('base64url'); }
function safeSecret(secret: unknown): secret is string { return typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32; }
function constantTimeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function challengeFor(input: ApprovalBindingInput, secret: string, now: number, ttlMs: number): ApprovalChallenge {
  const base: Omit<ApprovalChallenge, 'mac'> = { schema: COMMERCIAL_AGENT_EXECUTION_BOUNDARY_SCHEMA, challengeId: randomUUID(), nonce: randomUUID(), actorId: input.actorId, role: input.role, projectId: input.projectId, workspaceId: input.workspaceId, workspaceRevision: input.workspaceRevision, workspaceContentHash: input.workspaceContentHash, tool: input.tool, scope: input.scope, callId: input.callId, argumentsHash: hashBoundaryArguments(input.arguments), commandHash: fullBoundaryCommandHash(input), issuedAt: now, expiresAt: now + ttlMs };
  return { ...base, mac: approvalChallengeMac(secret, base) };
}
function sameBinding(challenge: ApprovalChallenge, input: ApprovalBindingInput): boolean { return challenge.actorId === input.actorId && challenge.role === input.role && challenge.projectId === input.projectId && challenge.workspaceId === input.workspaceId && challenge.workspaceRevision === input.workspaceRevision && challenge.workspaceContentHash === input.workspaceContentHash && challenge.tool === input.tool && challenge.scope === input.scope && challenge.callId === input.callId && challenge.argumentsHash === hashBoundaryArguments(input.arguments) && challenge.commandHash === fullBoundaryCommandHash(input); }

export interface ApprovalChallengeLedger { insert(challenge: ApprovalChallenge): Promise<boolean> | boolean; consume(input: { challengeId: string; now: number; bindingHash: string }): Promise<ApprovalChallenge | null> | ApprovalChallenge | null; get(challengeId: string): Promise<ApprovalChallenge | null> | ApprovalChallenge | null; }
export class InMemoryApprovalChallengeLedger implements ApprovalChallengeLedger {
  private readonly values = new Map<string, ApprovalChallenge>();
  private readonly consumed = new Set<string>();
  insert(challenge: ApprovalChallenge): boolean { if (this.values.has(challenge.challengeId)) return false; this.values.set(challenge.challengeId, structuredClone(challenge)); return true; }
  get(challengeId: string): ApprovalChallenge | null { const value = this.values.get(challengeId); return value ? structuredClone(value) : null; }
  consume(input: { challengeId: string; now: number; bindingHash: string }): ApprovalChallenge | null { const value = this.values.get(input.challengeId); if (!value || this.consumed.has(input.challengeId) || value.expiresAt <= input.now || hashBoundaryValue(value) !== input.bindingHash) return null; this.consumed.add(input.challengeId); return structuredClone(value); }
}

export async function issueApprovalChallenge(ledger: ApprovalChallengeLedger, input: ApprovalBindingInput, secret: string, now = Date.now(), ttlMs = MAX_APPROVAL_TTL_MS): Promise<BoundaryResult> {
  if (!safeSecret(secret)) return { ok: false, code: 'SECRET_REQUIRED' };
  if (!validBinding(input) || !Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_APPROVAL_TTL_MS) return { ok: false, code: 'INVALID_INPUT' };
  try { const challenge = challengeFor(input, secret, now, ttlMs); if (!(await ledger.insert(challenge))) return { ok: false, code: 'REPLAY' }; return { ok: true, challenge }; } catch { return { ok: false, code: 'INVALID_INPUT' }; }
}
export async function consumeApprovalChallenge(ledger: ApprovalChallengeLedger, input: ApprovalConsumeInput, secret: string, verifierNow = Date.now()): Promise<BoundaryResult> {
  if (!safeSecret(secret)) return { ok: false, code: 'SECRET_REQUIRED' };
  if (!validBinding(input) || !validId(input.challengeId) || typeof input.nonce !== 'string' || typeof input.mac !== 'string') return { ok: false, code: 'INVALID_INPUT' };
  const now = verifierNow; if (!Number.isSafeInteger(now)) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const stored = await ledger.get(input.challengeId); if (!stored) return { ok: false, code: 'REPLAY' };
    if (stored.nonce !== input.nonce || !sameBinding(stored, input)) return { ok: false, code: 'BINDING_MISMATCH' };
    if (stored.expiresAt <= now) return { ok: false, code: 'EXPIRED' };
    const { mac: storedMac, ...withoutMac } = stored; const expected = approvalChallengeMac(secret, withoutMac); if (!constantTimeEqual(expected, storedMac) || !constantTimeEqual(expected, input.mac)) return { ok: false, code: 'MAC_INVALID' };
    const consumed = await ledger.consume({ challengeId: input.challengeId, now, bindingHash: hashBoundaryValue(stored) }); if (!consumed) return { ok: false, code: 'REPLAY' };
    return { ok: true, challenge: consumed };
  } catch { return { ok: false, code: 'INVALID_INPUT' }; }
}

export async function ensureApprovalChallengeTable(db: DbAdapter): Promise<void> {
  if (db.backend === 'sqlite' && process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE !== '1') {
    await db.executeRaw(`CREATE TABLE IF NOT EXISTS nf_precision_cad_approval_challenges (
      challenge_id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, role TEXT NOT NULL,
      project_id TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_revision INTEGER NOT NULL,
      workspace_content_hash TEXT NOT NULL, tool TEXT NOT NULL, scope TEXT NOT NULL, call_id TEXT NOT NULL,
      arguments_hash TEXT NOT NULL, command_hash TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      mac TEXT NOT NULL, consumed_at INTEGER
    )`);
    return;
  }
  const migration = await db.queryOne<{ version: number; checksum?: string }>('SELECT version, checksum FROM nf_schema_migrations WHERE version = ?', COMMERCIAL_EXECUTION_MIGRATION_VERSION).catch(() => undefined);
  const expected = process.env.POSTGRES_MIGRATION_CHECKSUM_2026082202?.trim() || process.env.POSTGRES_MIGRATION_CHECKSUM?.trim();
  const commercial = process.env.NEXYFAB_COMMERCIAL_MODE === '1' || process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE === '1';
  if (!migration || Number(migration.version) !== COMMERCIAL_EXECUTION_MIGRATION_VERSION || !/^[a-f0-9]{64}$/.test(migration.checksum ?? '') || (commercial && !expected) || (expected && migration.checksum !== expected)) throw new Error(`commercial_execution_migration_required:v${COMMERCIAL_EXECUTION_MIGRATION_VERSION}`);
}

export async function issueDbApprovalChallenge(db: DbAdapter, input: ApprovalBindingInput, secret: string, now = Date.now(), ttlMs = MAX_APPROVAL_TTL_MS): Promise<BoundaryResult> {
  await ensureApprovalChallengeTable(db);
  const result = await issueApprovalChallenge({
    async insert(challenge) {
      try { const inserted = await db.execute('INSERT INTO nf_precision_cad_approval_challenges (challenge_id, nonce, actor_id, role, project_id, workspace_id, workspace_revision, workspace_content_hash, tool, scope, call_id, arguments_hash, command_hash, issued_at, expires_at, mac, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)', challenge.challengeId, challenge.nonce, challenge.actorId, challenge.role, challenge.projectId, challenge.workspaceId, challenge.workspaceRevision, challenge.workspaceContentHash, challenge.tool, challenge.scope, challenge.callId, challenge.argumentsHash, challenge.commandHash, challenge.issuedAt, challenge.expiresAt, challenge.mac); return inserted.changes === 1; } catch { return false; }
    },
    async get(challengeId) { const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_approval_challenges WHERE challenge_id = ?', challengeId); return row ? rowToChallenge(row) : null; },
    async consume({ challengeId, now, bindingHash }) { const current = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_approval_challenges WHERE challenge_id = ?', challengeId); if (!current) return null; const challenge = rowToChallenge(current); if (hashBoundaryValue(challenge) !== bindingHash) return null; const updated = await db.execute('UPDATE nf_precision_cad_approval_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?', now, challengeId, now); return updated.changes === 1 ? challenge : null; },
  }, input, secret, now, ttlMs);
  return result;
}
export async function consumeDbApprovalChallenge(db: DbAdapter, input: ApprovalConsumeInput, secret: string, verifierNow = Date.now()): Promise<BoundaryResult> {
  await ensureApprovalChallengeTable(db);
  const result = await consumeApprovalChallenge({
    async insert() { return false; },
    async get(challengeId) { const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_approval_challenges WHERE challenge_id = ?', challengeId); return row ? rowToChallenge(row) : null; },
    async consume({ challengeId, now, bindingHash }) { const current = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_approval_challenges WHERE challenge_id = ?', challengeId); if (!current) return null; const challenge = rowToChallenge(current); if (hashBoundaryValue(challenge) !== bindingHash) return null; const updated = await db.execute('UPDATE nf_precision_cad_approval_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?', now, challengeId, now); return updated.changes === 1 ? challenge : null; },
  }, input, secret, verifierNow);
  return result;
}
function rowToChallenge(row: Record<string, unknown>): ApprovalChallenge {
  return { schema: COMMERCIAL_AGENT_EXECUTION_BOUNDARY_SCHEMA, challengeId: String(row.challenge_id), nonce: String(row.nonce), actorId: String(row.actor_id), role: row.role as BoundaryRole, projectId: String(row.project_id), workspaceId: String(row.workspace_id), workspaceRevision: Number(row.workspace_revision), workspaceContentHash: String(row.workspace_content_hash), tool: String(row.tool), scope: row.scope as BoundaryScope, callId: String(row.call_id), argumentsHash: String(row.arguments_hash), commandHash: String(row.command_hash), issuedAt: Number(row.issued_at), expiresAt: Number(row.expires_at), mac: String(row.mac) };
}
