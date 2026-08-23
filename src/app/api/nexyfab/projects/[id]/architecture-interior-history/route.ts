import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { makeRemoteApprovalToken } from '@/lib/precision-cad-agent/remoteApprovalToken';
import {
  ensureArchitectureInteriorHistoryTables,
  readArchitectureInteriorHistory,
  appendArchitectureInteriorHistoryEventInTransaction,
  type ArchitectureInteriorHistoryEvent,
} from '@/lib/ai/architectureInteriorHistoryStore';
import {
  ensureArchitectureInteriorWorkspaceTables,
  persistArchitectureInteriorWorkspace,
  readArchitectureInteriorWorkspace,
} from '@/lib/ai/architectureInteriorWorkspaceStore';
import { hashArchitectureInteriorEvidenceV2, hashArchitectureInteriorWorkspaceV2, validateArchitectureInteriorWorkspaceV2, type ArchitectureInteriorWorkspaceV2 } from '@/lib/ai/architectureInteriorWorkspace';
import { readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type RouteParams = { params: Promise<{ id: string }> };
type Action = 'undo' | 'redo';
type ErrorCode = 'AUTHENTICATION_REQUIRED' | 'PROJECT_NOT_FOUND' | 'ORIGIN_REJECTED' | 'BAD_REQUEST' | 'WORKSPACE_NOT_FOUND' | 'WORKSPACE_CORRUPT' | 'EDITOR_REQUIRED' | 'APPROVAL_REQUIRED' | 'APPROVAL_INVALID' | 'REVISION_CONFLICT' | 'HISTORY_EMPTY' | 'HISTORY_DIVERGED' | 'HISTORY_CORRUPT' | 'TARGET_NOT_FOUND' | 'HISTORY_RECORD_FAILED' | 'INTERNAL_ERROR';
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_BODY_BYTES = 8 * 1024;

function fail(code: ErrorCode, status: number, extra: Record<string, unknown> = {}): NextResponse { return NextResponse.json({ ok: false, code, ...extra }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function validHash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function clone<T>(value: T): T { return structuredClone(value); }
function historyMatchesHead(history: Awaited<ReturnType<typeof readArchitectureInteriorHistory>>, workspace: ArchitectureInteriorWorkspaceV2): boolean {
  const latest = history.events.at(-1);
  return !latest || (latest.targetRevision === workspace.workspace.revision && latest.targetContentHash === workspace.contentHash);
}

async function loadContext(req: NextRequest, projectId: string) {
  const auth = await getAuthUser(req);
  if (!auth) return { error: fail('AUTHENTICATION_REQUIRED', 401) } as const;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return { error: fail('PROJECT_NOT_FOUND', 404) } as const;
  const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId);
  try {
    await ensureArchitectureInteriorWorkspaceTables(db);
    await ensureArchitectureInteriorHistoryTables(db);
  } catch { return { error: fail('INTERNAL_ERROR', 500) } as const; }
  const stored = await readArchitectureInteriorWorkspace(db, { tenantId }, projectId);
  if (!stored.ok) return { error: fail(stored.code === 'NOT_FOUND' ? 'WORKSPACE_NOT_FOUND' : 'WORKSPACE_CORRUPT', stored.code === 'NOT_FOUND' ? 404 : 409) } as const;
  return { auth, access, db, tenantId, stored } as const;
}

function rebaseWorkspace(source: ArchitectureInteriorWorkspaceV2, revision: number, commandId: string): ArchitectureInteriorWorkspaceV2 | null {
  const result = clone(source);
  result.workspace.revision = revision;
  result.architecture.document.revision = revision;
  result.interior.document.revision = revision;
  result.artifactGraph.revision = revision;
  result.artifactGraph.artifacts = result.artifactGraph.artifacts.map(artifact => ({
    ...artifact, state: 'stale' as const,
    verification: { ...artifact.verification, status: 'not_run' as const, evidenceHash: undefined, issues: ['edit_history_changed'] },
    staleBecause: [...new Set([...artifact.staleBecause, commandId])],
  }));
  for (const domain of [result.architecture, result.interior]) {
    if (isRecord(domain.geometry.payload)) {
      domain.geometry.payload = { ...domain.geometry.payload, revision };
      domain.geometry.contentHash = hashArchitectureInteriorEvidenceV2(domain.geometry.payload);
    }
    if (isRecord(domain.semantic.payload)) {
      const payload = clone(domain.semantic.payload);
      if (isRecord(payload.document)) payload.document = { ...payload.document, revision };
      domain.semantic.payload = payload;
      domain.semantic.contentHash = hashArchitectureInteriorEvidenceV2(payload);
    }
  }
  result.contentHash = '';
  result.workspace.contentHash = '';
  try {
    const contentHash = hashArchitectureInteriorWorkspaceV2(result);
    result.contentHash = contentHash;
    result.workspace.contentHash = contentHash;
    return contentHash === result.workspace.contentHash && validateArchitectureInteriorWorkspaceV2(result).length === 0 ? result : null;
  } catch { return null; }
}

function parseBody(value: unknown): { action: Action; expectedRevision: number; expectedContentHash: string; approved: boolean; receiptHash?: string } | null {
  if (!isRecord(value) || (value.action !== 'undo' && value.action !== 'redo') || typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || !validHash(value.expectedContentHash)) return null;
  if (value.approved !== undefined && typeof value.approved !== 'boolean') return null;
  if (value.receiptHash !== undefined && (typeof value.receiptHash !== 'string' || !TOKEN.test(value.receiptHash))) return null;
  return { action: value.action, expectedRevision: value.expectedRevision, expectedContentHash: value.expectedContentHash, approved: value.approved === true, ...(value.receiptHash ? { receiptHash: value.receiptHash } : {}) };
}

function approvalToken(input: { userId: string; projectId: string; revision: number; action: Action; contentHash: string }): string | null {
  return makeRemoteApprovalToken({ userId: input.userId, projectId: input.projectId, revision: input.revision, tool: `architecture-interior-history.${input.action}`, arguments: { expectedRevision: input.revision, expectedContentHash: input.contentHash, action: input.action } });
}

function sourceForAction(action: Action, state: Awaited<ReturnType<typeof readArchitectureInteriorHistory>>): { source: ArchitectureInteriorHistoryEvent; sourceSequence?: number } | null {
  if (action === 'undo' && state.undo) return { source: state.undo };
  if (action === 'redo' && state.redo) {
    const undo = state.events.at(-1);
    if (undo?.operation !== 'undo' || undo.sourceSequence !== state.redo.sequence) return null;
    return { source: state.redo, sourceSequence: undo.sequence };
  }
  return null;
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id: projectId } = await params;
  const context = await loadContext(req, projectId);
  if ('error' in context) return context.error ?? fail('INTERNAL_ERROR', 500);
  try {
    const history = await readArchitectureInteriorHistory(context.db, { tenantId: context.tenantId, projectId });
    const aligned = historyMatchesHead(history, context.stored.workspace);
    return NextResponse.json({ ok: true, schema: 'nexyfab.architecture-interior-history.v1', projectId, revision: context.stored.workspace.workspace.revision, contentHash: context.stored.workspace.contentHash, canUndo: aligned && Boolean(history.undo), canRedo: aligned && Boolean(history.redo), undo: aligned && history.undo ? { sequence: history.undo.sequence, commandId: history.undo.commandId } : null, redo: aligned && history.redo ? { sequence: history.redo.sequence, commandId: history.redo.commandId } : null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return fail('HISTORY_CORRUPT', 409); }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  if (!checkOrigin(req)) return fail('ORIGIN_REJECTED', 403);
  const { id: projectId } = await params;
  const context = await loadContext(req, projectId);
  if ('error' in context) return context.error ?? fail('INTERNAL_ERROR', 500);
  if (!context.access.canEdit) return fail('EDITOR_REQUIRED', 403);
  let body: unknown;
  try { body = await readBoundedJson<unknown>(req, MAX_BODY_BYTES); } catch { return fail('BAD_REQUEST', 400); }
  const parsed = parseBody(body);
  if (!parsed) return fail('BAD_REQUEST', 400);
  const current = context.stored.workspace;
  if (parsed.expectedRevision !== current.workspace.revision || parsed.expectedContentHash !== current.contentHash) return fail('REVISION_CONFLICT', 409, { currentRevision: current.workspace.revision, currentContentHash: current.contentHash });
  let history;
  try { history = await readArchitectureInteriorHistory(context.db, { tenantId: context.tenantId, projectId }); } catch { return fail('HISTORY_CORRUPT', 409); }
  if (!historyMatchesHead(history, current)) return fail('HISTORY_DIVERGED', 409);
  const target = sourceForAction(parsed.action, history);
  if (!target) return fail('HISTORY_EMPTY', 409);
  const token = approvalToken({ userId: context.auth.userId, projectId, revision: current.workspace.revision, action: parsed.action, contentHash: current.contentHash });
  if (!token) return fail('INTERNAL_ERROR', 500);
  if (!parsed.approved) return fail('APPROVAL_REQUIRED', 409, { approval: { receiptHash: token } });
  const provided = Buffer.from(parsed.receiptHash ?? ''); const expected = Buffer.from(token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return fail('APPROVAL_INVALID', 409);
  const targetRevision = parsed.action === 'undo' ? target.source.sourceRevision : target.source.targetRevision;
  const targetHash = parsed.action === 'undo' ? target.source.sourceContentHash : target.source.targetContentHash;
  const storedTarget = await readArchitectureInteriorWorkspace(context.db, { tenantId: context.tenantId }, projectId, targetRevision);
  if (!storedTarget.ok || storedTarget.workspace.contentHash !== targetHash) return fail('TARGET_NOT_FOUND', 409);
  const commandId = `${target.source.commandId}:${parsed.action}:${current.workspace.revision + 1}`;
  const rebased = rebaseWorkspace(storedTarget.workspace, current.workspace.revision + 1, commandId);
  if (!rebased) return fail('HISTORY_CORRUPT', 409);
  let saved: Awaited<ReturnType<typeof persistArchitectureInteriorWorkspace>>;
  try {
    const committed = await context.db.transaction(async tx => {
      const workspaceResult = await persistArchitectureInteriorWorkspace(context.db, { tenantId: context.tenantId, userId: context.auth.userId }, projectId, current.workspace.revision, rebased, { baseContentHash: current.contentHash, transactionalAdapter: tx });
      if (!workspaceResult.ok) return { saved: workspaceResult };
      const historyEvent = await appendArchitectureInteriorHistoryEventInTransaction(tx, { tenantId: context.tenantId, projectId }, { operation: parsed.action, lineageId: target.source.lineageId, sourceSequence: target.sourceSequence ?? target.source.sequence, actorUserId: context.auth.userId, commandId, sourceRevision: current.workspace.revision, sourceContentHash: current.contentHash, targetRevision: workspaceResult.workspace.workspace.revision, targetContentHash: workspaceResult.workspace.contentHash });
      return { saved: workspaceResult, event: historyEvent };
    });
    saved = committed.saved;
    if (!saved.ok) return saved.code === 'REVISION_CONFLICT' ? fail('REVISION_CONFLICT', 409, saved) : fail('HISTORY_CORRUPT', 409);
    if (!('event' in committed) || !committed.event) return fail('HISTORY_RECORD_FAILED', 503);
    const event = committed.event;
    return NextResponse.json({ ok: true, action: parsed.action, workspace: saved.workspace, persistence: { revisionId: saved.revisionId, revision: saved.workspace.workspace.revision, contentHash: saved.workspace.contentHash }, event }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return fail('HISTORY_RECORD_FAILED', 503); }
}
