import fs from 'node:fs';
import path from 'node:path';
import { expect, request as requestFactory, test, type APIRequestContext } from '@playwright/test';
import { assertStagingMutationSafety } from './helpers/staging-safety';

type Account = { email: string; password: string };
type CleanupState = { projectId?: string; shareToken?: string; reviewId?: string; sessions: string[] };

function requiredAccount(prefix: 'OWNER' | 'OUTSIDER'): Account {
  const email = process.env[`E2E_STAGING_${prefix}_EMAIL`];
  const password = process.env[`E2E_STAGING_${prefix}_PASSWORD`];
  if (!email || !password) throw new Error(`E2E_STAGING_${prefix}_EMAIL/PASSWORD are required`);
  return { email, password };
}

async function login(baseURL: string, account: Account): Promise<APIRequestContext> {
  const context = await requestFactory.newContext({
    baseURL,
    extraHTTPHeaders: { origin: baseURL, 'user-agent': 'NexyFab-Staging-Lifecycle/2.0' },
  });
  const response = await context.post('/api/auth/login', { data: account });
  expect(response.status(), await response.text()).toBe(200);
  return context;
}

async function pollCadJob(api: APIRequestContext, pollUrl: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const response = await api.get(pollUrl);
    expect(response.status(), await response.text()).toBe(200);
    last = await response.json() as Record<string, unknown>;
    if (last.status === 'complete') return last;
    if (last.status === 'failed') throw new Error(`CAD job failed: ${String(last.error ?? 'unknown')}`);
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`CAD job timeout; last status=${String(last.status ?? 'unknown')}`);
}

async function retryAfterInjectedNetworkDrop(api: APIRequestContext, url: string) {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      if (attempts === 1) throw new Error('E2E_INJECTED_NETWORK_DROP');
      const response = await api.get(url);
      if (!response.ok()) throw new Error(`HTTP_${response.status()}`);
      return { attempts, response };
    } catch (error) {
      if (attempts >= 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * attempts));
    }
  }
}

test.describe('staging-only authenticated commercial lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  test('AI → manual edit → precise CAD job → reconnect → export/share/review → ACL and cleanup', async ({ baseURL }) => {
    test.skip(process.env.E2E_STAGING_LIFECYCLE !== '1', 'requires isolated staging credentials and services');
    test.setTimeout(300_000);
    if (!baseURL) throw new Error('E2E baseURL is required');

    const ownerAccount = requiredAccount('OWNER');
    const outsiderAccount = requiredAccount('OUTSIDER');
    assertStagingMutationSafety({
      baseURL,
      confirmation: process.env.E2E_STAGING_MUTATION_CONFIRM,
      accountEmails: [ownerAccount.email, outsiderAccount.email],
      tenantMarker: process.env.E2E_STAGING_TENANT_MARKER ?? 'e2e',
    });

    const runId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const checks: string[] = [];
    const cleanup: CleanupState = { sessions: [] };
    const owner = await login(baseURL, ownerAccount);
    const outsider = await login(baseURL, outsiderAccount);
    let workerRecovery: 'passed' | 'pending_external_hook' = 'pending_external_hook';
    let cleanupVerified = false;

    try {
      const aiIntake = await owner.post('/api/nexyfab/intake-from-text', {
        data: { text: 'Design a 30 x 20 x 10 mm steel mounting bracket for indoor static load.' },
      });
      expect(aiIntake.status(), await aiIntake.text()).toBe(200);
      const intake = await aiIntake.json() as { spec?: { category?: string }; sourceText?: string };
      expect(typeof intake.spec?.category).toBe('string');
      expect(intake.sourceText).toContain('mounting bracket');
      checks.push('live_ai_intake_structured');

      const verifiedDesign = await owner.post('/api/nexyfab/design-brief', {
        data: { brief: { id: runId, text: 'L-Bracket', params: { fixture: 'l-bracket' } } },
      });
      expect(verifiedDesign.status(), await verifiedDesign.text()).toBe(200);
      const aiPackage = await verifiedDesign.json() as { ok: boolean; package: { report: { allPassed: boolean } } };
      expect(aiPackage.ok).toBe(true);
      expect(aiPackage.package.report.allPassed).toBe(true);
      checks.push('ai_output_gate_checked_design');

      const sceneV1 = JSON.stringify({
        schema: 'nexyfab.staging-e2e.v2',
        runId,
        source: 'verified-design-brief',
        manualRevision: 0,
        fixture: 'l-bracket',
      });
      const created = await owner.post('/api/nexyfab/projects', {
        data: {
          name: runId,
          shapeId: 'l-bracket',
          materialId: 'steel',
          sceneData: sceneV1,
          tags: ['staging-e2e', runId],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const createdProject = (await created.json()).project as { id: string; updatedAt: number };
      cleanup.projectId = createdProject.id;
      checks.push('project_created');

      const sceneV2 = JSON.stringify({
        schema: 'nexyfab.staging-e2e.v2',
        runId,
        source: 'verified-design-brief',
        manualRevision: 1,
        fixture: 'l-bracket',
        manualEdit: { filletRadiusMm: 2 },
      });
      // Keep the server-side millisecond revision token distinct from create.
      await new Promise(resolve => setTimeout(resolve, 10));
      const manual = await owner.patch(`/api/nexyfab/projects/${encodeURIComponent(cleanup.projectId)}`, {
        data: { sceneData: sceneV2, ifMatchUpdatedAt: createdProject.updatedAt },
      });
      expect(manual.status(), await manual.text()).toBe(200);
      checks.push('manual_cad_saved');

      const staleDuplicate = await owner.patch(`/api/nexyfab/projects/${encodeURIComponent(cleanup.projectId)}`, {
        data: { sceneData: sceneV2, ifMatchUpdatedAt: createdProject.updatedAt },
      });
      expect(staleDuplicate.status(), await staleDuplicate.text()).toBe(409);
      expect((await staleDuplicate.json()).code).toBe('PROJECT_VERSION_CONFLICT');
      checks.push('duplicate_stale_write_rejected');

      const sessionA = `${runId}-a`;
      const sessionB = `${runId}-b`;
      const joins = await Promise.all([
        owner.post('/api/nexyfab/collab', { data: { projectId: cleanup.projectId, sessionId: sessionA, action: 'join', cursor: { x: 0, y: 0, z: 0 } } }),
        owner.post('/api/nexyfab/collab', { data: { projectId: cleanup.projectId, sessionId: sessionB, action: 'join', cursor: { x: 1, y: 2, z: 3 } } }),
      ]);
      expect(joins.map(response => response.status())).toEqual([200, 200]);
      cleanup.sessions.push(sessionA, sessionB);
      const presence = await owner.get(`/api/nexyfab/collab?projectId=${encodeURIComponent(cleanup.projectId)}`);
      expect(presence.status(), await presence.text()).toBe(200);
      expect((await presence.json()).sessions).toHaveLength(2);
      checks.push('concurrent_collaboration_sessions');

      const source = await owner.post('/api/nexyfab/scad-from-intent', {
        data: { shapeId: 'box', params: { width: 30, height: 20, depth: 10 } },
      });
      expect(source.status(), await source.text()).toBe(200);
      const scad = (await source.json()).scad as string;
      const jobResponse = await owner.post('/api/nexyfab/openscad-render', {
        data: { scad, format: 'stl', async: true },
      });
      expect(jobResponse.status(), await jobResponse.text()).toBe(200);
      const queued = await jobResponse.json() as { jobId: string; pollUrl: string; mode: string };
      expect(queued.mode).toBe('async');

      const restartPath = process.env.E2E_STAGING_WORKER_RESTART_PATH;
      const restartToken = process.env.E2E_STAGING_WORKER_RESTART_TOKEN;
      if (restartPath && restartToken) {
        if (!restartPath.startsWith('/')) throw new Error('worker restart path must be same-origin');
        const restarted = await owner.post(restartPath, {
          headers: { 'x-e2e-worker-restart-token': restartToken },
          data: { queue: 'openscad', jobId: queued.jobId },
        });
        expect(restarted.status(), await restarted.text()).toBe(202);
        workerRecovery = 'passed';
      }
      const job = await pollCadJob(owner, queued.pollUrl);
      expect(typeof job.dataBase64 === 'string' || typeof job.artifactUrl === 'string').toBe(true);
      checks.push('precise_cad_async_job_complete');
      if (workerRecovery === 'passed') checks.push('worker_restart_recovery');

      const unauthorizedProject = await outsider.get(`/api/nexyfab/projects/${encodeURIComponent(cleanup.projectId)}`);
      expect(unauthorizedProject.status()).toBe(404);
      const unauthorizedCollab = await outsider.post('/api/nexyfab/collab', {
        data: { projectId: cleanup.projectId, sessionId: `${runId}-outsider`, action: 'join' },
      });
      expect(unauthorizedCollab.status()).toBe(404);
      const unauthorizedJob = await outsider.get(queued.pollUrl);
      expect(unauthorizedJob.status()).toBe(404);
      checks.push('tenant_acl_project_collab_job');

      const retried = await retryAfterInjectedNetworkDrop(
        owner,
        `/api/nexyfab/projects/${encodeURIComponent(cleanup.projectId)}`,
      );
      expect(retried.attempts).toBe(2);
      checks.push('network_retry_recovered');

      const state = await owner.storageState();
      const reconnected = await requestFactory.newContext({
        baseURL,
        storageState: state,
        extraHTTPHeaders: { origin: baseURL, 'user-agent': 'NexyFab-Staging-Reconnect/2.0' },
      });
      try {
        const reopened = await reconnected.get(`/api/nexyfab/projects/${encodeURIComponent(cleanup.projectId)}`);
        expect(reopened.status(), await reopened.text()).toBe(200);
        expect((await reopened.json()).project.sceneData).toBe(sceneV2);
      } finally {
        await reconnected.dispose();
      }
      checks.push('save_reconnect_exact_scene');

      const exported = await owner.post('/api/nexyfab/drawing/export-step', {
        data: {
          intent: {
            name: `${runId}-step-box`,
            features: [{ id: 'base', kind: 'box', size: [30, 20, 10], op: 'add' }],
          },
        },
      });
      expect(exported.status(), await exported.text()).toBe(200);
      const step = await exported.json() as { ok: boolean; step: string; bytes: number };
      expect(step.ok).toBe(true);
      expect(step.step).toContain('ISO-10303-21');
      expect(step.bytes).toBeGreaterThan(100);
      checks.push('step_export');

      const shared = await owner.post('/api/nexyfab/share', {
        data: {
          meshDataBase64: String(job.dataBase64 ?? Buffer.from('artifact-backed').toString('base64')),
          metadata: { name: runId, watermark: 'STAGING E2E', allowDownload: false },
          expiresInHours: 1,
          lang: 'en',
        },
      });
      expect(shared.status(), await shared.text()).toBe(201);
      cleanup.shareToken = (await shared.json()).token as string;
      const publicShare = await owner.get(`/api/nexyfab/share?token=${cleanup.shareToken}`);
      expect(publicShare.status(), await publicShare.text()).toBe(200);
      const outsiderRevoke = await outsider.delete(`/api/nexyfab/share?token=${cleanup.shareToken}`);
      expect(outsiderRevoke.status()).toBe(404);
      checks.push('share_create_read_acl');

      const review = await owner.post('/api/nexyfab/reviews', {
        data: {
          filename: `${runId}.step`, material: 'steel', process: 'staging-validation',
          metrics: { stepBytes: step.bytes },
          report: { status: 'expert-review-required', automatedChecksPassed: true, runId },
        },
      });
      expect(review.status(), await review.text()).toBe(200);
      cleanup.reviewId = (await review.json()).id as string;
      const reviews = await owner.get('/api/nexyfab/reviews');
      expect(reviews.status(), await reviews.text()).toBe(200);
      expect((await reviews.json()).reviews.some((item: { id: string }) => item.id === cleanup.reviewId)).toBe(true);
      const outsiderReviewDelete = await outsider.delete(`/api/nexyfab/reviews?id=${cleanup.reviewId}`);
      expect(outsiderReviewDelete.status()).toBe(404);
      checks.push('expert_review_packet_and_acl');
    } finally {
      for (const sessionId of cleanup.sessions) {
        if (cleanup.projectId) {
          await owner.post('/api/nexyfab/collab', {
            data: { projectId: cleanup.projectId, sessionId, action: 'leave' },
          }).catch(() => null);
        }
      }
      if (cleanup.reviewId) {
        const response = await owner.delete(`/api/nexyfab/reviews?id=${cleanup.reviewId}`).catch(() => null);
        if (response) expect([200, 404]).toContain(response.status());
      }
      if (cleanup.shareToken) {
        const response = await owner.delete(`/api/nexyfab/share?token=${cleanup.shareToken}`).catch(() => null);
        if (response) expect([200, 404]).toContain(response.status());
      }
      if (cleanup.projectId) {
        const response = await owner.delete(`/api/nexyfab/projects/${encodeURIComponent(cleanup.projectId)}`).catch(() => null);
        if (response) expect([200, 404]).toContain(response.status());
      }
      if (cleanup.projectId) {
        expect((await owner.get(`/api/nexyfab/projects/${encodeURIComponent(cleanup.projectId)}`)).status()).toBe(404);
      }
      if (cleanup.shareToken) {
        expect((await owner.get(`/api/nexyfab/share?token=${cleanup.shareToken}`)).status()).toBe(404);
      }
      if (cleanup.reviewId) {
        const remaining = await owner.get('/api/nexyfab/reviews');
        expect(remaining.status(), await remaining.text()).toBe(200);
        expect((await remaining.json()).reviews.some((item: { id: string }) => item.id === cleanup.reviewId)).toBe(false);
      }
      cleanupVerified = true;
      await Promise.allSettled([owner.post('/api/auth/logout'), outsider.post('/api/auth/logout')]);
      await owner.dispose();
      await outsider.dispose();
    }

    const receiptPath = process.env.STAGING_E2E_RECEIPT;
    if (receiptPath) {
      const output = path.resolve(receiptPath);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify({
        schema: 'nexyfab.staging-authenticated-lifecycle.v2',
        generatedAt: new Date().toISOString(),
        ok: true,
        target: new URL(baseURL).origin,
        runId,
        checks,
        workerRecovery,
        expertApproval: 'not_claimed_test_packet_only',
        credentialsPersisted: false,
        transientRecordsRetained: !cleanupVerified,
      }, null, 2)}\n`);
    }
  });
});
