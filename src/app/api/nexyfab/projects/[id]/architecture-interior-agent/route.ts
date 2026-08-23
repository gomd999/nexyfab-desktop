import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { logAudit } from '@/lib/audit';
import {
  ARCHITECTURE_INTERIOR_TOOL_CATALOG,
  type ArchitectureInteriorToolScope,
} from '@/lib/precision-cad-agent/architectureInteriorToolCatalog';
import {
  executeArchitectureInteriorBrowserTool,
  hashArchitectureInteriorBrowserApproval,
  type ArchitectureInteriorBrowserRole,
  type ArchitectureInteriorBrowserSession,
  type ArchitectureInteriorBrowserToolCall,
} from '@/lib/precision-cad-agent/architectureInteriorBrowserGateway';
import {
  ensureArchitectureInteriorWorkspaceTables,
  persistArchitectureInteriorWorkspace,
  readArchitectureInteriorWorkspace,
} from '@/lib/ai/architectureInteriorWorkspaceStore';
import {
  appendArchitectureInteriorHistoryEventInTransaction,
  ensureArchitectureInteriorHistoryTables,
} from '@/lib/ai/architectureInteriorHistoryStore';
import type { ArchitectureInteriorWorkspaceV2 } from '@/lib/ai/architectureInteriorWorkspace';
import { makeRemoteApprovalToken } from '@/lib/precision-cad-agent/remoteApprovalToken';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const APPROVAL_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const READ_TOOLS = new Set(['get_project_context', 'list_storeys_spaces', 'inspect_element', 'verify_architecture', 'verify_interior', 'verify_space']);
// Keep this list explicit: only the bounded concept operations that the
// server gateway/executor can actually commit are exposed to the browser.
// Finish and millwork are intentionally included for both creation and
// editing; their schema carries stable space/host references and the
// transaction validates the resulting envelope atomically.
const APPLY_TOOLS = new Set([
  'edit_wall', 'edit_space', 'edit_slab', 'edit_opening', 'edit_ceiling',
  'edit_furniture', 'edit_light', 'edit_finish', 'edit_millwork',
  'edit_ceiling_system', 'create_finish', 'create_millwork',
  'create_grid', 'edit_grid', 'create_stair', 'edit_stair',
  'create_shaft', 'edit_shaft', 'create_elevator', 'edit_elevator', 'create_service_opening', 'edit_service_opening',
]);

type RouteParams = { params: Promise<{ id: string }> };
type RouteErrorCode =
  | 'AUTHENTICATION_REQUIRED' | 'PROJECT_NOT_FOUND' | 'ORIGIN_REJECTED' | 'BAD_REQUEST'
  | 'REQUEST_TOO_LARGE' | 'WORKSPACE_NOT_FOUND' | 'WORKSPACE_CORRUPT' | 'EDITOR_REQUIRED'
  | 'APPROVAL_REQUIRED' | 'APPROVAL_INVALID' | 'REVISION_CONFLICT' | 'INVALID_WORKSPACE'
  | 'APPROVAL_CONFIG_REQUIRED' | 'GATEWAY_REJECTED' | 'RESPONSE_TOO_LARGE' | 'HISTORY_RECORD_FAILED' | 'INTERNAL_ERROR';

function fail(code: RouteErrorCode, status: number): NextResponse {
  return NextResponse.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeResponse(value: unknown, status = 200): NextResponse | null {
  try {
    const text = JSON.stringify(value);
    if (text === undefined || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return null;
  } catch {
    return null;
  }
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function role(value: string): ArchitectureInteriorBrowserRole {
  return value === 'owner' || value === 'editor' ? value : 'viewer';
}

function sessionFor(input: {
  userId: string;
  projectId: string;
  role: ArchitectureInteriorBrowserRole;
  workspace: ArchitectureInteriorWorkspaceV2;
}): ArchitectureInteriorBrowserSession {
  const sessionId = `browser-${hash({ userId: input.userId, projectId: input.projectId, revision: input.workspace.workspace.revision, contentHash: input.workspace.contentHash }).slice(0, 40)}`;
  return {
    sessionId,
    userId: input.userId,
    role: input.role,
    projectId: input.projectId,
    revision: input.workspace.workspace.revision,
    contentHash: input.workspace.contentHash,
    workspace: input.workspace,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseCall(body: unknown): { ok: true; call: ArchitectureInteriorBrowserToolCall; locale?: string } | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  const forbidden = ['workspace', 'profile', 'domain', 'capabilities', 'approvedActionHashes', 'session', 'provider', 'model', 'credentials', 'approvalAllowlist'];
  if (forbidden.some(key => Object.prototype.hasOwnProperty.call(body, key))) return { ok: false };
  const allowed = new Set(['tool', 'arguments', 'requestedScope', 'requestedProfile', 'requestedDomain', 'approval', 'locale']);
  if (Object.keys(body).some(key => !allowed.has(key))) return { ok: false };
  if (typeof body.tool !== 'string' || !isRecord(body.arguments)) return { ok: false };
  if (body.locale !== undefined && (typeof body.locale !== 'string' || body.locale.length > 16)) return { ok: false };
  if (body.requestedScope !== undefined && body.requestedScope !== 'read' && body.requestedScope !== 'apply' && body.requestedScope !== 'export') return { ok: false };
  if (body.requestedProfile !== undefined && typeof body.requestedProfile !== 'string') return { ok: false };
  if (body.requestedDomain !== undefined && typeof body.requestedDomain !== 'string') return { ok: false };
  let approval: ArchitectureInteriorBrowserToolCall['approval'];
  if (body.approval !== undefined) {
    if (!isRecord(body.approval) || typeof body.approval.approved !== 'boolean' || (body.approval.receiptHash !== undefined && (typeof body.approval.receiptHash !== 'string' || !APPROVAL_TOKEN.test(body.approval.receiptHash)))) return { ok: false };
    approval = { approved: body.approval.approved, ...(body.approval.receiptHash ? { receiptHash: body.approval.receiptHash } : {}) };
  }
  return {
    ok: true,
    locale: typeof body.locale === 'string' ? body.locale : undefined,
    call: {
      tool: body.tool,
      arguments: body.arguments,
      ...(body.requestedScope !== undefined ? { requestedScope: body.requestedScope } : {}),
      ...(body.requestedProfile !== undefined ? { requestedProfile: body.requestedProfile } : {}),
      ...(body.requestedDomain !== undefined ? { requestedDomain: body.requestedDomain } : {}),
      ...(approval ? { approval } : {}),
    },
  };
}

async function loadContext(req: NextRequest, projectId: string) {
  const auth = await getAuthUser(req);
  if (!auth) return { error: fail('AUTHENTICATION_REQUIRED', 401) } as const;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return { error: fail('PROJECT_NOT_FOUND', 404) } as const;
  await ensureArchitectureInteriorWorkspaceTables(db);
  const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId);
  await ensureArchitectureInteriorHistoryTables(db);
  const stored = await readArchitectureInteriorWorkspace(db, { tenantId }, projectId);
  if (!stored.ok) return { error: fail(stored.code === 'NOT_FOUND' ? 'WORKSPACE_NOT_FOUND' : 'WORKSPACE_CORRUPT', stored.code === 'NOT_FOUND' ? 404 : 409) } as const;
  return { auth, access, db, stored } as const;
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id: projectId } = await params;
  const context = await loadContext(req, projectId);
  if ('error' in context) return context.error ?? fail('INTERNAL_ERROR', 500);
  const session = sessionFor({ userId: context.auth.userId, projectId, role: role(context.access.role), workspace: context.stored.workspace });
  const tools = ARCHITECTURE_INTERIOR_TOOL_CATALOG
    .filter(item => READ_TOOLS.has(item.name) || (APPLY_TOOLS.has(item.name) && context.access.canEdit))
    .map(item => ({ name: item.name, scope: item.scope as ArchitectureInteriorToolScope }));
  const response = safeResponse({ ok: true, profile: 'architecture-interior', domain: 'architecture-interior', session: { sessionId: session.sessionId, revision: session.revision, contentHash: session.contentHash, role: session.role }, workspace: session.workspace, tools });
  return response ?? fail('RESPONSE_TOO_LARGE', 413);
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  if (!checkOrigin(req)) return fail('ORIGIN_REJECTED', 403);
  const { id: projectId } = await params;
  const context = await loadContext(req, projectId);
  if ('error' in context) return context.error ?? fail('INTERNAL_ERROR', 500);
  let raw: unknown;
  try { raw = await readBoundedJson<unknown>(req, MAX_REQUEST_BYTES); }
  catch (cause) {
    const bounded = boundedJsonError(cause);
    return fail(bounded?.code === 'PAYLOAD_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'BAD_REQUEST', bounded?.status ?? 400);
  }
  const parsed = parseCall(raw);
  if (!parsed.ok) return fail('BAD_REQUEST', 400);
  const session = sessionFor({ userId: context.auth.userId, projectId, role: role(context.access.role), workspace: context.stored.workspace });

  const definition = ARCHITECTURE_INTERIOR_TOOL_CATALOG.find(item => item.name === parsed.call.tool);
  const mutating = Boolean(definition && definition.scope === 'apply' && APPLY_TOOLS.has(parsed.call.tool));
  if (!mutating && parsed.call.approval !== undefined) return fail('BAD_REQUEST', 400);
  let callForGateway = parsed.call;
  if (mutating) {
    if (!context.access.canEdit) return fail('EDITOR_REQUIRED', 403);
    const approvalToken = makeRemoteApprovalToken({ userId: session.userId, projectId: session.projectId, revision: session.revision, tool: parsed.call.tool, arguments: parsed.call.arguments });
    if (!approvalToken) return fail('APPROVAL_CONFIG_REQUIRED', 503);
    if (parsed.call.approval?.approved !== true) {
      return safeResponse({ ok: false, code: 'APPROVAL_REQUIRED', statusKey: 'architectureInterior.agent.approval_required', messageKey: 'architectureInterior.agent.approval_required', approval: { receiptHash: approvalToken } }, 409) ?? fail('RESPONSE_TOO_LARGE', 413);
    }
    const provided = Buffer.from(parsed.call.approval.receiptHash ?? '');
    const expectedToken = Buffer.from(approvalToken);
    if (provided.length !== expectedToken.length || !timingSafeEqual(provided, expectedToken)) return fail('APPROVAL_INVALID', 409);
    const expectedActionHash = hashArchitectureInteriorBrowserApproval({ sessionId: session.sessionId, userId: session.userId, projectId: session.projectId, revision: session.revision, contentHash: session.contentHash, tool: parsed.call.tool, arguments: parsed.call.arguments });
    session.approvedActionHashes = [expectedActionHash];
    callForGateway = { ...parsed.call, approval: { approved: true, receiptHash: expectedActionHash } };
  }
  const result = executeArchitectureInteriorBrowserTool({ session, call: callForGateway });
  if (!result.ok) {
    const status = result.code === 'APPROVAL_REQUIRED' || result.code === 'APPROVAL_INVALID' ? 409 : result.code === 'EDITOR_REQUIRED' ? 403 : result.code === 'TOOL_NOT_FOUND' ? 404 : 422;
    return safeResponse(result, status) ?? fail('RESPONSE_TOO_LARGE', 413);
  }

  let persisted: unknown;
  if (result.workspace) {
    if (!context.access.canEdit) return fail('EDITOR_REQUIRED', 403);
    const tenantId = resolveArtifactTenantId(context.access.row.org_id, context.access.ownerUserId);
    let saved: Awaited<ReturnType<typeof persistArchitectureInteriorWorkspace>>;
    try {
      const committed = await context.db.transaction(async tx => {
        const workspaceResult = await persistArchitectureInteriorWorkspace(
          context.db,
          { tenantId, userId: context.auth.userId },
          projectId,
          session.revision,
          result.workspace!,
          { baseContentHash: session.contentHash, transactionalAdapter: tx },
        );
        if (!workspaceResult.ok) return { saved: workspaceResult };
        await appendArchitectureInteriorHistoryEventInTransaction(tx, { tenantId, projectId }, {
          operation: 'apply',
          lineageId: result.audit.auditId,
          actorUserId: context.auth.userId,
          commandId: result.audit.auditId,
          sourceRevision: session.revision,
          sourceContentHash: session.contentHash,
          targetRevision: workspaceResult.workspace.workspace.revision,
          targetContentHash: workspaceResult.workspace.contentHash,
        });
        return { saved: workspaceResult };
      });
      saved = committed.saved;
    } catch {
      return fail('HISTORY_RECORD_FAILED', 503);
    }
    if (!saved.ok) {
      if (saved.code === 'REVISION_CONFLICT') return fail('REVISION_CONFLICT', 409);
      return fail('INVALID_WORKSPACE', 422);
    }
    persisted = { revisionId: saved.revisionId, revision: saved.workspace.workspace.revision, contentHash: saved.workspace.contentHash };
  }
  logAudit({ userId: context.auth.userId, action: result.workspace ? 'architecture_interior_agent.mutation' : 'architecture_interior_agent.read', resourceId: projectId, ip: getTrustedClientIpOrUndefined(req.headers), metadata: { tool: result.tool, scope: result.scope, revision: session.revision, locale: parsed.locale ?? 'unspecified', persisted: Boolean(persisted) } });
  const response = safeResponse({ ...result, ...(persisted === undefined ? {} : { persistence: persisted }) });
  return response ?? fail('RESPONSE_TOO_LARGE', 413);
}
