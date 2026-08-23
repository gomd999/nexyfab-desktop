/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';
import { useSessionKeepalive } from './useSessionKeepalive';

describe('useSessionKeepalive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not probe refresh for unknown or anonymous sessions', () => {
    renderHook(() => useSessionKeepalive());
    act(() => {
      useAuthStore.setState({ sessionStatus: 'anonymous' });
      vi.advanceTimersByTime(30 * 60_000);
      window.dispatchEvent(new Event('focus'));
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('starts immediately once the central probe confirms authentication', () => {
    renderHook(() => useSessionKeepalive());

    act(() => useAuthStore.setState({ sessionStatus: 'authenticated', user: {
      id: 'user-1', email: 'user@example.com', name: 'User', plan: 'free', projectCount: 0,
    } }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/refresh', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    }));

    act(() => vi.advanceTimersByTime(12 * 60_000));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
