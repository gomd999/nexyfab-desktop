import path from 'node:path';
import {
  ARCHITECTURE_INTERIOR_RECOVERY_CHECKS as checks,
  ARCHITECTURE_INTERIOR_RECOVERY_MAX_AGE_MS,
  ARCHITECTURE_INTERIOR_RECOVERY_MAX_OBSERVATION_BODY_BYTES,
  ARCHITECTURE_INTERIOR_RECOVERY_MAX_SOURCE_BYTES,
  ARCHITECTURE_INTERIOR_RECOVERY_SCHEMA,
  ARCHITECTURE_INTERIOR_RECOVERY_SOURCE_SCHEMA,
  assertObjectIdentity as assertIdentity,
  buildArchitectureInteriorRecoveryEvidence as buildEvidence,
  clearArchitectureInteriorRecoveryEvidence as clearEvidence,
  verifyArchitectureInteriorRecoveryEvidence as verifyEvidence,
  workspaceSnapshot as snapshot,
  writeArchitectureInteriorRecoveryEvidence as writeEvidence,
} from './architecture-interior-recovery-evidence.mjs';

export {
  ARCHITECTURE_INTERIOR_RECOVERY_MAX_AGE_MS,
  ARCHITECTURE_INTERIOR_RECOVERY_MAX_OBSERVATION_BODY_BYTES,
  ARCHITECTURE_INTERIOR_RECOVERY_MAX_SOURCE_BYTES,
  ARCHITECTURE_INTERIOR_RECOVERY_SCHEMA,
  ARCHITECTURE_INTERIOR_RECOVERY_SOURCE_SCHEMA,
};

export const ARCHITECTURE_INTERIOR_RECOVERY_CHECKS = checks as readonly RecoveryObservationId[];
export type RecoveryObservationId =
  | 'owner_login'
  | 'project_create'
  | 'workspace_initialized'
  | 'apply_edit'
  | 'undo'
  | 'reconnect_before_reload'
  | 'reconnect_after_reload'
  | 'redo'
  | 'viewer_agent_denied'
  | 'viewer_history_denied'
  | 'project_cleanup'
  | 'project_cleanup_confirm';

export type RecoveryRawObservation = {
  id: RecoveryObservationId;
  request: { method: string; pathname: string };
  httpStatus: number;
  contentType: string;
  bodyBytes: number;
  bodySha256: string;
  bodyBase64: string;
};

export type RecoveryRelease = {
  buildId: string;
  productionDeploymentId: string;
  evidenceDeploymentId: string;
  gitHead: string;
};

export type WorkspaceSnapshot = {
  revision: number;
  contentHash: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  objectIds: string[];
  editedObjectId: string;
  editedObjectValue: unknown;
};

export type ArchitectureInteriorRecoveryEvidence = {
  schema: typeof ARCHITECTURE_INTERIOR_RECOVERY_SCHEMA;
  generatedAt: string;
  ok: true;
  environment: 'staging';
  target: string;
  release: RecoveryRelease;
  projectId: string;
  editedObjectId: string;
  observations: Array<Omit<RecoveryRawObservation, 'bodyBase64'>>;
  snapshots: {
    initial: WorkspaceSnapshot;
    applied: WorkspaceSnapshot;
    undone: WorkspaceSnapshot;
    reconnectBeforeReload: WorkspaceSnapshot;
    reconnectAfterReload: WorkspaceSnapshot;
    redone: WorkspaceSnapshot;
  };
  viewerDenial: {
    agent: { status: 403; code: 'EDITOR_REQUIRED' };
    history: { status: 403; code: 'EDITOR_REQUIRED' };
  };
  cleanup: { deleteStatus: 200; confirmGetStatus: 404 };
  sourceBindings: Array<{ path: string; bytes: number; sha256: string }>;
  freshness: { generatedAt: string; maxAgeMs: number };
  requiredChecks: RecoveryObservationId[];
  checks: RecoveryObservationId[];
  transientProjectRetained: false;
  credentialsPersisted: false;
  sha256: string;
};

export function workspaceSnapshot(workspace: unknown, editedObjectId: string): WorkspaceSnapshot {
  return snapshot(workspace, editedObjectId) as WorkspaceSnapshot;
}

export function assertObjectIdentity(before: WorkspaceSnapshot, after: WorkspaceSnapshot): void {
  assertIdentity(before, after);
}

export function buildArchitectureInteriorRecoveryEvidence(input: {
  generatedAt?: string;
  target: string;
  release: RecoveryRelease;
  projectId: string;
  editedObjectId: string;
  observations: RecoveryRawObservation[];
  sourceBinding: { path: string; bytes: number; sha256: string };
  now?: number;
}): ArchitectureInteriorRecoveryEvidence {
  return buildEvidence(input) as ArchitectureInteriorRecoveryEvidence;
}

export function verifyArchitectureInteriorRecoveryEvidence(
  receipt: unknown,
  expectedRelease: RecoveryRelease,
  options: { root?: string; now?: number } = {},
): boolean {
  return verifyEvidence(receipt, expectedRelease, options);
}

function releaseIdentity(): RecoveryRelease {
  return {
    buildId: process.env.NEXYFAB_E2E_BUILD_ID?.trim() ?? '',
    productionDeploymentId: process.env.NEXYFAB_E2E_PRODUCTION_DEPLOYMENT_ID?.trim() ?? '',
    evidenceDeploymentId: process.env.NEXYFAB_E2E_DEPLOYMENT_ID?.trim() ?? '',
    gitHead: process.env.NEXYFAB_E2E_GIT_HEAD?.trim() ?? '',
  };
}

function configuredArtifactPath(root = process.cwd()): string | null {
  const configured = process.env.ARCHITECTURE_INTERIOR_RECOVERY_EVIDENCE?.trim();
  if (!configured) return null;
  return path.relative(path.resolve(root), path.resolve(configured)).replaceAll('\\', '/');
}

export function clearConfiguredArchitectureInteriorRecoveryEvidence(root = process.cwd()): void {
  const artifactPath = configuredArtifactPath(root);
  if (artifactPath) clearEvidence({ root, artifactPath });
}

export function writeArchitectureInteriorRecoveryEvidence(input: {
  target: string;
  projectId: string;
  editedObjectId: string;
  observations: RecoveryRawObservation[];
}, root = process.cwd()): ArchitectureInteriorRecoveryEvidence | null {
  const artifactPath = configuredArtifactPath(root);
  if (!artifactPath) return null;
  return writeEvidence({ root, artifactPath, release: releaseIdentity(), ...input }) as ArchitectureInteriorRecoveryEvidence;
}
