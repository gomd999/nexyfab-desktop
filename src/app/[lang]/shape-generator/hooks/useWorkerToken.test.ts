// @vitest-environment jsdom
/**
 * useWorkerToken hook tests. Verifies the cache + dedup behavior so a
 * long-running session doesn't hammer /api/nexyfab/worker-token, and
 * an expired token gets refreshed transparently.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkerToken } from './useWorkerToken';

const ORIGINAL_FETCH = globalThis.fetch;

function mockTokenResponse(token: string, ttlSec: number): Response {
  return new Response(
    JSON.stringify({ token, expiresInSeconds: ttlSec }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
});

describe('useWorkerToken', () => {
  it('returns null when endpoint replies 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkerToken());
    await act(async () => {
      const t = await result.current.getToken();
      expect(t).toBeNull();
    });
  });

  it('caches the token across calls (single fetch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockTokenResponse('TOK-A', 900));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkerToken());
    await act(async () => {
      const t1 = await result.current.getToken();
      const t2 = await result.current.getToken();
      const t3 = await result.current.getToken();
      expect(t1).toBe('TOK-A');
      expect(t2).toBe('TOK-A');
      expect(t3).toBe('TOK-A');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedups concurrent first calls (single fetch even when racy)', async () => {
    let resolveFetch: (v: Response) => void = () => {};
    const slow = new Promise<Response>(r => { resolveFetch = r; });
    const fetchMock = vi.fn().mockReturnValue(slow);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkerToken());
    let t1: string | null = null;
    let t2: string | null = null;
    await act(async () => {
      const p1 = result.current.getToken();
      const p2 = result.current.getToken();
      resolveFetch(mockTokenResponse('TOK-B', 900));
      [t1, t2] = await Promise.all([p1, p2]);
    });
    expect(t1).toBe('TOK-B');
    expect(t2).toBe('TOK-B');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes when cached token is within 60 s of expiry', async () => {
    // First fetch returns ttl=30s — which is below the 60s refresh
    // window, so the SECOND getToken should trigger a fresh fetch.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockTokenResponse('TOK-OLD', 30))
      .mockResolvedValueOnce(mockTokenResponse('TOK-NEW', 900));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkerToken());
    await act(async () => {
      const t1 = await result.current.getToken();
      expect(t1).toBe('TOK-OLD');
    });
    await act(async () => {
      const t2 = await result.current.getToken();
      expect(t2).toBe('TOK-NEW');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidate() forces a refetch on next call', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockTokenResponse('TOK-1', 900))
      .mockResolvedValueOnce(mockTokenResponse('TOK-2', 900));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useWorkerToken());
    await act(async () => {
      const t1 = await result.current.getToken();
      expect(t1).toBe('TOK-1');
      result.current.invalidate();
      const t2 = await result.current.getToken();
      expect(t2).toBe('TOK-2');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
