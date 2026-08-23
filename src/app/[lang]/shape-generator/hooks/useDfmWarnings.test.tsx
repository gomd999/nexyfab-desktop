// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDfmWarnings } from './useDfmWarnings';

describe('useDfmWarnings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('posts to the canonical trailing-slash DFM route and exposes the server verdict', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      issues: 0,
      warnings: 1,
      items: [{ level: 'warning', param: 'width', message: 'Review width' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const { result } = renderHook(() => useDfmWarnings({ width: 50 }, 20));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/nexyfab/dfm-check/', expect.objectContaining({
      method: 'POST',
    }));
    expect(result.current).toMatchObject({ issues: 0, warnings: 1, status: 'warn', loading: false });
  });
});
