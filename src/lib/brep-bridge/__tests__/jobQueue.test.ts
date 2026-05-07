import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../processBrepStep', () => ({
  runBrepStepProcess: vi.fn(),
  maybeUploadBrepPreviewStl: vi.fn().mockResolvedValue({}),
}));

import { runBrepStepProcess } from '../processBrepStep';
import { __resetBrepJobQueueForTests, enqueueBrepStepJob, getBrepStepJob } from '../jobQueue';

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
});
