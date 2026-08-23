/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore, type AuthUser } from '@/hooks/useAuth';
import NexyfabSessionHydrator from './NexyfabSessionHydrator';

const user: AuthUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'User',
  plan: 'pro',
  projectCount: 2,
  nexyfabStage: 'B',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('NexyfabSessionHydrator', () => {
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('makes one session probe and clears stale persisted identity for a guest', async () => {
    useAuthStore.setState({ user, token: 'stale-token', sessionStatus: 'unknown' });
    const fetchMock = vi.fn().mockResolvedValue(json({
      authenticated: false,
      user: null,
      refreshable: false,
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<NexyfabSessionHydrator />);

    await waitFor(() => expect(useAuthStore.getState().sessionStatus).toBe('anonymous'));
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session/', expect.objectContaining({
      credentials: 'include',
      cache: 'no-store',
    }));
  });

  it('hydrates an authenticated cookie-only session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ authenticated: true, user }));
    vi.stubGlobal('fetch', fetchMock);

    render(<NexyfabSessionHydrator />);

    await waitFor(() => expect(useAuthStore.getState().sessionStatus).toBe('authenticated'));
    expect(useAuthStore.getState().user).toEqual(user);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes only when the server confirms an httpOnly refresh cookie', async () => {
    let sessionReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) return json({ expiresIn: 900 });
      sessionReads += 1;
      if (sessionReads === 1) {
        return json({ authenticated: false, user: null, refreshable: true });
      }
      return json({ authenticated: true, user });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NexyfabSessionHydrator />);

    await waitFor(() => expect(useAuthStore.getState().sessionStatus).toBe('authenticated'));
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      '/api/auth/session/',
      '/api/auth/refresh/',
      '/api/auth/session/',
    ]);
  });

  it('throttles an immediate focus resync after the initial probe', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      authenticated: false,
      user: null,
      refreshable: false,
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NexyfabSessionHydrator />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => window.dispatchEvent(new Event('focus')));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
