import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithRetry } from '../fetch-retry';

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns on first successful fetch', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const res = await fetchWithRetry('https://example.com', undefined, 2, 0);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 and succeeds on retry', async () => {
    const fail = new Response('error', { status: 500 });
    const ok = new Response('ok', { status: 200 });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(ok));

    const res = await fetchWithRetry('https://example.com', undefined, 2, 0);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns 4xx immediately without retry', async () => {
    const notFound = new Response('not found', { status: 404 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound));

    const res = await fetchWithRetry('https://example.com', undefined, 2, 0);
    expect(res.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns last 500 response after exhausting retries', async () => {
    const fail = new Response('error', { status: 500 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail));

    const res = await fetchWithRetry('https://example.com', undefined, 2, 0);
    expect(res.status).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('throws after max retries on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

    await expect(
      fetchWithRetry('https://example.com', undefined, 1, 0),
    ).rejects.toThrow('Network failure');
    expect(fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});
