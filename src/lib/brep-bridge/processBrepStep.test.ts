import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBrepStepProcess } from './processBrepStep';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BREP_WORKER_URL;
});

describe('runBrepStepProcess large object contract', () => {
  it('sends sourceUrl/sourceBytes without an inline base64 field', async () => {
    process.env.BREP_WORKER_URL = 'https://worker.example';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ artifactUrl: 'https://artifact.example/preview.stl' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await runBrepStepProcess({
      userId: 'u1', jobId: 'j1', filename: 'large.step',
      sourceUrl: 'https://private.example/large.step?sig=short', sourceBytes: 417 * 1024 * 1024,
    });
    expect(result.artifactUrl).toBe('https://artifact.example/preview.stl');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ filename: 'large.step', jobId: 'j1', sourceBytes: 417 * 1024 * 1024 });
    expect(body.sourceUrl).toContain('sig=short');
    expect(body).not.toHaveProperty('base64');
  });

  it('fails closed when no external worker can consume the private source URL', async () => {
    const result = await runBrepStepProcess({
      userId: 'u1', jobId: 'j1', filename: 'large.step',
      sourceUrl: 'https://private.example/large.step?sig=short', sourceBytes: 100,
    });
    expect(result.errorMessage).toMatch(/BREP_WORKER_URL is not configured/);
  });
});
