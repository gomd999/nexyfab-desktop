import fs from 'node:fs';
import path from 'node:path';
import { expect, request as requestFactory, test, type APIRequestContext } from '@playwright/test';
import { assertStagingMutationSafety } from './helpers/staging-safety';

type Account = { email: string; password: string };
type CheckStatus = 'passed' | 'failed' | 'not_run';
type LifecycleReceipt = {
  schema: 'nexyfab.staging-architecture-interior-lifecycle.v1';
  generatedAt: string;
  ok: boolean;
  target: string;
  runId: string;
  checks: Record<string, CheckStatus>;
  unsupported: Array<{ name: string; status: CheckStatus; reason: string }>;
  releaseReady: false;
  credentialsPersisted: false;
  transientProjectRetained: boolean;
};

function requiredOwner(): Account {
  const email = process.env.E2E_STAGING_OWNER_EMAIL;
  const password = process.env.E2E_STAGING_OWNER_PASSWORD;
  if (!email || !password) throw new Error('E2E_STAGING_OWNER_EMAIL/E2E_STAGING_OWNER_PASSWORD are required');
  return { email, password };
}

function receiptPath(): string | null {
  return process.env.STAGING_ARCHITECTURE_INTERIOR_E2E_RECEIPT
    ? path.resolve(process.env.STAGING_ARCHITECTURE_INTERIOR_E2E_RECEIPT)
    : null;
}

async function login(api: APIRequestContext, account: Account): Promise<void> {
  const response = await api.post('/api/auth/login', { data: account });
  expect(response.status()).toBe(200);
}

async function json(response: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object response');
  return value as Record<string, unknown>;
}

function writeReceipt(output: string | null, receipt: LifecycleReceipt): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
}

test.describe('staging-only architecture/interior AI → exact CAD → artifacts lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  test('requires explicit approval for each write and reconnects the persisted workspace', async ({ baseURL }) => {
    test.skip(process.env.E2E_STAGING_ARCHITECTURE_INTERIOR_LIFECYCLE !== '1', 'requires isolated staging credentials and services');
    test.setTimeout(480_000);
    if (!baseURL) throw new Error('E2E baseURL is required');

    const account = requiredOwner();
    // This guard rejects production by hostname and requires a staging tenant
    // marker before any login or mutation is attempted.
    assertStagingMutationSafety({
      baseURL,
      confirmation: process.env.E2E_STAGING_MUTATION_CONFIRM,
      accountEmails: [account.email],
      tenantMarker: process.env.E2E_STAGING_TENANT_MARKER ?? 'e2e',
    });

    const origin = new URL(baseURL).origin;
    const runId = `architecture-interior-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const checks: Record<string, CheckStatus> = {
      login: 'not_run',
      project_create: 'not_run',
      ai_proposal_ready: 'not_run',
      concept_commit_after_explicit_approval: 'not_run',
      exact_commit_after_explicit_approval: 'not_run',
      derived_artifact_commit_after_explicit_approval: 'not_run',
      workspace_readback: 'not_run',
      reconnect_exact_workspace: 'not_run',
      project_cleanup: 'not_run',
      disposable_account_erased: 'not_run',
    };
    const unsupported: LifecycleReceipt['unsupported'] = [
      { name: 'code_compliance', status: 'not_run', reason: 'route contract reports compliance not_run until governed checks are explicitly run' },
      { name: 'release_and_manufacturing', status: 'not_run', reason: 'architecture/interior lifecycle does not claim release or manufacturing readiness' },
      { name: 'quote_or_rfq_side_effects', status: 'not_run', reason: 'all lifecycle routes explicitly guarantee no quote/RFQ side effects' },
    ];
    const receipt: LifecycleReceipt = {
      schema: 'nexyfab.staging-architecture-interior-lifecycle.v1',
      generatedAt: new Date().toISOString(),
      ok: false,
      target: origin,
      runId,
      checks,
      unsupported,
      releaseReady: false,
      credentialsPersisted: false,
      transientProjectRetained: false,
    };
    const output = receiptPath();
    const api = await requestFactory.newContext({
      baseURL: origin,
      extraHTTPHeaders: { origin, 'user-agent': 'NexyFab-Staging-Architecture-Interior-E2E/1.0' },
    });
    let projectId: string | undefined;
    let loggedIn = false;
    let accountErased = false;

    try {
      checks.login = 'failed';
      await login(api, account);
      loggedIn = true;
      checks.login = 'passed';

      const session = await api.get('/api/auth/session');
      expect(session.status()).toBe(200);
      const sessionPayload = await json(session);
      expect(sessionPayload.authenticated).toBe(true);
      const sessionUser = sessionPayload.user as { plan?: string } | undefined;
      expect(['pro', 'team', 'enterprise']).toContain(sessionUser?.plan);

      checks.project_create = 'failed';
      const created = await api.post('/api/nexyfab/projects', {
        data: {
          name: runId,
          shapeId: 'architecture-interior',
          materialId: 'concrete',
          sceneData: JSON.stringify({ schema: 'nexyfab.architecture-interior-staging-e2e.v1', runId }),
          tags: ['staging-e2e', 'architecture-interior', runId],
        },
      });
      expect(created.status()).toBe(201);
      const createdPayload = await json(created);
      const createdProject = createdPayload.project as { id?: string } | undefined;
      projectId = String(createdProject?.id ?? '');
      expect(projectId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
      checks.project_create = 'passed';

      const projectPath = `/api/nexyfab/projects/${encodeURIComponent(projectId)}`;
      checks.ai_proposal_ready = 'failed';
      const proposalResponse = await api.post(`${projectPath}/architecture-interior-ai-design`, {
        data: {
          proposalId: `${runId}-proposal`,
          designBrief: 'Create exactly one empty 4 m by 3 m office with one 0.9 m door. Use exactly four rectangular boundary corners and do not repeat the first point at the end. Return empty furniture, lights, and finishes arrays.',
          sourceLength: 'm',
          construction: { wallThickness: 0.2, slabThickness: 0.2, ceilingThickness: 0.1 },
          constraints: { storeyCount: 1, storeyHeight: 3.0, maximumFootprintWidth: 12, maximumFootprintDepth: 12 },
          locale: 'en',
        },
      });
      const proposal = await json(proposalResponse);
      expect(
        proposalResponse.status(),
        `architecture/interior proposal rejected: ${JSON.stringify(proposal)}`,
      ).toBe(200);
      expect(proposal).toMatchObject({ ok: true, code: 'CONCEPT_PROPOSAL_READY', persisted: false, exact: { status: 'not_run' } });
      const proposalApproval = proposal.approval as { status?: string; token?: string; proposalHash?: string; candidateHash?: string } | undefined;
      const proposalCandidate = proposal.candidate as { hashes?: { proposal?: string } } | undefined;
      expect(proposalApproval?.status).toBe('ready');
      expect(proposalCandidate?.hashes?.proposal).toMatch(/^[a-f0-9]{64}$/);
      checks.ai_proposal_ready = 'passed';

      const candidateHash = String(proposalApproval?.candidateHash);
      checks.concept_commit_after_explicit_approval = 'failed';
      const conceptCommit = await api.post(`${projectPath}/architecture-interior-ai-design/commit`, {
        data: {
          proposalId: `${runId}-proposal`,
          proposalHash: proposalApproval?.proposalHash,
          candidateHash,
          candidate: proposal.candidate,
          approvalToken: proposalApproval?.token,
        },
      });
      const committed = await json(conceptCommit);
      expect(
        conceptCommit.status(),
        `architecture/interior concept commit rejected: ${JSON.stringify(committed)}`,
      ).toBe(200);
      expect(committed).toMatchObject({ ok: true, code: 'CONCEPT_COMMITTED', persisted: true, revision: 0, exact: { status: 'not_run' } });
      checks.concept_commit_after_explicit_approval = 'passed';

      const workspaceRevision = Number(committed.revision);
      const workspaceContentHash = String(committed.contentHash);
      expect(Number.isSafeInteger(workspaceRevision)).toBe(true);
      expect(workspaceContentHash).toMatch(/^[a-f0-9]{64}$/);

      checks.exact_commit_after_explicit_approval = 'failed';
      const exactEndpoint = `${projectPath}/architecture-interior-exact`;
      const exactChallenge = await api.post(exactEndpoint, { data: { expectedWorkspaceRevision: workspaceRevision, expectedWorkspaceContentHash: workspaceContentHash } });
      expect(exactChallenge.status()).toBe(409);
      const exactChallengePayload = await json(exactChallenge);
      const exactApproval = exactChallengePayload.approval as { token?: string } | undefined;
      expect(exactChallengePayload).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
      expect(exactApproval?.token).toBeTruthy();
      const exactCommit = await api.post(exactEndpoint, {
        data: {
          expectedWorkspaceRevision: workspaceRevision,
          expectedWorkspaceContentHash: workspaceContentHash,
          approved: true,
          approvalToken: exactApproval?.token,
        },
      });
      const exactPayload = await json(exactCommit);
      expect(
        exactCommit.status(),
        `architecture/interior exact promotion rejected: ${JSON.stringify(exactPayload)}`,
      ).toBe(200);
      expect(exactPayload).toMatchObject({ ok: true, code: 'EXACT_PROMOTED', persisted: true, exact: { status: 'passed' } });
      checks.exact_commit_after_explicit_approval = 'passed';

      const exactRevision = Number(exactPayload.revision);
      const exactContentHash = String(exactPayload.contentHash);
      expect(Number.isSafeInteger(exactRevision)).toBe(true);
      expect(exactContentHash).toMatch(/^[a-f0-9]{64}$/);

      checks.derived_artifact_commit_after_explicit_approval = 'failed';
      const artifactEndpoint = `${projectPath}/architecture-interior-artifacts`;
      const artifactRequest = {
        expectedWorkspaceRevision: exactRevision,
        expectedWorkspaceContentHash: exactContentHash,
        requestedKinds: ['quantity', 'drawing', 'ifc'],
        expectedHeadBundleHash: null,
      };
      const artifactChallenge = await api.post(artifactEndpoint, { data: artifactRequest });
      expect(artifactChallenge.status()).toBe(409);
      const artifactChallengePayload = await json(artifactChallenge);
      const artifactApproval = artifactChallengePayload.approval as { token?: string } | undefined;
      expect(artifactChallengePayload).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
      expect(artifactApproval?.token).toBeTruthy();
      const artifactCommit = await api.post(artifactEndpoint, {
        data: { ...artifactRequest, approved: true, approvalScope: 'architecture_interior_artifacts', approvalToken: artifactApproval?.token },
      });
      const artifactPayload = await json(artifactCommit);
      expect(
        artifactCommit.status(),
        `architecture/interior artifact generation rejected: ${JSON.stringify(artifactPayload)}`,
      ).toBe(200);
      const artifactBundle = artifactPayload.bundle as { bundleHash?: string } | undefined;
      expect(artifactPayload).toMatchObject({ ok: true, code: 'BUNDLE_PERSISTED', persisted: true });
      expect(artifactBundle?.bundleHash).toMatch(/^[a-f0-9]{64}$/);
      checks.derived_artifact_commit_after_explicit_approval = 'passed';

      checks.workspace_readback = 'failed';
      const exactRead = await api.get(exactEndpoint);
      expect(exactRead.status()).toBe(200);
      const exactReadPayload = await json(exactRead);
      expect(exactReadPayload).toMatchObject({ ok: true, projectId, exact: { status: 'passed' } });
      const artifactRead = await api.get(artifactEndpoint);
      expect(artifactRead.status()).toBe(200);
      const artifactReadPayload = await json(artifactRead);
      expect(artifactReadPayload).toMatchObject({ ok: true, projectId, bundle: { bundleHash: artifactBundle?.bundleHash } });
      checks.workspace_readback = 'passed';

      checks.reconnect_exact_workspace = 'failed';
      const state = await api.storageState();
      const reconnected = await requestFactory.newContext({ baseURL: origin, storageState: state, extraHTTPHeaders: { origin, 'user-agent': 'NexyFab-Staging-Architecture-Interior-E2E/1.0-reconnect' } });
      try {
        const reopenedProject = await reconnected.get(projectPath);
        expect(reopenedProject.status()).toBe(200);
        const reopenedProjectPayload = await json(reopenedProject);
        expect((reopenedProjectPayload.project as { id?: string } | undefined)?.id).toBe(projectId);
        const reopenedExact = await reconnected.get(exactEndpoint);
        expect(reopenedExact.status()).toBe(200);
        expect(((await json(reopenedExact)).exact as { status?: string } | undefined)?.status).toBe('passed');
        const reopenedArtifacts = await reconnected.get(artifactEndpoint);
        expect(reopenedArtifacts.status()).toBe(200);
        expect(((await json(reopenedArtifacts)).bundle as { bundleHash?: string } | undefined)?.bundleHash).toBe((artifactPayload.bundle as { bundleHash?: string }).bundleHash);
      } finally {
        await reconnected.dispose();
      }
      checks.reconnect_exact_workspace = 'passed';
    } catch (error) {
      for (const name of Object.keys(checks)) if (checks[name] === 'not_run') checks[name] = 'not_run';
      throw error;
    } finally {
      if (projectId && loggedIn) {
        checks.project_cleanup = 'failed';
        const removed = await api.delete(`/api/nexyfab/projects/${encodeURIComponent(projectId)}`).catch(() => null);
        if (removed) {
          expect([200, 404]).toContain(removed.status());
          const projectAfterCleanup = await api.get(`/api/nexyfab/projects/${encodeURIComponent(projectId)}`).catch(() => null);
          if (projectAfterCleanup) expect(projectAfterCleanup.status()).toBe(404);
          checks.project_cleanup = 'passed';
        }
      }
      if (loggedIn) {
        checks.disposable_account_erased = 'failed';
        const erased = await api.delete('/api/auth/account', { data: { password: account.password, confirm: 'DELETE MY ACCOUNT' } }).catch(() => null);
        if (erased) {
          expect(erased.status()).toBe(200);
          accountErased = true;
          checks.disposable_account_erased = 'passed';
        }
      }
      receipt.ok = Object.values(checks).every(status => status === 'passed');
      receipt.transientProjectRetained = checks.project_cleanup !== 'passed';
      receipt.generatedAt = new Date().toISOString();
      writeReceipt(output, receipt);
      await api.dispose();
      // Keep this assertion after receipt generation so an incomplete cleanup
      // is recorded as a failed/not-run gate rather than being hidden.
      expect(accountErased).toBe(true);
    }
  });
});
