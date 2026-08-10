import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../processBrepStep', () => ({
  runBrepStepProcess: vi.fn(),
  maybeUploadBrepPreviewStl: vi.fn().mockResolvedValue({}),
}));
const { getSignedUrl } = vi.hoisted(() => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://private.example/model.step?sig=test'),
}));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({ getSignedUrl }),
}));

import { runBrepStepProcess } from '../processBrepStep';
import {
  __resetBrepJobQueueForTests,
  cancelBrepStepJobAsync,
  countBrepUserPendingJobsAsync,
  enqueueBrepStepJob,
  enqueueBrepStepObjectJob,
  getBrepStepJob,
} from '../jobQueue';

describe('brep jobQueue', () => {
  beforeEach(() => {
    __resetBrepJobQueueForTests();
    vi.mocked(runBrepStepProcess).mockResolvedValue({
      previewMeshBase64: Buffer.from('stl').toString('base64'),
    });
  });

  it('runs queued job to completion', async () => {
    const job = await enqueueBrepStepJob({
      userId: 'u1',
      buffer: Buffer.from('ISO-10303'),
      filename: 'x.step',
    });
    expect(['queued', 'processing']).toContain(job.status);

    await vi.waitFor(
      () => {
        expect(getBrepStepJob(job.id, 'u1')?.status).toBe('complete');
      },
      { timeout: 3000 },
    );

    expect(getBrepStepJob(job.id, 'u2')).toBeNull();
  });

  it('queues a large private object by reference and sends only a short-lived URL to the worker', async () => {
    const job = await enqueueBrepStepObjectJob({
      userId: 'u1', objectKey: 'private/files/u1/id/large.step',
      sourceBytes: 417 * 1024 * 1024, filename: 'large.step',
    });
    await vi.waitFor(() => expect(getBrepStepJob(job.id, 'u1')?.status).toBe('complete'), { timeout: 3000 });
    expect(getSignedUrl).toHaveBeenCalledWith('private/files/u1/id/large.step', 300);
    expect(runBrepStepProcess).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', filename: 'large.step', sourceBytes: 417 * 1024 * 1024,
      sourceUrl: 'https://private.example/model.step?sig=test',
    }));
    const call = vi.mocked(runBrepStepProcess).mock.calls.at(-1)?.[0];
    expect(call).not.toHaveProperty('buffer');
  });

  it('counts per-user pending work and lets only the owner cancel a queued job', async () => {
    let finishFirst!: (value: { previewMeshBase64: string }) => void;
    vi.mocked(runBrepStepProcess).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    const first = await enqueueBrepStepJob({ userId: 'u1', buffer: Buffer.from('ISO-10303'), filename: 'first.step' });
    await vi.waitFor(() => expect(getBrepStepJob(first.id, 'u1')?.status).toBe('processing'));

    const second = await enqueueBrepStepJob({ userId: 'u1', buffer: Buffer.from('ISO-10303'), filename: 'second.step' });
    expect(await countBrepUserPendingJobsAsync('u1')).toBe(2);
    expect(await cancelBrepStepJobAsync(second.id, 'attacker')).toBe('not_found');
    expect(await cancelBrepStepJobAsync(second.id, 'u1')).toBe('cancelled');
    expect(getBrepStepJob(second.id, 'u1')?.status).toBe('cancelled');
    expect(await countBrepUserPendingJobsAsync('u1')).toBe(1);

    finishFirst({ previewMeshBase64: Buffer.from('stl').toString('base64') });
    await vi.waitFor(() => expect(getBrepStepJob(first.id, 'u1')?.status).toBe('complete'));
  });
});
