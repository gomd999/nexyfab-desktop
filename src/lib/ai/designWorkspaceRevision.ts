import type { DesignDomainId, UserExperienceLevel } from './domainProfile';
import {
  applyArtifactSourceChanges,
  type ArtifactVerification,
  type DesignArtifactGraph,
} from './designArtifactGraph';

export const DESIGN_WORKSPACE_REVISION_SCHEMA = 'nexyfab.design-workspace-revision.v1' as const;

export type DesignWorkMode = 'ai_assisted' | 'manual' | 'precision_cad';
export type DesignEditActor = 'ai' | 'human' | 'expert' | 'authority';
export type DesignLockTargetKind =
  | 'workspace'
  | 'base_shape'
  | 'assembly'
  | 'occurrence'
  | 'feature'
  | 'parameter'
  | 'authoritative_input';

export interface DesignLockTarget {
  kind: DesignLockTargetKind;
  objectId: string;
  field?: string;
}

export interface DesignValueLock {
  id: string;
  target: DesignLockTarget;
  source: Exclude<DesignEditActor, 'ai'>;
  reason: string;
  valueHash: string;
  lockedAtRevision: number;
}

export interface DesignRevisionRecord {
  revision: number;
  actor: DesignEditActor;
  mode: DesignWorkMode;
  documentHash: string;
  changedTargets: DesignLockTarget[];
  retainedLockIds: string[];
}

export interface DesignWorkspaceRevision {
  schema: typeof DESIGN_WORKSPACE_REVISION_SCHEMA;
  projectId: string;
  lineageId: string;
  revision: number;
  domain: DesignDomainId;
  experience: UserExperienceLevel;
  workMode: DesignWorkMode;
  documentHash: string;
  locks: DesignValueLock[];
  history: DesignRevisionRecord[];
}

export interface WorkspaceRevisionCommit {
  baseRevision: number;
  actor: DesignEditActor;
  mode: DesignWorkMode;
  documentHash: string;
  changedTargets: DesignLockTarget[];
  addLocks?: Array<Omit<DesignValueLock, 'lockedAtRevision'>>;
  unlockIds?: string[];
}

export interface WorkspaceRevisionResult {
  committed: boolean;
  workspace: DesignWorkspaceRevision;
  blockedLockIds: string[];
  issues: string[];
}

export interface WorkspaceArtifactCommitResult extends WorkspaceRevisionResult {
  graph: DesignArtifactGraph;
  staleArtifactIds: string[];
  reviewArtifactIds: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const DOMAINS = new Set<DesignDomainId>(['mechanical', 'building', 'civil', 'landscape', 'interior']);
const MODES = new Set<DesignWorkMode>(['ai_assisted', 'manual', 'precision_cad']);

function targetKey(target: DesignLockTarget): string {
  return `${target.kind}:${target.objectId}:${target.field ?? ''}`;
}

/** A parent lock protects all child edits; a parameter lock protects one exact field. */
export function lockProtectsTarget(lock: DesignValueLock, changed: DesignLockTarget): boolean {
  if (lock.target.kind === 'workspace') return true;
  if (lock.target.kind === 'assembly') {
    return changed.kind === 'assembly' || changed.kind === 'occurrence';
  }
  if (lock.target.objectId !== changed.objectId) return false;
  if (lock.target.kind === 'feature') {
    return changed.kind === 'feature' || changed.kind === 'parameter';
  }
  if (lock.target.kind !== changed.kind) return false;
  return lock.target.field === undefined || lock.target.field === changed.field;
}

export function validateDesignWorkspaceRevision(workspace: DesignWorkspaceRevision): string[] {
  const issues: string[] = [];
  if (workspace.schema !== DESIGN_WORKSPACE_REVISION_SCHEMA
    || !workspace.projectId.trim()
    || !workspace.lineageId.trim()
    || !Number.isSafeInteger(workspace.revision)
    || workspace.revision < 0
    || !DOMAINS.has(workspace.domain)
    || !MODES.has(workspace.workMode)
    || (workspace.experience !== 'guided' && workspace.experience !== 'standard' && workspace.experience !== 'expert')
    || !SHA256.test(workspace.documentHash)) issues.push('invalid_workspace_header');

  const lockIds = new Set<string>();
  const lockTargets = new Set<string>();
  for (const lock of workspace.locks) {
    const key = targetKey(lock.target);
    if (!lock.id.trim() || lockIds.has(lock.id)) issues.push(`duplicate_or_empty_lock:${lock.id || '(empty)'}`);
    if (!lock.target.objectId.trim() || !lock.reason.trim() || !SHA256.test(lock.valueHash)
      || !Number.isSafeInteger(lock.lockedAtRevision) || lock.lockedAtRevision < 0
      || lock.lockedAtRevision > workspace.revision) issues.push(`invalid_lock:${lock.id}`);
    if (lockTargets.has(key)) issues.push(`duplicate_lock_target:${key}`);
    lockIds.add(lock.id);
    lockTargets.add(key);
  }

  let previous = -1;
  for (const record of workspace.history) {
    if (!Number.isSafeInteger(record.revision) || record.revision <= previous
      || record.revision > workspace.revision || !SHA256.test(record.documentHash)
      || !MODES.has(record.mode)) issues.push(`invalid_history_revision:${record.revision}`);
    previous = record.revision;
  }
  if (workspace.history.at(-1)?.revision !== workspace.revision) issues.push('history_head_mismatch');
  return [...new Set(issues)];
}

export function createDesignWorkspaceRevision(input: {
  projectId: string;
  lineageId: string;
  domain: DesignDomainId;
  experience?: UserExperienceLevel;
  workMode?: DesignWorkMode;
  documentHash: string;
}): DesignWorkspaceRevision {
  const workspace: DesignWorkspaceRevision = {
    schema: DESIGN_WORKSPACE_REVISION_SCHEMA,
    projectId: input.projectId,
    lineageId: input.lineageId,
    revision: 0,
    domain: input.domain,
    experience: input.experience ?? 'guided',
    workMode: input.workMode ?? 'ai_assisted',
    documentHash: input.documentHash,
    locks: [],
    history: [{
      revision: 0,
      actor: 'human',
      mode: input.workMode ?? 'ai_assisted',
      documentHash: input.documentHash,
      changedTargets: [],
      retainedLockIds: [],
    }],
  };
  const issues = validateDesignWorkspaceRevision(workspace);
  if (issues.length) throw new Error(issues.join(','));
  return workspace;
}

/** UI level/mode changes keep the exact project lineage and content revision. */
export function switchWorkspaceMode(
  workspace: DesignWorkspaceRevision,
  selection: { experience?: UserExperienceLevel; workMode?: DesignWorkMode },
): WorkspaceRevisionResult {
  const issues = validateDesignWorkspaceRevision(workspace);
  if (issues.length) return { committed: false, workspace, blockedLockIds: [], issues };
  const experience = selection.experience ?? workspace.experience;
  const workMode = selection.workMode ?? workspace.workMode;
  if ((experience !== 'guided' && experience !== 'standard' && experience !== 'expert') || !MODES.has(workMode)) {
    return { committed: false, workspace, blockedLockIds: [], issues: ['invalid_workspace_mode'] };
  }
  return {
    committed: true,
    workspace: { ...workspace, experience, workMode },
    blockedLockIds: [],
    issues: [],
  };
}

function failure(workspace: DesignWorkspaceRevision, issues: string[], blockedLockIds: string[] = []): WorkspaceRevisionResult {
  return { committed: false, workspace, blockedLockIds, issues };
}

export function commitDesignWorkspaceRevision(
  workspace: DesignWorkspaceRevision,
  change: WorkspaceRevisionCommit,
): WorkspaceRevisionResult {
  const workspaceIssues = validateDesignWorkspaceRevision(workspace);
  if (workspaceIssues.length) return failure(workspace, workspaceIssues);
  if (change.baseRevision !== workspace.revision) return failure(workspace, ['stale_workspace_revision']);
  if (!SHA256.test(change.documentHash) || !change.changedTargets.length
    || change.changedTargets.some(target => !target.objectId.trim())) return failure(workspace, ['invalid_workspace_change']);
  if (!MODES.has(change.mode)) return failure(workspace, ['invalid_workspace_mode']);

  const unlockIds = new Set(change.unlockIds ?? []);
  if (change.actor === 'ai' && unlockIds.size) return failure(workspace, ['ai_cannot_unlock']);
  if ([...unlockIds].some(id => !workspace.locks.some(lock => lock.id === id))) return failure(workspace, ['unknown_unlock']);
  const retainedLocks = workspace.locks.filter(lock => !unlockIds.has(lock.id));
  const blockers = change.actor === 'ai'
    ? retainedLocks.filter(lock => change.changedTargets.some(target => lockProtectsTarget(lock, target))).map(lock => lock.id).sort()
    : [];
  if (blockers.length) return failure(workspace, ['protected_user_or_authority_value'], blockers);

  const nextRevision = workspace.revision + 1;
  const nextLocks = [...retainedLocks];
  for (const candidate of change.addLocks ?? []) {
    if (change.actor === 'ai') return failure(workspace, ['ai_cannot_create_user_lock']);
    if (!candidate.id.trim() || !candidate.reason.trim() || !candidate.target.objectId.trim()
      || !SHA256.test(candidate.valueHash)) return failure(workspace, [`invalid_new_lock:${candidate.id || '(empty)'}`]);
    if (nextLocks.some(lock => lock.id === candidate.id || targetKey(lock.target) === targetKey(candidate.target))) {
      return failure(workspace, [`duplicate_new_lock:${candidate.id}`]);
    }
    nextLocks.push({ ...candidate, lockedAtRevision: nextRevision });
  }

  const candidate: DesignWorkspaceRevision = {
    ...workspace,
    revision: nextRevision,
    workMode: change.mode,
    documentHash: change.documentHash,
    locks: nextLocks,
    history: [...workspace.history, {
      revision: nextRevision,
      actor: change.actor,
      mode: change.mode,
      documentHash: change.documentHash,
      changedTargets: structuredClone(change.changedTargets),
      retainedLockIds: nextLocks.map(lock => lock.id).sort(),
    }],
  };
  const candidateIssues = validateDesignWorkspaceRevision(candidate);
  return candidateIssues.length ? failure(workspace, candidateIssues) : {
    committed: true,
    workspace: candidate,
    blockedLockIds: [],
    issues: [],
  };
}

/** Commits the shared model revision and invalidates all dependent artifacts atomically. */
export function commitWorkspaceAndArtifactModelChange(
  workspace: DesignWorkspaceRevision,
  graph: DesignArtifactGraph,
  change: WorkspaceRevisionCommit & {
    modelArtifactId: string;
    modelExpectedRevision: number;
    modelContentHash: string;
    modelVerification: ArtifactVerification;
  },
): WorkspaceArtifactCommitResult {
  if (workspace.projectId !== graph.projectId) {
    return { ...failure(workspace, ['workspace_artifact_project_mismatch']), graph, staleArtifactIds: [], reviewArtifactIds: [] };
  }
  const workspaceResult = commitDesignWorkspaceRevision(workspace, change);
  if (!workspaceResult.committed) return { ...workspaceResult, graph, staleArtifactIds: [], reviewArtifactIds: [] };
  const graphResult = applyArtifactSourceChanges(graph, graph.revision, [{
    artifactId: change.modelArtifactId,
    expectedRevision: change.modelExpectedRevision,
    contentHash: change.modelContentHash,
    verification: change.modelVerification,
  }]);
  if (!graphResult.committed) {
    return { ...failure(workspace, graphResult.issues), graph, staleArtifactIds: [], reviewArtifactIds: [] };
  }
  return {
    committed: true,
    workspace: workspaceResult.workspace,
    graph: graphResult.graph,
    blockedLockIds: [],
    staleArtifactIds: graphResult.staleArtifactIds,
    reviewArtifactIds: graphResult.reviewArtifactIds,
    issues: [],
  };
}
