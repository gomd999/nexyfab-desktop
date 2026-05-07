import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../runOpenScadCli', () => ({
  runOpenScadCli: vi.fn(),
}));

import { runOpenScadCli } from '../runOpenScadCli';
import {
  __resetOpenScadJobQueueForTests,
  enqueueOpenScadJob,
  getOpenScadJob,
} from '../jobQueue';

describe('openscad jobQueue', () => {
  beforeEach(() => {
    __resetOpenScadJobQueueForTests();
    vi.mocked(runOpenScadCli).mockResolvedValue({
      ok: true,
      buffer: Buffer.from('fake-stl'),
      stderr: '',
    });
  });

  it('runs queued job to completion', async () => {
    const job = await enqueueOpenScadJob({ userId: 'user-a', scad: 'cube();', format: 'stl' });
    expect(['queued', 'processing']).toContain(job.status);

    await vi.waitFor(
      () => {
        expect(getOpenScadJob(job.id, 'user-a')?.status).toBe('complete');
      },
      { timeout: 3000 },
    );

    const done = getOpenScadJob(job.id, 'user-a');
    expect(done?.resultBase64).toBe(Buffer.from('fake-stl').toString('base64'));
    expect(getOpenScadJob(job.id, 'user-b')).toBeNull();
  });
});
