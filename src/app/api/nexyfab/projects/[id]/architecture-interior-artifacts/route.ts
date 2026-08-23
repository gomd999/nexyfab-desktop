import { timingSafeEqual } from 'node:crypto';
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
import { executeArchitectureInteriorArtifactTransaction } from '@/lib/ai/architectureInteriorArtifactTransaction';
import { readArchitectureInteriorWorkspace, ensureArchitectureInteriorWorkspaceTables } from '@/lib/ai/architectureInteriorWorkspaceStore';
import { persistArchitectureInteriorArtifactBundle, readLatestArchitectureInteriorArtifactBundle, ensureArchitectureInteriorArtifactBundleTables } from '@/lib/ai/architectureInteriorArtifactBundleStore';
import type { ArchitectureInteriorDerivedArtifactKind } from '@/lib/ai/architectureInteriorArtifactTransaction';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const APPROVAL_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const ALLOWED_KINDS = new Set<ArchitectureInteriorDerivedArtifactKind>(['quantity', 'drawing', 'ifc']);
const BODY_KEYS = new Set(['expectedWorkspaceRevision', 'expectedWorkspaceContentHash', 'requestedKinds', 'expectedHeadBundleHash', 'approved', 'approvalToken', 'approvalScope']);
const APPROVAL_TOOL = 'architecture-interior-artifacts.post';

type RouteParams = { params: Promise<{ id: string }> };
type ArtifactBody = {
  expectedWorkspaceRevision: number;
  expectedWorkspaceContentHash: string;
  requestedKinds: ArchitectureInteriorDerivedArtifactKind[];
  expectedHeadBundleHash: string | null;
  approved?: boolean;
  approvalToken?: string;
  approvalScope?: 'architecture_interior_artifacts';
};

function response(code: string, status: number, extra: Record<string, unknown> = {}, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ ok: false, code, statusKey: `architectureInterior.artifacts.${code.toLowerCase()}`, ...extra }, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

function safeResponse(value: unknown, status: number): NextResponse {
  try {
    const json = JSON.stringify(value);
    if (!json || Buffer.byteLength(json, 'utf8') > MAX_RESPONSE_BYTES) return response('RESPONSE_TOO_LARGE', 413);
    return new NextResponse(json, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
  } catch { return response('RESPONSE_INVALID', 500); }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

function parseBody(value: unknown): { ok: true; body: ArtifactBody } | { ok: false } {
  if (!isRecord(value) || Object.keys(value).some(key => !BODY_KEYS.has(key))) return { ok: false };
  const revision = value.expectedWorkspaceRevision;
  const requested = value.requestedKinds;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || typeof value.expectedWorkspaceContentHash !== 'string' || !SHA256.test(value.expectedWorkspaceContentHash)) return { ok: false };
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 3 || requested.some(kind => typeof kind !== 'string' || !ALLOWED_KINDS.has(kind as ArchitectureInteriorDerivedArtifactKind)) || new Set(requested).size !== requested.length) return { ok: false };
  const head = value.expectedHeadBundleHash;
  if (head !== null && (typeof head !== 'string' || !SHA256.test(head))) return { ok: false };
  if (value.approved !== undefined && typeof value.approved !== 'boolean') return { ok: false };
  if (value.approvalToken !== undefined && (typeof value.approvalToken !== 'string' || !APPROVAL_TOKEN.test(value.approvalToken))) return { ok: false };
  if (value.approvalScope !== undefined && value.approvalScope !== 'architecture_interior_artifacts') return { ok: false };
  return { ok: true, body: { expectedWorkspaceRevision: revision, expectedWorkspaceContentHash: value.expectedWorkspaceContentHash, requestedKinds: requested as ArchitectureInteriorDerivedArtifactKind[], expectedHeadBundleHash: head as string | null, ...(value.approved === undefined ? {} : { approved: value.approved }), ...(value.approvalToken === undefined ? {} : { approvalToken: value.approvalToken }), ...(value.approvalScope === undefined ? {} : { approvalScope: value.approvalScope }) } };
}

function approvalArguments(body: ArtifactBody) {
  return { expectedWorkspaceRevision: body.expectedWorkspaceRevision, expectedWorkspaceContentHash: body.expectedWorkspaceContentHash, requestedKinds: [...body.requestedKinds].sort(), expectedHeadBundleHash: body.expectedHeadBundleHash, approvalScope: 'architecture_interior_artifacts' };
}

async function context(req: NextRequest, projectId: string) {
  const auth = await getAuthUser(req);
  if (!auth) return { error: response('AUTHENTICATION_REQUIRED', 401) } as const;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return { error: response('PROJECT_NOT_FOUND', 404) } as const;
  const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId);
  return { auth, db, access, tenantId } as const;
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id: projectId } = await params;
  const current = await context(req, projectId);
  if ('error' in current && current.error) return current.error;
  const limit = await rateLimitAsync(`architecture-interior-artifacts:get:${projectId}:${current.auth.userId}:${getTrustedClientIp(req.headers)}`, 30, 60_000);
  if (!limit.allowed) return response('RATE_LIMITED', 429, {}, rateLimitHeaders(limit, 30));
  try { await ensureArchitectureInteriorArtifactBundleTables(current.db); } catch { return response('INTERNAL_ERROR', 500); }
  const result = await readLatestArchitectureInteriorArtifactBundle(current.db, { tenantId: current.tenantId }, projectId);
  if (!result.ok) return result.code === 'NOT_FOUND' ? response('NOT_FOUND', 404) : response('CORRUPT_STORED_ROW', 500);
  return safeResponse({ ok: true, code: 'BUNDLE_FOUND', statusKey: 'architectureInterior.artifacts.bundle_found', projectId, bundle: result.bundle, persisted: true, exact: { status: 'not_run' }, pricing: { status: 'not_run', reasonCode: 'authoritative_unit_rates_required' }, ifcRoundtrip: { status: 'not_run', reasonCode: 'ifc_roundtrip_not_run' }, release: { status: 'not_run' } }, 200);
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  if (!checkOrigin(req)) return response('ORIGIN_REJECTED', 403);
  const { id: projectId } = await params;
  const current = await context(req, projectId);
  if ('error' in current && current.error) return current.error;
  if (!current.access.canEdit) return response('EDITOR_REQUIRED', 403);
  const ip = getTrustedClientIp(req.headers);
  const limit = await rateLimitAsync(`architecture-interior-artifacts:post:${projectId}:${current.auth.userId}:${ip}`, 5, 60_000);
  if (!limit.allowed) return response('RATE_LIMITED', 429, {}, rateLimitHeaders(limit, 5));
  let raw: unknown;
  try { raw = await readBoundedJson<unknown>(req, MAX_REQUEST_BYTES); } catch (cause) { const bounded = boundedJsonError(cause); return response(bounded?.code === 'PAYLOAD_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'BAD_REQUEST', bounded?.status ?? 400); }
  const parsed = parseBody(raw);
  if (!parsed.ok) return response('BAD_REQUEST', 400);
  const body = parsed.body;
  const token = makeRemoteApprovalToken({ userId: current.auth.userId, projectId, revision: body.expectedWorkspaceRevision, tool: APPROVAL_TOOL, arguments: approvalArguments(body) });
  if (!token) return response('APPROVAL_CONFIG_REQUIRED', 503);
  if (body.approved !== true) return safeResponse({ ok: false, code: 'APPROVAL_REQUIRED', statusKey: 'architectureInterior.artifacts.approval_required', approval: { scope: 'architecture_interior_artifacts', token, expectedWorkspaceRevision: body.expectedWorkspaceRevision, expectedWorkspaceContentHash: body.expectedWorkspaceContentHash, requestedKinds: body.requestedKinds, expectedHeadBundleHash: body.expectedHeadBundleHash } }, 409);
  if (!body.approvalToken) return response('APPROVAL_INVALID', 409);
  const provided = Buffer.from(body.approvalToken); const expected = Buffer.from(token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return response('APPROVAL_INVALID', 409);
  try { await ensureArchitectureInteriorWorkspaceTables(current.db); await ensureArchitectureInteriorArtifactBundleTables(current.db); } catch { return response('INTERNAL_ERROR', 500); }
  const stored = await readArchitectureInteriorWorkspace(current.db, { tenantId: current.tenantId }, projectId);
  if (!stored.ok) return stored.code === 'NOT_FOUND' ? response('WORKSPACE_NOT_FOUND', 404) : response('CORRUPT_WORKSPACE', 500);
  if (stored.workspace.workspace.revision !== body.expectedWorkspaceRevision || stored.workspace.contentHash !== body.expectedWorkspaceContentHash) return response('WORKSPACE_REVISION_CONFLICT', 409, { currentRevision: stored.workspace.workspace.revision, currentContentHash: stored.workspace.contentHash });
  const generated = executeArchitectureInteriorArtifactTransaction({ workspace: stored.workspace, expectedWorkspaceRevision: body.expectedWorkspaceRevision, requestedKinds: body.requestedKinds });
  if (!generated.committed) return response('ARTIFACT_TRANSACTION_REJECTED', 422, { transactionCode: generated.code, issues: generated.issues.slice(0, 64) });
  const saved = await persistArchitectureInteriorArtifactBundle(current.db, { tenantId: current.tenantId, userId: current.auth.userId }, projectId, body.expectedHeadBundleHash, generated.bundle);
  if (!saved.ok) {
    if (saved.code === 'BUNDLE_REVISION_CONFLICT') return response('BUNDLE_REVISION_CONFLICT', 409, { currentSourceRevision: saved.currentSourceRevision, currentSourceContentHash: saved.currentSourceContentHash, currentBundleHash: saved.currentBundleHash });
    if (saved.code === 'BUNDLE_ALREADY_EXISTS') return response('BUNDLE_ALREADY_EXISTS', 409);
    return response('BUNDLE_INVALID', 422, { issues: saved.issues.slice(0, 64) });
  }
  logAudit({ userId: current.auth.userId, action: 'architecture_interior.artifacts.derived_bundle_persisted', resourceId: projectId, ip, metadata: { sourceRevision: saved.bundle.source.revision, bundleHash: saved.bundle.bundleHash, requestedKinds: body.requestedKinds.join(','), exact: 'not_run', pricing: 'not_run', ifcRoundtrip: 'not_run', release: 'not_run' } });
  return safeResponse({ ok: true, code: 'BUNDLE_PERSISTED', statusKey: 'architectureInterior.artifacts.bundle_persisted', projectId, bundle: saved.bundle, persisted: true, exact: { status: 'not_run' }, pricing: { status: 'not_run', reasonCode: 'authoritative_unit_rates_required' }, ifcRoundtrip: { status: 'not_run', reasonCode: 'ifc_roundtrip_not_run' }, release: { status: 'not_run' }, quoteOrRfqSideEffects: false }, 200);
}
