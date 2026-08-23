import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { makeRemoteApprovalToken } from '@/lib/precision-cad-agent/remoteApprovalToken';
import { hashArchitectureInteriorEvidenceV2 } from '@/lib/ai/architectureInteriorWorkspace';
import { bootstrapArchitectureInteriorAiCandidateWorkspace } from '@/lib/ai/architectureInteriorAiCandidateWorkspace';
import type { CompiledArchitectureInteriorConcept } from '@/lib/ai/architectureInteriorAiDesignProposal';
import { ensureArchitectureInteriorWorkspaceTables, persistArchitectureInteriorWorkspace } from '@/lib/ai/architectureInteriorWorkspaceStore';
import { readBoundedJson, boundedJsonError } from '@/lib/boundedJsonBody';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const APPROVAL_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const BODY_KEYS = new Set(['proposalId', 'proposalHash', 'candidateHash', 'candidate', 'approvalToken']);

type RouteParams = { params: Promise<{ id: string }> };
type CommitBody = { proposalId: string; proposalHash: string; candidateHash: string; candidate: unknown; approvalToken: string };
type RouteError = 'AUTHENTICATION_REQUIRED' | 'PROJECT_NOT_FOUND' | 'ORIGIN_REJECTED' | 'BAD_REQUEST' | 'REQUEST_TOO_LARGE' | 'RATE_LIMITED' | 'EDITOR_REQUIRED' | 'APPROVAL_CONFIG_REQUIRED' | 'APPROVAL_INVALID' | 'CANDIDATE_INVALID' | 'REVISION_CONFLICT' | 'INVALID_WORKSPACE' | 'INTERNAL_ERROR';

function fail(code: RouteError, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, code, ...extra }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function hashCandidate(value: unknown): string { return hashArchitectureInteriorEvidenceV2(value); }

function parseBody(value: unknown): { ok: true; body: CommitBody } | { ok: false } {
  if (!isRecord(value) || Object.keys(value).some(key => !BODY_KEYS.has(key))) return { ok: false };
  if (typeof value.proposalId !== 'string' || !SAFE_ID.test(value.proposalId)) return { ok: false };
  if (typeof value.proposalHash !== 'string' || !SHA256.test(value.proposalHash)) return { ok: false };
  if (typeof value.candidateHash !== 'string' || !SHA256.test(value.candidateHash)) return { ok: false };
  if (!isRecord(value.candidate)) return { ok: false };
  if (typeof value.approvalToken !== 'string' || !APPROVAL_TOKEN.test(value.approvalToken)) return { ok: false };
  return { ok: true, body: { proposalId: value.proposalId, proposalHash: value.proposalHash, candidateHash: value.candidateHash, candidate: value.candidate, approvalToken: value.approvalToken } };
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  if (!checkOrigin(req)) return fail('ORIGIN_REJECTED', 403);
  const auth = await getAuthUser(req);
  if (!auth) return fail('AUTHENTICATION_REQUIRED', 401);
  const { id: projectId } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return fail('PROJECT_NOT_FOUND', 404);
  if (!access.canEdit) return fail('EDITOR_REQUIRED', 403);
  const ip = getTrustedClientIpOrUndefined(req.headers) ?? 'unknown';
  const limit = await rateLimitAsync(`architecture-interior-ai-design-commit:${projectId}:${auth.userId}:${ip}`, 5, 60_000);
  if (!limit.allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMITED' }, { status: 429, headers: { 'Cache-Control': 'private, no-store', ...rateLimitHeaders(limit, 5) } });

  let raw: unknown;
  try { raw = await readBoundedJson<unknown>(req, MAX_REQUEST_BYTES); }
  catch (cause) {
    const bounded = boundedJsonError(cause);
    return fail(bounded?.code === 'PAYLOAD_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'BAD_REQUEST', bounded?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400);
  }
  const parsed = parseBody(raw);
  if (!parsed.ok) return fail('BAD_REQUEST', 400);
  const body = parsed.body;
  let candidateHash: string;
  try { candidateHash = hashCandidate(body.candidate); } catch { return fail('CANDIDATE_INVALID', 422); }
  if (candidateHash !== body.candidateHash) return fail('APPROVAL_INVALID', 409);
  const candidateRecord = body.candidate as Record<string, unknown>;
  const embeddedHashes = isRecord(candidateRecord.hashes) ? candidateRecord.hashes : null;
  if (!embeddedHashes || embeddedHashes.proposal !== body.proposalHash) return fail('APPROVAL_INVALID', 409);
  const expectedToken = makeRemoteApprovalToken({ userId: auth.userId, projectId, revision: -1, tool: 'architecture-interior-ai-design.commit', arguments: { proposalId: body.proposalId, proposalHash: body.proposalHash, candidateHash: body.candidateHash } });
  if (!expectedToken) return fail('APPROVAL_CONFIG_REQUIRED', 503);
  const provided = Buffer.from(body.approvalToken); const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return fail('APPROVAL_INVALID', 409);

  const bootstrapped = bootstrapArchitectureInteriorAiCandidateWorkspace({ candidate: body.candidate as CompiledArchitectureInteriorConcept, approval: { projectId, proposalId: body.proposalId, proposalHash: body.proposalHash, actorId: auth.userId, scope: 'architecture_interior_concept' } });
  if (!bootstrapped.ok) return fail('CANDIDATE_INVALID', 422, { issues: bootstrapped.issues.slice(0, 32) });
  try { await ensureArchitectureInteriorWorkspaceTables(db); } catch { return fail('INTERNAL_ERROR', 500); }
  const saved = await persistArchitectureInteriorWorkspace(db, { tenantId: resolveArtifactTenantId(access.row.org_id, access.ownerUserId), userId: auth.userId }, projectId, -1, bootstrapped.workspace);
  if (!saved.ok) {
    if (saved.code === 'REVISION_CONFLICT') return fail('REVISION_CONFLICT', 409, { currentRevision: saved.currentRevision, currentContentHash: saved.currentContentHash });
    return fail('INVALID_WORKSPACE', 422, { issues: saved.issues });
  }
  logAudit({ userId: auth.userId, action: 'architecture_interior_ai_design.commit', resourceId: projectId, ip, metadata: { proposalId: body.proposalId, revision: saved.workspace.workspace.revision, contentHash: saved.workspace.contentHash, persisted: true } });
  const response = { ok: true, code: 'CONCEPT_COMMITTED', projectId, proposalId: body.proposalId, persisted: true, revision: saved.workspace.workspace.revision, revisionId: saved.revisionId, contentHash: saved.workspace.contentHash, exact: { status: 'not_run' }, compliance: { status: 'not_run' }, release: { status: 'not_run' }, quoteOrRfqSideEffects: false };
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') > 64 * 1024) return fail('INTERNAL_ERROR', 500);
  return NextResponse.json(response, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
}
