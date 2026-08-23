import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import { ensureProjectMembersTable } from '@/lib/nfProjectAccess';
import { ensureDirectArtifactUploadTables, resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { hashCadPayload } from '@/lib/cad/workspaceRevisionStore';
import { createCadJobAuthorizationToken, verifyCadJobAuthorizationToken } from '@/lib/jobs/cadJobAuthorization';
import { getStorage } from '@/lib/storage';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';
import {
  validateCadJobMessage,
  validateCadJobReceipt,
  type CadJobArtifactRef,
  type CadJobMessage,
  type CadJobReceipt,
} from '@/lib/platform/contracts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 512 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

type Body = {
  action?: unknown;
  message?: unknown;
  receipt?: unknown;
  authorizationToken?: unknown;
};

function coreAuthorization(req: NextRequest): 'OK' | 'NOT_CONFIGURED' | 'FORBIDDEN' {
  const expected = process.env.NEXYFAB_JOB_ORCHESTRATOR_CORE_SECRET?.trim();
  if (!expected || expected.length < 32) return 'NOT_CONFIGURED';
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right) ? 'OK' : 'FORBIDDEN';
}

function authorizationSecret(): string | null {
  const secret = process.env.NEXYFAB_JOB_AUTHORIZATION_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

async function ensureCadJobRegistryTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_cad_job_registry (
      job_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      message_sha256 TEXT NOT NULL,
      message_json TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nf_cad_job_registry_project ON nf_cad_job_registry(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS nf_cad_job_receipts (
      job_id TEXT PRIMARY KEY,
      message_sha256 TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL UNIQUE,
      receipt_json TEXT NOT NULL,
      execution TEXT NOT NULL,
      accepted_at BIGINT NOT NULL
    );
  `);
}

async function validateProjectActor(db: DbAdapter, message: CadJobMessage): Promise<string[]> {
  const project = await db.queryOne<{ user_id: string; org_id: string | null }>(
    'SELECT user_id, org_id FROM nf_projects WHERE id = ?', message.projectId,
  );
  if (!project) return ['project_not_found'];
  if (resolveArtifactTenantId(project.org_id, project.user_id) !== message.tenantId) return ['tenant_project_mismatch'];
  if (project.user_id === message.requestedBy) return [];
  await ensureProjectMembersTable();
  const member = await db.queryOne<{ role: string }>(
    'SELECT role FROM nf_project_members WHERE project_id = ? AND user_id = ?',
    message.projectId, message.requestedBy,
  );
  return member?.role === 'editor' ? [] : ['project_editor_required'];
}

async function validateArtifactRefs(
  db: DbAdapter,
  message: CadJobMessage,
  refs: CadJobArtifactRef[],
  role: 'input' | 'output',
): Promise<string[]> {
  if (!refs.length) return role === 'input' ? ['input_artifacts_required'] : [];
  const ids = [...new Set(refs.map(ref => ref.artifactId))];
  const rows = await db.queryAll<{
    id: string; project_id: string; tenant_id: string; object_key: string; content_sha256: string; immutability_state: string;
  }>(`SELECT id, project_id, tenant_id, object_key, content_sha256, immutability_state
      FROM nf_cad_artifacts WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids);
  const byId = new Map(rows.map(row => [row.id, row]));
  const issues: string[] = [];
  for (const ref of refs) {
    const row = byId.get(ref.artifactId);
    if (!row) { issues.push(`${role}_artifact_not_found:${ref.artifactId}`); continue; }
    if (row.project_id !== message.projectId || row.tenant_id !== message.tenantId) issues.push(`${role}_artifact_scope_mismatch:${ref.artifactId}`);
    if (row.object_key !== ref.objectKey || row.content_sha256 !== ref.contentSha256) issues.push(`${role}_artifact_identity_mismatch:${ref.artifactId}`);
    if (row.immutability_state !== 'IMMUTABLE') issues.push(`${role}_artifact_not_immutable:${ref.artifactId}`);
  }
  return [...new Set(issues)];
}

function trustedReceiptIdentities(receipt: CadJobReceipt): string[] {
  const issues: string[] = [];
  const workerRegistryRaw = process.env.NEXYFAB_CAD_WORKER_IDENTITIES?.trim();
  const kernelRegistry = process.env.NEXYFAB_CAD_KERNEL_IDENTITIES?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  if (!workerRegistryRaw) issues.push('worker_identity_registry_not_configured');
  else {
    try {
      const identities = Object.values(JSON.parse(workerRegistryRaw) as Record<string, unknown>)
        .filter((value): value is string => typeof value === 'string' && SHA256.test(value));
      if (!identities.includes(receipt.workerIdentitySha256)) issues.push('worker_identity_not_trusted');
    } catch { issues.push('worker_identity_registry_not_configured'); }
  }
  if (!kernelRegistry.length || kernelRegistry.some(identity => !SHA256.test(identity))) issues.push('kernel_identity_registry_not_configured');
  else if (receipt.kernelIdentitySha256 !== 'NOT_APPLICABLE' && !kernelRegistry.includes(receipt.kernelIdentitySha256)) issues.push('kernel_identity_not_trusted');
  return issues;
}

function sameArtifactRefs(left: CadJobArtifactRef[], right: CadJobArtifactRef[]): boolean {
  const normalize = (refs: CadJobArtifactRef[]) => refs
    .map(ref => `${ref.artifactId}\0${ref.objectKey}\0${ref.contentSha256}`)
    .sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export async function POST(req: NextRequest) {
  const authorization = coreAuthorization(req);
  if (authorization === 'NOT_CONFIGURED') return NextResponse.json({ ok: false, code: 'CORE_AUTH_NOT_CONFIGURED' }, { status: 503 });
  if (authorization !== 'OK') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  const secret = authorizationSecret();
  if (!secret) return NextResponse.json({ ok: false, code: 'JOB_AUTHORIZATION_NOT_CONFIGURED' }, { status: 503 });
  let text: string;
  try {
    const bytes = await readBoundedRawBody(req, MAX_BODY_BYTES);
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (boundedRawBodyError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'BODY_TOO_LARGE' }, { status: 413 });
    return NextResponse.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 });
  }
  let body: Body;
  try { body = JSON.parse(text) as Body; }
  catch { return NextResponse.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 }); }
  if (!body.message || typeof body.message !== 'object') return NextResponse.json({ ok: false, code: 'MESSAGE_REQUIRED' }, { status: 400 });
  const message = body.message as CadJobMessage;
  const contractIssues = validateCadJobMessage(message);
  if (contractIssues.length) return NextResponse.json({ ok: false, code: 'JOB_CONTRACT_REJECTED', issues: contractIssues }, { status: 422 });
  const db = getDbAdapter();
  await ensureCadJobRegistryTables(db);
  await ensureDirectArtifactUploadTables(db);
  const messageSha256 = hashCadPayload(message);

  if (body.action === 'authorize') {
    const issues = [
      ...await validateProjectActor(db, message),
      ...await validateArtifactRefs(db, message, message.inputArtifacts, 'input'),
    ];
    if (issues.length) return NextResponse.json({ ok: true, authorized: false, issues: [...new Set(issues)] });
    const existing = await db.queryOne<{ message_sha256: string }>('SELECT message_sha256 FROM nf_cad_job_registry WHERE job_id = ?', message.jobId);
    if (existing && existing.message_sha256 !== messageSha256) {
      return NextResponse.json({ ok: false, code: 'JOB_ID_PAYLOAD_CONFLICT' }, { status: 409 });
    }
    const now = Date.now();
    if (!existing) {
      await db.execute(
        `INSERT INTO nf_cad_job_registry
         (job_id, tenant_id, project_id, kind, message_sha256, message_json, status, requested_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        message.jobId, message.tenantId, message.projectId, message.kind, messageSha256,
        JSON.stringify(message), 'AUTHORIZED', message.requestedBy, now, now,
      );
    }
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const storage = getStorage();
    const inputArtifacts = await Promise.all(message.inputArtifacts.map(async artifact => {
      try {
        return { artifact, downloadUrl: await storage.getSignedUrl(artifact.objectKey, 15 * 60), expiresAt };
      } catch {
        // Local private storage has no public URL. The authenticated artifact
        // gateway provides the development-only streaming fallback.
        const origin = new URL(req.url).origin;
        return {
          artifact,
          downloadUrl: `${origin}/api/internal/cad-job-artifacts?jobId=${encodeURIComponent(message.jobId)}&artifactId=${encodeURIComponent(artifact.artifactId)}`,
          expiresAt,
        };
      }
    }));
    return NextResponse.json({
      ok: true,
      authorized: true,
      authorizationToken: createCadJobAuthorizationToken(message.jobId, messageSha256, secret),
      artifactGatewayUrl: `${new URL(req.url).origin}/api/internal/cad-job-artifacts`,
      inputArtifacts,
      execution: 'NOT_RUN',
      releaseVerification: 'NOT_RUN',
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  if (body.action === 'complete') {
    if (!body.receipt || typeof body.receipt !== 'object' || typeof body.authorizationToken !== 'string') {
      return NextResponse.json({ ok: false, code: 'RECEIPT_AND_AUTHORIZATION_REQUIRED' }, { status: 400 });
    }
    if (!verifyCadJobAuthorizationToken(body.authorizationToken, message.jobId, messageSha256, secret)) {
      return NextResponse.json({ ok: false, code: 'JOB_AUTHORIZATION_INVALID' }, { status: 403 });
    }
    const registry = await db.queryOne<{ message_sha256: string }>('SELECT message_sha256 FROM nf_cad_job_registry WHERE job_id = ?', message.jobId);
    if (!registry || registry.message_sha256 !== messageSha256) return NextResponse.json({ ok: false, code: 'JOB_NOT_AUTHORIZED' }, { status: 409 });
    const receipt = body.receipt as CadJobReceipt;
    const { receiptSha256, ...receiptCore } = receipt;
    const issues = [
      ...validateCadJobReceipt(receipt),
      ...trustedReceiptIdentities(receipt),
      ...(receipt.jobId === message.jobId ? [] : ['receipt_job_mismatch']),
      ...(sameArtifactRefs(receipt.inputArtifacts, message.inputArtifacts) ? [] : ['receipt_input_artifacts_mismatch']),
      ...(receiptSha256 === hashCadPayload(receiptCore) ? [] : ['receipt_sha256_mismatch']),
      ...await validateArtifactRefs(db, message, receipt.outputArtifacts, 'output'),
    ];
    if (issues.length) return NextResponse.json({ ok: true, accepted: false, issues: [...new Set(issues)] });
    const existing = await db.queryOne<{ receipt_sha256: string }>('SELECT receipt_sha256 FROM nf_cad_job_receipts WHERE job_id = ?', message.jobId);
    if (existing && existing.receipt_sha256 !== receipt.receiptSha256) {
      return NextResponse.json({ ok: false, code: 'RECEIPT_CONFLICT' }, { status: 409 });
    }
    const now = Date.now();
    if (!existing) {
      await db.transaction(async tx => {
        await tx.execute(
          `INSERT INTO nf_cad_job_receipts
           (job_id, message_sha256, receipt_sha256, receipt_json, execution, accepted_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          message.jobId, messageSha256, receipt.receiptSha256, JSON.stringify(receipt), receipt.execution, now,
        );
        await tx.execute('UPDATE nf_cad_job_registry SET status = ?, updated_at = ? WHERE job_id = ? AND message_sha256 = ?',
          receipt.execution === 'PASS' ? 'EXECUTION_PASS' : `EXECUTION_${receipt.execution}`, now, message.jobId, messageSha256);
      });
    }
    return NextResponse.json({
      ok: true, accepted: true, idempotent: Boolean(existing),
      execution: receipt.execution, releaseVerification: 'NOT_RUN', receiptSha256: receipt.receiptSha256,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return NextResponse.json({ ok: false, code: 'INVALID_ACTION' }, { status: 400 });
}
