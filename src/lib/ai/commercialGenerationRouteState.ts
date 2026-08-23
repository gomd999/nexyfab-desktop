import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import { resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { resolveRequestOrgContext, resourceBelongsToOrgContext } from '@/lib/org-context';
import { readAuthoritativeWorkspaceHead } from '@/lib/cad/workspaceRevisionStore';
import { serverEvidenceSha256 } from './serverEvidence';
import { createGenerationRun, type GenerationRunState } from './generationRunState';
import { buildCommercialGenerationRunBinding, UNBOUND_GENERATION_PROGRAM_SHA256, type CommercialGenerationRunBinding } from './commercialGenerationRunBinding';
import { createDbCommercialGenerationStateStore, type CommercialGenerationStateStore } from './commercialGenerationStateStore';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface CommercialGenerationRouteContext {
  db: DbAdapter;
  store: CommercialGenerationStateStore;
  tenantId: string;
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
  workspaceContentHash: string;
  actorId: string;
}

export interface LoadedCommercialGenerationRun extends CommercialGenerationRouteContext {
  state: GenerationRunState;
  binding: CommercialGenerationRunBinding;
}

export async function resolveCommercialGenerationRouteContext(request: NextRequest, projectId: string): Promise<CommercialGenerationRouteContext> {
  if (!ID.test(projectId)) throw new Error('COMMERCIAL_PROJECT_ID_REQUIRED');
  const auth = await getAuthUser(request);
  if (!auth) throw new Error('AUTHENTICATED_EDITOR_REQUIRED');
  const db = getDbAdapter();
  if (db.backend !== 'postgres') throw new Error('COMMERCIAL_GENERATION_POSTGRES_REQUIRED');
  const org = resolveRequestOrgContext(auth);
  if (!org.ok) throw new Error('PROJECT_EDITOR_REQUIRED');
  const project = await db.queryOne<Record<string, unknown>>('SELECT id, user_id, org_id FROM nf_projects WHERE id = ?', projectId);
  if (!project || !resourceBelongsToOrgContext(project.org_id, org)) throw new Error('PROJECT_EDITOR_REQUIRED');
  const ownerUserId = String(project.user_id ?? '');
  let canEdit = ownerUserId === auth.userId;
  if (!canEdit) {
    const member = await db.queryOne<{ role: string }>('SELECT role FROM nf_project_members WHERE project_id = ? AND user_id = ?', projectId, auth.userId);
    canEdit = member?.role === 'editor';
  }
  if (!canEdit) throw new Error('PROJECT_EDITOR_REQUIRED');
  const head = await readAuthoritativeWorkspaceHead(db, projectId);
  if (!head || !Number.isSafeInteger(head.revision) || head.revision < 0 || !SHA256.test(head.contentHash)) throw new Error('AUTHORITATIVE_WORKSPACE_HEAD_REQUIRED');
  return { db, store: createDbCommercialGenerationStateStore(db), tenantId: resolveArtifactTenantId(project.org_id, ownerUserId), projectId, workspaceId: projectId, workspaceRevision: head.revision, workspaceContentHash: head.contentHash, actorId: auth.userId };
}

export async function createCommercialGenerationRouteRun(context: CommercialGenerationRouteContext): Promise<LoadedCommercialGenerationRun> {
  const state = createGenerationRun(`gen-${randomUUID()}`, context.projectId);
  const binding = buildCommercialGenerationRunBinding({ tenantId: context.tenantId, projectId: context.projectId, workspaceId: context.workspaceId, workspaceRevision: context.workspaceRevision, runId: state.runId, revision: state.revision, previousRevision: -1, previousHeadSha256: UNBOUND_GENERATION_PROGRAM_SHA256, previousStateSha256: UNBOUND_GENERATION_PROGRAM_SHA256, workspaceHeadSha256: context.workspaceContentHash, stateSha256: serverEvidenceSha256(state), programSha256: UNBOUND_GENERATION_PROGRAM_SHA256 });
  const created = await context.store.create(binding, state);
  if (!created.ok) throw new Error(created.code);
  return { ...context, state, binding };
}

export async function loadCommercialGenerationRouteRun(request: NextRequest, projectId: string, runId: string, expectedRevision?: number): Promise<LoadedCommercialGenerationRun> {
  if (!ID.test(runId) || (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))) throw new Error('COMMERCIAL_GENERATION_REFERENCE_INVALID');
  const context = await resolveCommercialGenerationRouteContext(request, projectId);
  const loaded = await context.store.load(context.tenantId, projectId, runId);
  if (!loaded) throw new Error('GENERATION_RUN_NOT_FOUND');
  if (loaded.binding.workspaceId !== context.workspaceId || loaded.binding.workspaceHeadSha256 !== context.workspaceContentHash || (expectedRevision !== undefined && loaded.state.revision !== expectedRevision)) throw new Error('GENERATION_REVISION_CONFLICT');
  return { ...context, ...loaded };
}

export async function saveCommercialGenerationRouteRun(current: LoadedCommercialGenerationRun, next: GenerationRunState): Promise<LoadedCommercialGenerationRun> {
  const stateProgram = next.evidenceBindings?.programSha256 ?? UNBOUND_GENERATION_PROGRAM_SHA256;
  const previousProgram = current.binding.generationProgramSha256;
  if (previousProgram !== UNBOUND_GENERATION_PROGRAM_SHA256 && previousProgram !== stateProgram) throw new Error('GENERATION_PROGRAM_BINDING_MISMATCH');
  const generationProgramSha256 = previousProgram === UNBOUND_GENERATION_PROGRAM_SHA256 ? stateProgram : previousProgram;
  const binding = buildCommercialGenerationRunBinding({ tenantId: current.tenantId, projectId: current.projectId, workspaceId: current.workspaceId, workspaceRevision: current.workspaceRevision, runId: next.runId, revision: next.revision, previousRevision: current.state.revision, previousHeadSha256: current.workspaceContentHash, previousStateSha256: serverEvidenceSha256(current.state), workspaceHeadSha256: current.workspaceContentHash, stateSha256: serverEvidenceSha256(next), programSha256: generationProgramSha256 });
  const saved = await current.store.save(binding, next, current.state.revision);
  if (!saved.ok) throw new Error(saved.code);
  return { ...current, state: next, binding };
}

export function isBoundGenerationProgramSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value) && value !== UNBOUND_GENERATION_PROGRAM_SHA256;
}
