import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { ensureCadWorkspaceRevisionTables } from '@/lib/cad/workspaceRevisionStore';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { assertRemoteProjectRevision, hashRemoteInitialTurnRequest, loadInstallerCoreCatalog, runRemoteAgentTurn, validateRemoteBinding, type RemoteAgentInputItem } from '@/lib/precision-cad-agent/remoteAgentApi';
import { REMOTE_PRECISION_CAD_CONTRACT_VERSION, validateRemotePrecisionCadTurnRequest, type RemotePrecisionCadTurnRequest } from '@/lib/precision-cad-agent/remoteCadContract';
import { hasPrecisionCadProjectScope } from '@/lib/precision-cad-agent/apiKeyScope';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 180 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ ok: false, error: { code: 'INVALID_ORIGIN' } }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  if (!hasPrecisionCadProjectScope(auth, 'write:projects')) return NextResponse.json({ ok: false, error: { code: 'INSUFFICIENT_API_KEY_SCOPE', requiredScope: 'write:projects' } }, { status: 403 });
  const { id: projectId } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return NextResponse.json({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson<Record<string, unknown>>(req, MAX_BODY_BYTES);
  } catch (error) {
    const bounded = boundedJsonError(error);
    if (bounded) return NextResponse.json({ ok: false, error: { code: bounded.code === 'PAYLOAD_TOO_LARGE' ? 'ARGUMENTS_TOO_LARGE' : 'INVALID_REQUEST' } }, { status: bounded.status });
    throw error;
  }
  const headerIdempotencyKey = req.headers.get('idempotency-key')?.trim() || undefined;
  const bodyIdempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined;
  if (headerIdempotencyKey && bodyIdempotencyKey && headerIdempotencyKey !== bodyIdempotencyKey) return NextResponse.json({ ok: false, error: { code: 'INITIAL_TURN_REQUEST_CONFLICT' } }, { status: 409 });
  const idempotencyKey = bodyIdempotencyKey ?? headerIdempotencyKey;
  const normalizedInput = Array.isArray(body.input) ? (body.input as Array<Record<string, unknown>>).map(item => ({ ...item, ...(item.call_id && !item.callId ? { callId: item.call_id } : {}), ...(item.is_error !== undefined && item.isError === undefined ? { isError: item.is_error } : {}) })) : body.input;
  const normalizedBody = { ...body, input: normalizedInput, ...(idempotencyKey ? { idempotencyKey } : {}), ...(body.prior_provider_state && !body.continuationId ? { continuationId: (body.prior_provider_state as { handle?: unknown }).handle } : {}) };
  if (body.contractVersion !== REMOTE_PRECISION_CAD_CONTRACT_VERSION || validateRemotePrecisionCadTurnRequest({ ...normalizedBody, tools: body.tools ?? [] }).length > 0 || !validateRemoteBinding(body.binding) || (body.binding as { projectId: string }).projectId !== projectId) return NextResponse.json({ ok: false, error: { code: 'INVALID_REQUEST' } }, { status: 400 });
  const request = normalizedBody as unknown as RemotePrecisionCadTurnRequest;
  const revision = request.binding.revision;
  await ensureCadWorkspaceRevisionTables(db);
  const revisionError = await assertRemoteProjectRevision(db, projectId, revision, request.binding.updatedAt);
  if (revisionError) return NextResponse.json(revisionError, { status: revisionError.error.code === 'REVISION_NOT_FOUND' ? 404 : revisionError.error.code === 'REVISION_CONFLICT' ? 409 : 400 });
  let catalog;
  try { catalog = await loadInstallerCoreCatalog(); } catch { return NextResponse.json({ ok: false, error: { code: 'CATALOG_UNAVAILABLE' } }, { status: 503 }); }
  const items: RemoteAgentInputItem[] = request.input.map(item => ({ role: item.role, content: item.content, ...(item.callId ? { call_id: item.callId } : {}), ...(item.name ? { name: item.name } : {}), ...(item.isError !== undefined ? { is_error: item.isError } : {}) }));
  const continuationId = typeof normalizedBody.continuationId === 'string' ? normalizedBody.continuationId : undefined;
  if (continuationId && request.idempotencyKey) return NextResponse.json({ ok: false, error: { code: 'INVALID_REQUEST' } }, { status: 400 });
  if (!continuationId && !request.idempotencyKey) return NextResponse.json({ ok: false, error: { code: 'INITIAL_TURN_IDEMPOTENCY_KEY_REQUIRED' } }, { status: 400 });
  const initialIdempotency = !continuationId && request.idempotencyKey
    ? { key: request.idempotencyKey, requestHash: hashRemoteInitialTurnRequest({ runId: request.runId, projectId, revision, updatedAt: request.binding.updatedAt, userId: auth.userId, provider: request.provider, model: request.model, instructions: request.instructions, items }) }
    : undefined;
  const result = await runRemoteAgentTurn({ db, userId: auth.userId, projectId, revision, provider: request.provider, model: request.model, instructions: request.instructions, items, catalog, initialIdempotency, priorProviderState: continuationId ? { handle: continuationId } : undefined, signal: req.signal });
  logAudit({ userId: auth.userId, action: result.ok ? 'cad.remote_agent_turn_completed' : 'cad.remote_agent_turn_failed', resourceId: projectId, ip: getTrustedClientIpOrUndefined(req.headers), metadata: { revision, provider: request.provider, resultCode: result.ok ? 'OK' : result.error.code } });
  if (!result.ok) {
    const status = result.error.code === 'INITIAL_TURN_IN_FLIGHT' || result.error.code === 'INITIAL_TURN_REQUEST_CONFLICT' || result.error.code === 'INITIAL_TURN_RECOVERY_REQUIRED' ? 409
      : result.error.code === 'INITIAL_TURN_IDEMPOTENCY_STORE_UNAVAILABLE' || result.error.code === 'PROVIDER_UNAVAILABLE' ? 503
        : result.error.code === 'REQUEST_CANCELLED' ? 499
        : result.error.code === 'INITIAL_TURN_IDEMPOTENCY_KEY_REQUIRED' || result.error.code === 'INITIAL_TURN_IDEMPOTENCY_KEY_INVALID' ? 400 : 422;
    return NextResponse.json(result, { status, headers: { 'Cache-Control': 'private, no-store', ...(result.error.code === 'INITIAL_TURN_IN_FLIGHT' ? { 'Retry-After': '1' } : {}) } });
  }
  const toolCalls = result.tool_calls.map(call => ({ callId: call.call_id, name: call.name, arguments: call.arguments, scope: catalog.find(tool => tool.name === call.name)?.scope ?? 'read' }));
  return NextResponse.json({ ok: true, contractVersion: REMOTE_PRECISION_CAD_CONTRACT_VERSION, runId: request.runId, binding: request.binding, assistantText: result.assistant_text, toolCalls, artifacts: [], continuationId: result.provider_state.handle, finishStatus: result.finish_status === 'tool_calls' ? 'tool_call' : 'completed', assistant_text: result.assistant_text, tool_calls: result.tool_calls, provider_state: result.provider_state, finish_status: result.finish_status }, { headers: { 'Cache-Control': 'private, no-store' } });
}
