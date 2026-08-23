import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { logAudit } from '@/lib/audit';
import { makeRemoteApprovalToken } from '@/lib/precision-cad-agent/remoteApprovalToken';
import { createNodeArchitectureExactKernelAdapter } from '@/lib/ai/architectureInteriorExactGeometry';
import { executeArchitectureInteriorExactTransaction } from '@/lib/ai/architectureInteriorExactTransaction';
import { ensureArchitectureInteriorWorkspaceTables, persistArchitectureInteriorWorkspace, readArchitectureInteriorWorkspace } from '@/lib/ai/architectureInteriorWorkspaceStore';
import { getStorage } from '@/lib/storage';
import { compactArchitectureInteriorExactWorkspace, deleteArchitectureInteriorExactArtifact, ensureArchitectureInteriorExactArtifactTables, persistArchitectureInteriorExactArtifact, readValidateArchitectureInteriorExactArtifact } from '@/lib/ai/architectureInteriorExactArtifactStore';
import { validateArchitectureInteriorWorkspaceV2 } from '@/lib/ai/architectureInteriorWorkspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const APPROVAL_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const BODY_KEYS = new Set(['expectedWorkspaceRevision', 'expectedWorkspaceContentHash', 'approved', 'approvalToken']);
const APPROVAL_TOOL = 'architecture-interior-exact.post';

type RouteParams = { params: Promise<{ id: string }> };
type ExactBody = { expectedWorkspaceRevision: number; expectedWorkspaceContentHash: string; approved?: boolean; approvalToken?: string };

function fail(code: string, status: number, extra: Record<string, unknown> = {}, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ ok: false, code, statusKey: `architectureInterior.exact.${code.toLowerCase()}`, ...extra }, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

function safeResponse(value: unknown, status: number): NextResponse {
  try {
    const json = JSON.stringify(value);
    if (!json || Buffer.byteLength(json, 'utf8') > MAX_RESPONSE_BYTES) return fail('RESPONSE_TOO_LARGE', 413);
    return new NextResponse(json, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
  } catch { return fail('RESPONSE_INVALID', 500); }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

function compactExactReference(payload: unknown, domain: 'architecture' | 'interior') {
  if (!isRecord(payload) || payload.schema !== 'nexyfab.architecture-interior-exact-compact-reference.v1' || payload.domain !== domain || !isRecord(payload.reference)) return undefined;
  const reference = payload.reference;
  if (typeof reference.manifestId !== 'string' || typeof reference.projectId !== 'string' || typeof reference.revision !== 'number' || !Number.isSafeInteger(reference.revision) || typeof reference.bundleHash !== 'string' || !SHA256.test(reference.bundleHash) || typeof payload.receiptContentHash !== 'string' || !SHA256.test(payload.receiptContentHash) || typeof payload.receiptEvidenceHash !== 'string' || !SHA256.test(payload.receiptEvidenceHash)) return undefined;
  return { manifestId: reference.manifestId, projectId: reference.projectId, revision: reference.revision, bundleHash: reference.bundleHash, receiptContentHash: payload.receiptContentHash, receiptEvidenceHash: payload.receiptEvidenceHash };
}

function parseBody(value: unknown): { ok: true; body: ExactBody } | { ok: false } {
  if (!isRecord(value) || Object.keys(value).some(key => !BODY_KEYS.has(key))) return { ok: false };
  const revision = value.expectedWorkspaceRevision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || typeof value.expectedWorkspaceContentHash !== 'string' || !SHA256.test(value.expectedWorkspaceContentHash)) return { ok: false };
  if (value.approved !== undefined && typeof value.approved !== 'boolean') return { ok: false };
  if (value.approvalToken !== undefined && (typeof value.approvalToken !== 'string' || !APPROVAL_TOKEN.test(value.approvalToken))) return { ok: false };
  return { ok: true, body: { expectedWorkspaceRevision: revision, expectedWorkspaceContentHash: value.expectedWorkspaceContentHash, ...(value.approved === undefined ? {} : { approved: value.approved }), ...(value.approvalToken === undefined ? {} : { approvalToken: value.approvalToken }) } };
}

function approvalArguments(body: ExactBody) {
  return { action: 'promote_exact', scope: 'architecture-interior-exact', expectedWorkspaceRevision: body.expectedWorkspaceRevision, expectedWorkspaceContentHash: body.expectedWorkspaceContentHash };
}

function approvalId(token: string): string { return createHash('sha256').update(token).digest('hex'); }

async function accessContext(req: NextRequest, projectId: string) {
  const auth = await getAuthUser(req);
  if (!auth) return { error: fail('AUTHENTICATION_REQUIRED', 401) } as const;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return { error: fail('PROJECT_NOT_FOUND', 404) } as const;
  return { auth, db, access, tenantId: resolveArtifactTenantId(access.row.org_id, access.ownerUserId) } as const;
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id: projectId } = await params;
  const current = await accessContext(req, projectId);
  if ('error' in current && current.error) return current.error;
  try { await ensureArchitectureInteriorWorkspaceTables(current.db); } catch { return fail('INTERNAL_ERROR', 500); }
  const stored = await readArchitectureInteriorWorkspace(current.db, { tenantId: current.tenantId }, projectId);
  if (!stored.ok) return stored.code === 'NOT_FOUND' ? fail('NOT_FOUND', 404) : fail('CORRUPT_WORKSPACE', 500);
  const architectureVerification = stored.workspace.architecture.geometry.verification;
  const interiorVerification = stored.workspace.interior.geometry.verification;
  const candidateExact = stored.workspace.workspace.track === 'precision_cad' && stored.workspace.workspace.maturity === 'exact' && architectureVerification.status === 'passed' && interiorVerification.status === 'passed';
  let artifactCheck: Awaited<ReturnType<typeof readValidateArchitectureInteriorExactArtifact>> | undefined;
  if (candidateExact) {
    const architectureReference = compactExactReference(stored.workspace.architecture.geometry.payload, 'architecture');
    const interiorReference = compactExactReference(stored.workspace.interior.geometry.payload, 'interior');
    if (!architectureReference || !interiorReference || architectureReference.manifestId !== interiorReference.manifestId || architectureReference.projectId !== projectId || interiorReference.projectId !== projectId || architectureReference.revision !== stored.workspace.workspace.revision || interiorReference.revision !== stored.workspace.workspace.revision || architectureReference.bundleHash !== interiorReference.bundleHash) artifactCheck = { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['compact_exact_reference_mismatch'] };
    else {
      try {
        await ensureArchitectureInteriorExactArtifactTables(current.db);
        artifactCheck = await readValidateArchitectureInteriorExactArtifact({ db: current.db, storage: getStorage(), owner: { tenantId: current.tenantId, userId: current.auth.userId }, projectId, manifestId: architectureReference.manifestId });
        if (artifactCheck.ok && (artifactCheck.reference.projectId !== projectId || artifactCheck.reference.revision !== stored.workspace.workspace.revision || artifactCheck.reference.bundleHash !== architectureReference.bundleHash || artifactCheck.reference.architecture.receiptContentHash !== architectureReference.receiptContentHash || artifactCheck.reference.architecture.receiptEvidenceHash !== architectureReference.receiptEvidenceHash || artifactCheck.reference.interior.receiptContentHash !== interiorReference.receiptContentHash || artifactCheck.reference.interior.receiptEvidenceHash !== interiorReference.receiptEvidenceHash)) artifactCheck = { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['compact_exact_receipt_binding_mismatch'] };
      } catch { artifactCheck = { ok: false, code: 'CORRUPT_ARTIFACT', issues: ['artifact_validation_failed'] }; }
    }
  }
  const exactPassed = candidateExact && artifactCheck?.ok === true;
  const exactReference = exactPassed && artifactCheck?.ok ? artifactCheck.reference : undefined;
  return safeResponse({ ok: true, code: 'EXACT_READINESS', statusKey: 'architectureInterior.exact.readiness', projectId, revision: stored.workspace.workspace.revision, contentHash: stored.workspace.contentHash, track: stored.workspace.workspace.track, maturity: stored.workspace.workspace.maturity, exact: { status: exactReference ? 'passed' : candidateExact ? 'not_available' : 'not_run', architecture: architectureVerification.status, interior: interiorVerification.status, ...(exactReference ? { manifestId: exactReference.manifestId, bundleHash: exactReference.bundleHash, byteLength: exactReference.byteLength, architectureEvidenceHash: architectureVerification.evidenceHash, interiorEvidenceHash: interiorVerification.evidenceHash } : candidateExact ? { reasonCode: artifactCheck?.ok === false ? artifactCheck.code.toLowerCase() : 'artifact_reference_missing' } : {}) }, compliance: { status: 'not_run' }, release: { status: 'not_run' }, quoteOrRfqSideEffects: false }, 200);
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  if (!checkOrigin(req)) return fail('ORIGIN_REJECTED', 403);
  const { id: projectId } = await params;
  const current = await accessContext(req, projectId);
  if ('error' in current && current.error) return current.error;
  if (!current.access.canEdit) return fail('EDITOR_REQUIRED', 403);
  const ip = getTrustedClientIp(req.headers);
  const limit = await rateLimitAsync(`architecture-interior-exact:${projectId}:${current.auth.userId}:${ip}`, 3, 60_000);
  if (!limit.allowed) return fail('RATE_LIMITED', 429, {}, rateLimitHeaders(limit, 3));
  let raw: unknown;
  try { raw = await readBoundedJson<unknown>(req, MAX_REQUEST_BYTES); } catch (cause) { const bounded = boundedJsonError(cause); return fail(bounded?.code === 'PAYLOAD_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'BAD_REQUEST', bounded?.status ?? 400); }
  const parsed = parseBody(raw);
  if (!parsed.ok) return fail('BAD_REQUEST', 400);
  const body = parsed.body;
  const token = makeRemoteApprovalToken({ userId: current.auth.userId, projectId, revision: body.expectedWorkspaceRevision, tool: APPROVAL_TOOL, arguments: approvalArguments(body) });
  if (!token) return fail('APPROVAL_CONFIG_REQUIRED', 503);
  if (body.approved !== true) return safeResponse({ ok: false, code: 'APPROVAL_REQUIRED', statusKey: 'architectureInterior.exact.approval_required', approval: { scope: 'architecture-interior-exact', token, expectedWorkspaceRevision: body.expectedWorkspaceRevision, expectedWorkspaceContentHash: body.expectedWorkspaceContentHash } }, 409);
  if (!body.approvalToken) return fail('APPROVAL_INVALID', 409);
  const provided = Buffer.from(body.approvalToken); const expected = Buffer.from(token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return fail('APPROVAL_INVALID', 409);
  try { await ensureArchitectureInteriorWorkspaceTables(current.db); } catch { return fail('INTERNAL_ERROR', 500); }
  const stored = await readArchitectureInteriorWorkspace(current.db, { tenantId: current.tenantId }, projectId);
  if (!stored.ok) return stored.code === 'NOT_FOUND' ? fail('WORKSPACE_NOT_FOUND', 404) : fail('CORRUPT_WORKSPACE', 500);
  if (stored.workspace.workspace.revision !== body.expectedWorkspaceRevision || stored.workspace.contentHash !== body.expectedWorkspaceContentHash) return fail('WORKSPACE_REVISION_CONFLICT', 409, { currentRevision: stored.workspace.workspace.revision, currentContentHash: stored.workspace.contentHash });
  const kernel = await createNodeArchitectureExactKernelAdapter();
  if (!kernel.ok) return fail('EXACT_GEOMETRY_KERNEL_UNAVAILABLE', 503, { reasonCode: kernel.code });
  const transaction = await executeArchitectureInteriorExactTransaction({ workspace: stored.workspace, adapter: kernel.adapter, approval: { approved: true, approvalId: approvalId(token), actorId: current.auth.userId, baseRevision: body.expectedWorkspaceRevision, scope: 'architecture-interior-exact' }, expectedWorkspaceRevision: body.expectedWorkspaceRevision, actorSource: 'user' });
  if (!transaction.committed) return fail('EXACT_TRANSACTION_REJECTED', 422, { transactionCode: transaction.code, details: transaction.details?.slice(0, 64) ?? [] });
  const storage = getStorage();
  try { await ensureArchitectureInteriorExactArtifactTables(current.db); } catch { return fail('INTERNAL_ERROR', 500); }
  const artifact = await persistArchitectureInteriorExactArtifact({ db: current.db, storage, owner: { tenantId: current.tenantId, userId: current.auth.userId }, workspace: transaction.workspace, architectureReceipt: transaction.receipt });
  if (!artifact.ok) {
    const status = artifact.code === 'STORAGE_UNAVAILABLE' ? 503 : artifact.issues.some(issue => /too_large|size_exceeded/i.test(issue)) ? 413 : 422;
    return fail(artifact.code === 'STORAGE_UNAVAILABLE' ? 'EXACT_ARTIFACT_STORAGE_UNAVAILABLE' : 'EXACT_ARTIFACT_REJECTED', status, { issues: artifact.issues.slice(0, 64) });
  }
  const compacted = compactArchitectureInteriorExactWorkspace(transaction.workspace, artifact.reference);
  const compactIssues = validateArchitectureInteriorWorkspaceV2(compacted);
  if (compactIssues.length) {
    await deleteArchitectureInteriorExactArtifact({ db: current.db, storage, owner: { tenantId: current.tenantId, userId: current.auth.userId }, projectId, manifestId: artifact.reference.manifestId });
    return fail('COMPACT_WORKSPACE_REJECTED', 422, { issues: compactIssues.slice(0, 64) });
  }
  const saved = await persistArchitectureInteriorWorkspace(current.db, { tenantId: current.tenantId, userId: current.auth.userId }, projectId, body.expectedWorkspaceRevision, compacted, { baseContentHash: body.expectedWorkspaceContentHash });
  if (!saved.ok) {
    await deleteArchitectureInteriorExactArtifact({ db: current.db, storage, owner: { tenantId: current.tenantId, userId: current.auth.userId }, projectId, manifestId: artifact.reference.manifestId });
    if (saved.code === 'REVISION_CONFLICT') return fail('WORKSPACE_PERSIST_CONFLICT', 409, { currentRevision: saved.currentRevision, currentContentHash: saved.currentContentHash });
    if (saved.code === 'INVALID_WORKSPACE' && saved.issues.some(issue => /too_large|payload_limit|size_limit/i.test(issue))) return fail('WORKSPACE_TOO_LARGE', 413, { issues: saved.issues.slice(0, 16) });
    return fail('WORKSPACE_PERSIST_REJECTED', 422, { issues: saved.issues.slice(0, 64) });
  }
  logAudit({ userId: current.auth.userId, action: 'architecture_interior.exact_geometry.promoted', resourceId: projectId, ip, metadata: { baseRevision: body.expectedWorkspaceRevision, nextRevision: saved.workspace.workspace.revision, contentHash: saved.workspace.contentHash, kernel: 'occt-node', exact: 'passed', compliance: 'not_run', release: 'not_run' } });
  return safeResponse({ ok: true, code: 'EXACT_PROMOTED', statusKey: 'architectureInterior.exact.promoted', projectId, revision: saved.workspace.workspace.revision, contentHash: saved.workspace.contentHash, exact: { status: 'passed', manifestId: artifact.reference.manifestId, bundleHash: artifact.reference.bundleHash, byteLength: artifact.reference.byteLength, architectureEvidenceHash: saved.workspace.architecture.geometry.verification.evidenceHash, interiorEvidenceHash: saved.workspace.interior.geometry.verification.evidenceHash, receiptContentHash: transaction.receipt.contentHash }, compliance: { status: 'not_run' }, release: { status: 'not_run' }, persisted: true, quoteOrRfqSideEffects: false }, 200);
}
