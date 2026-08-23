/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';
import FetchAuthRetry from './FetchAuthRetry';

describe('FetchAuthRetry', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      token: null,
      sessionStatus: 'unknown',
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not turn a guest notification 401 into a refresh 400', async () => {
    const original = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    window.fetch = original as typeof fetch;
    useAuthStore.setState({ sessionStatus: 'anonymous' });
    render(<FetchAuthRetry />);

    let response: Response | undefined;
    await act(async () => {
      response = await window.fetch('/api/nexyfab/notifications');
    });

    expect(response?.status).toBe(401);
    expect(original).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalledWith('/api/auth/refresh', expect.anything());
  });

  it('still refreshes and retries a safe request for a confirmed member', async () => {
    let protectedCalls = 0;
    const original = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/refresh') return new Response('{}', { status: 200 });
      protectedCalls += 1;
      return new Response('{}', { status: protectedCalls === 1 ? 401 : 200 });
    });
    window.fetch = original as typeof fetch;
    useAuthStore.setState({ sessionStatus: 'authenticated' });
    render(<FetchAuthRetry />);

    let response: Response | undefined;
    await act(async () => {
      response = await window.fetch('/api/nexyfab/notifications');
    });

    expect(response?.status).toBe(200);
    expect(original.mock.calls.map(call => String(call[0]))).toEqual([
      '/api/nexyfab/notifications',
      '/api/auth/refresh',
      '/api/nexyfab/notifications',
    ]);
  });
});
