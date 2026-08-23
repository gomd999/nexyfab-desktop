import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  PRECISION_CAD_WORKER_LIMITS,
  PrecisionCadWorkerQueue,
} from './isolatedWorkerQueue';
import { issueServerCadHydrationBinding } from './serverCadHydrationBinding';

const binding = { projectId: 'project-1', revision: 4, updatedAt: 1_700_000_000_000 } as const;
const workerScript = resolve(process.cwd(), 'scripts/drawing-to-3d/precision-cad-worker.mjs');

function runWorker(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [workerScript], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error(`worker exited ${code}`));
      try { resolveResult(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>); }
      catch (error) { reject(error); }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

describe('isolated Precision CAD worker queue', () => {
  it('executes the exact installer tool in a separate process and reuses idempotent jobs', async () => {
    const traces: string[] = [];
    const queue = new PrecisionCadWorkerQueue({ workerScript, trace: event => traces.push(`${event.event}:${event.status}`) });
    const first = queue.enqueue({ userId: 'user-1', binding, tool: 'list_domains', arguments: {}, idempotencyKey: 'turn-1' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = queue.enqueue({ userId: 'user-1', binding, tool: 'list_domains', arguments: {}, idempotencyKey: 'turn-1' });
    expect(second).toMatchObject({ ok: true, reused: true, job: { id: first.job.id } });
    const completed = await queue.wait(first.job.id, 15_000);
    expect(completed).toMatchObject({ id: first.job.id, status: 'succeeded', binding, tool: 'list_domains', result: { ok: true } });
    expect(traces).toEqual(expect.arrayContaining(['queued:queued', 'started:running', 'succeeded:succeeded']));
  }, 20_000);

  it('fails closed for browser paths, secrets, oversized input, and invalid binding', () => {
    const queue = new PrecisionCadWorkerQueue({ workerScript });
    expect(queue.enqueue({ userId: 'user-1', binding, tool: 'list_domains', idempotencyKey: 'path', arguments: { file: 'C:\\tmp\\part.step' } })).toEqual({ ok: false, errorCode: 'PATH_INPUT_FORBIDDEN' });
    expect(queue.enqueue({ userId: 'user-1', binding, tool: 'list_domains', idempotencyKey: 'secret', arguments: { apiKey: 'do-not-send' } })).toEqual({ ok: false, errorCode: 'SECRET_INPUT_FORBIDDEN' });
    expect(queue.enqueue({ userId: 'user-1', binding, tool: 'list_domains', idempotencyKey: 'valid-binding', arguments: {} })).toMatchObject({ ok: true });
    expect(queue.enqueue({ userId: 'user-1', binding: { ...binding, revision: -1 }, tool: 'list_domains', idempotencyKey: 'bad-revision', arguments: {} })).toEqual({ ok: false, errorCode: 'INVALID_REQUEST' });
    expect(queue.enqueue({ userId: 'user-1', binding, tool: 'list_domains', idempotencyKey: 'large', arguments: { value: 'x'.repeat(PRECISION_CAD_WORKER_LIMITS.maxArgumentBytes) } })).toEqual({ ok: false, errorCode: 'ARGUMENTS_TOO_LARGE' });
  });

  it('holds client CAD ownership/runtime references before a child process is spawned', () => {
    const queue = new PrecisionCadWorkerQueue({ workerScript });
    expect(queue.enqueue({
      userId: 'user-1', binding, tool: 'build_assembly', idempotencyKey: 'brep-ref',
      arguments: { assembly: { parts: [{ id: 'part-1', metadata: { partId: 'part-1', brepHandle: 'occt:forged' } }] } },
    })).toEqual({ ok: false, errorCode: 'CAD_RUNTIME_HYDRATION_REQUIRED' });
    expect(queue.enqueue({
      userId: 'user-1', binding, tool: 'render_preview', idempotencyKey: 'nested-ref',
      arguments: { options: { ownership: { canonicalPartIds: ['part-1'] } } },
    })).toEqual({ ok: false, errorCode: 'CAD_RUNTIME_HYDRATION_REQUIRED' });
  });

  it('child independently returns an honest HOLD when invoked without the queue', async () => {
    await expect(runWorker({
      projectId: binding.projectId,
      revision: binding.revision,
      updatedAt: binding.updatedAt,
      userId: 'user-1',
      tool: 'build_assembly',
      arguments: { assembly: { parts: [{ id: 'part-1', partId: 'part-1', brepHandle: 'occt:web-process' }] } },
    })).resolves.toMatchObject({ ok: false, code: 'CAD_RUNTIME_HYDRATION_REQUIRED' });
  }, 10_000);

  it('passes only a server-signed CAS binding and keeps the child HOLD without an OCCT consumer contract', async () => {
    process.env.NEXYFAB_CAD_WORKER_BINDING_SECRET = 'queue-cad-hydration-secret-0123456789';
    try {
      const cadHydrationBinding = issueServerCadHydrationBinding({
        userId: 'user-1',
        mapping: {
          projectId: binding.projectId,
          workspaceId: binding.projectId,
          revision: binding.revision,
          workspaceContentHash: 'a'.repeat(64),
          geometryContentHash: 'b'.repeat(64),
          shapeIdentityHash: 'c'.repeat(64),
          sourceRecordId: 'source-record-1',
        },
      });
      expect(cadHydrationBinding).not.toBeNull();
      const queue = new PrecisionCadWorkerQueue({ workerScript });
      const enqueued = queue.enqueue({ userId: 'user-1', binding, tool: 'build_assembly', idempotencyKey: 'server-cad-binding', arguments: {}, cadHydrationBinding: cadHydrationBinding! });
      expect(enqueued.ok).toBe(true);
      if (!enqueued.ok) return;
      await expect(queue.wait(enqueued.job.id, 15_000)).resolves.toMatchObject({ status: 'failed', errorCode: 'CAD_RUNTIME_HYDRATION_REQUIRED' });
    } finally {
      delete process.env.NEXYFAB_CAD_WORKER_BINDING_SECRET;
    }
  }, 20_000);

  it('replays only an identical request and rejects idempotency-key payload substitution', async () => {
    const queue = new PrecisionCadWorkerQueue({ workerScript });
    const first = queue.enqueue({
      userId: 'user-1', binding, tool: 'list_domains', idempotencyKey: 'same-operation',
      arguments: { filters: { discipline: 'mechanical', active: true } },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(queue.enqueue({
      userId: 'user-1', binding, tool: 'list_domains', idempotencyKey: 'same-operation',
      arguments: { filters: { active: true, discipline: 'mechanical' } },
    })).toMatchObject({ ok: true, reused: true, job: { id: first.job.id } });
    expect(queue.enqueue({
      userId: 'user-1', binding, tool: 'list_domains', idempotencyKey: 'same-operation',
      arguments: { filters: { active: true, discipline: 'mechanical', omittedByJson: undefined } },
    })).toMatchObject({ ok: true, reused: true, job: { id: first.job.id } });
    expect(queue.enqueue({
      userId: 'user-1', binding, tool: 'list_domains', idempotencyKey: 'same-operation',
      arguments: { filters: { discipline: 'civil', active: true } },
    })).toEqual({ ok: false, errorCode: 'IDEMPOTENCY_CONFLICT' });
    expect(queue.enqueue({
      userId: 'user-1', binding, tool: 'analyze_dfm', idempotencyKey: 'same-operation',
      arguments: { filters: { active: true, discipline: 'mechanical' } },
    })).toEqual({ ok: false, errorCode: 'IDEMPOTENCY_CONFLICT' });

    await queue.wait(first.job.id, 15_000);
  }, 20_000);

  it('kills the worker at the timeout boundary and reports a stable timed_out status', async () => {
    const queue = new PrecisionCadWorkerQueue({ workerScript, timeoutMs: 100, workerEnv: { NEXYFAB_PRECISION_CAD_WORKER_DELAY_MS: '500' } });
    const enqueued = queue.enqueue({ userId: 'user-1', binding, tool: 'list_domains', arguments: {}, idempotencyKey: 'timeout' });
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) return;
    await expect(queue.wait(enqueued.job.id, 5_000)).resolves.toMatchObject({ status: 'timed_out', errorCode: 'WORKER_TIMEOUT' });
  }, 10_000);

  it('resolves every concurrent waiter for an idempotently shared job', async () => {
    const queue = new PrecisionCadWorkerQueue({ workerScript });
    const enqueued = queue.enqueue({ userId: 'user-1', binding, tool: 'list_domains', arguments: {}, idempotencyKey: 'multi-waiter' });
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) return;
    const [first, second, third] = await Promise.all([
      queue.wait(enqueued.job.id, 15_000),
      queue.wait(enqueued.job.id, 15_000),
      queue.wait(enqueued.job.id, 15_000),
    ]);
    expect(first).toMatchObject({ id: enqueued.job.id, status: 'succeeded' });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  }, 20_000);
});
