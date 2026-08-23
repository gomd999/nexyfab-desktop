import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  verifyArchitectureInteriorRecoveryEvidence,
  ARCHITECTURE_INTERIOR_RECOVERY_MAX_OBSERVATION_BODY_BYTES,
  type ArchitectureInteriorRecoveryEvidence,
  type RecoveryRawObservation,
  type RecoveryRelease,
} from './architecture-interior-recovery-evidence';
import { writeArchitectureInteriorRecoveryEvidence } from './architecture-interior-recovery-evidence.mjs';

const now = Date.parse('2026-08-23T12:00:00.000Z');
const target = 'https://staging.nexyfab.com';
const release: RecoveryRelease = {
  buildId: 'build-recovery-v2',
  productionDeploymentId: 'prod-recovery-v2',
  evidenceDeploymentId: 'staging-recovery-v2',
  gitHead: 'b'.repeat(40),
};
const roots: string[] = [];

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function raw(id: RecoveryRawObservation['id'], method: string, pathname: string, httpStatus: number, body: unknown): RecoveryRawObservation {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  return {
    id,
    request: { method, pathname },
    httpStatus,
    contentType: 'application/json; charset=utf-8',
    bodyBytes: bytes.byteLength,
    bodySha256: sha(bytes),
    bodyBase64: bytes.toString('base64'),
  };
}

function workspace(revision: number, contentHash: string, heightMm: number) {
  return {
    workspace: { revision },
    contentHash,
    architecture: {
      documentId: 'architecture-document-1',
      document: { walls: [{ id: 'wall-1', heightMm, widthMm: 200 }] },
    },
    interior: {
      documentId: 'interior-document-1',
      document: { furniture: [{ id: 'desk-1', widthMm: 1200 }] },
    },
  };
}

function fixtureObservations(): RecoveryRawObservation[] {
  const projectId = 'project-recovery-1';
  const projectPath = `/api/nexyfab/projects/${projectId}`;
  const agentPath = `${projectPath}/architecture-interior-agent`;
  const historyPath = `${projectPath}/architecture-interior-history`;
  const initial = workspace(10, '1'.repeat(64), 3000);
  const applied = workspace(11, '2'.repeat(64), 3050);
  const undone = workspace(12, '3'.repeat(64), 3000);
  const redone = workspace(13, '4'.repeat(64), 3050);
  return [
    raw('owner_login', 'POST', '/api/auth/login', 200, { ok: true }),
    raw('project_create', 'POST', '/api/nexyfab/projects', 201, { project: { id: projectId } }),
    raw('workspace_initialized', 'GET', agentPath, 200, { session: { role: 'owner' }, workspace: initial }),
    raw('apply_edit', 'POST', agentPath, 200, { ok: true, workspace: applied }),
    raw('undo', 'POST', historyPath, 200, { ok: true, workspace: undone }),
    raw('reconnect_before_reload', 'GET', agentPath, 200, { session: { role: 'owner' }, workspace: undone }),
    raw('reconnect_after_reload', 'GET', agentPath, 200, { session: { role: 'owner' }, workspace: undone }),
    raw('redo', 'POST', historyPath, 200, { ok: true, workspace: redone }),
    raw('viewer_agent_denied', 'POST', agentPath, 403, { ok: false, code: 'EDITOR_REQUIRED' }),
    raw('viewer_history_denied', 'POST', historyPath, 403, { ok: false, code: 'EDITOR_REQUIRED' }),
    raw('project_cleanup', 'DELETE', projectPath, 200, { ok: true }),
    raw('project_cleanup_confirm', 'GET', projectPath, 404, { ok: false, code: 'PROJECT_NOT_FOUND' }),
  ];
}

function fixture(): { root: string; receipt: ArchitectureInteriorRecoveryEvidence } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-recovery-evidence-v2-'));
  roots.push(root);
  const receipt = writeArchitectureInteriorRecoveryEvidence({
    root,
    artifactPath: 'evidence/recovery.json',
    generatedAt: new Date(now).toISOString(),
    target,
    release,
    projectId: 'project-recovery-1',
    editedObjectId: 'wall-1',
    observations: fixtureObservations(),
    now,
  }) as ArchitectureInteriorRecoveryEvidence;
  return { root, receipt };
}

function rehashReceipt(receipt: ArchitectureInteriorRecoveryEvidence): void {
  const unsigned = { ...receipt } as Partial<ArchitectureInteriorRecoveryEvidence>;
  delete unsigned.sha256;
  receipt.sha256 = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
}

function rewriteObservation(root: string, receipt: ArchitectureInteriorRecoveryEvidence, index: number, body: unknown): void {
  const sourcePath = path.join(root, receipt.sourceBindings[0]!.path);
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as { observations: RecoveryRawObservation[] };
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  source.observations[index] = {
    ...source.observations[index]!,
    bodyBytes: bytes.byteLength,
    bodySha256: sha(bytes),
    bodyBase64: bytes.toString('base64'),
  };
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`, 'utf8');
  fs.writeFileSync(sourcePath, sourceBytes);
  receipt.sourceBindings[0] = { ...receipt.sourceBindings[0]!, bytes: sourceBytes.byteLength, sha256: sha(sourceBytes) };
  receipt.observations[index] = {
    ...receipt.observations[index]!,
    bodyBytes: bytes.byteLength,
    bodySha256: sha(bytes),
  };
  rehashReceipt(receipt);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('architecture/interior recovery evidence v2', () => {
  it('verifies exact source bytes, freshness, release identity, and recovery semantics', () => {
    const { root, receipt } = fixture();
    expect(verifyArchitectureInteriorRecoveryEvidence(receipt, release, { root, now })).toBe(true);
    expect(verifyArchitectureInteriorRecoveryEvidence(receipt, { ...release, evidenceDeploymentId: 'other-staging' }, { root, now })).toBe(false);
    expect(verifyArchitectureInteriorRecoveryEvidence(receipt, release, { root, now: now + 25 * 60 * 60_000 })).toBe(false);
    fs.appendFileSync(path.join(root, receipt.sourceBindings[0]!.path), 'tamper');
    expect(verifyArchitectureInteriorRecoveryEvidence(receipt, release, { root, now })).toBe(false);
  });

  it('rejects a rehashed viewer denial whose exact response code is not EDITOR_REQUIRED', () => {
    const { root, receipt } = fixture();
    rewriteObservation(root, receipt, 8, { ok: false, code: 'FORGED_DENIAL' });
    expect(verifyArchitectureInteriorRecoveryEvidence(receipt, release, { root, now })).toBe(false);
  });

  it('rejects a rehashed redo body that does not reproduce the applied edited value', () => {
    const { root, receipt } = fixture();
    rewriteObservation(root, receipt, 7, { ok: true, workspace: workspace(13, '4'.repeat(64), 3060) });
    expect(verifyArchitectureInteriorRecoveryEvidence(receipt, release, { root, now })).toBe(false);
  });

  it('refuses to build PASS evidence without an exact reconnect or DELETE 200 -> GET 404 cleanup', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-recovery-evidence-v2-'));
    roots.push(root);
    const base = {
      root,
      artifactPath: 'evidence/recovery.json',
      generatedAt: new Date(now).toISOString(),
      target,
      release,
      projectId: 'project-recovery-1',
      editedObjectId: 'wall-1',
      now,
    };
    const reconnectMismatch = fixtureObservations();
    reconnectMismatch[5] = raw(
      'reconnect_before_reload',
      'GET',
      '/api/nexyfab/projects/project-recovery-1/architecture-interior-agent',
      200,
      { session: { role: 'owner' }, workspace: workspace(12, '3'.repeat(64), 3010) },
    );
    expect(() => writeArchitectureInteriorRecoveryEvidence({ ...base, observations: reconnectMismatch })).toThrow(/exact undone snapshot/);
    const incompleteCleanup = fixtureObservations();
    incompleteCleanup[10] = raw('project_cleanup', 'DELETE', '/api/nexyfab/projects/project-recovery-1', 404, { code: 'PROJECT_NOT_FOUND' });
    expect(() => writeArchitectureInteriorRecoveryEvidence({ ...base, observations: incompleteCleanup })).toThrow(/project_cleanup/);
  });

  it('requires isolated staging and a repository-contained output path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-recovery-evidence-v2-'));
    roots.push(root);
    const input = {
      root,
      artifactPath: 'evidence/recovery.json',
      generatedAt: new Date(now).toISOString(),
      release,
      projectId: 'project-recovery-1',
      editedObjectId: 'wall-1',
      observations: fixtureObservations(),
      now,
    };
    expect(() => writeArchitectureInteriorRecoveryEvidence({ ...input, target: 'https://nexyfab.com' })).toThrow(/isolated HTTPS staging/);
    expect(() => writeArchitectureInteriorRecoveryEvidence({ ...input, target, artifactPath: '../escape.json' })).toThrow(/inside the repository root/);
  });

  it('rejects oversized raw response bodies before base64 decoding or semantic derivation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-recovery-evidence-v2-'));
    roots.push(root);
    const observations = fixtureObservations();
    observations[0] = raw('owner_login', 'POST', '/api/auth/login', 200, {
      payload: 'x'.repeat(ARCHITECTURE_INTERIOR_RECOVERY_MAX_OBSERVATION_BODY_BYTES + 1),
    });
    expect(() => writeArchitectureInteriorRecoveryEvidence({
      root,
      artifactPath: 'evidence/recovery.json',
      generatedAt: new Date(now).toISOString(),
      target,
      release,
      projectId: 'project-recovery-1',
      editedObjectId: 'wall-1',
      observations,
      now,
    })).toThrow(/invalid recovery observation/);
  });
});
