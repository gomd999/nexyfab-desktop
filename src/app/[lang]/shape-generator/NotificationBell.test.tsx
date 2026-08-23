/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/shape-generator',
  useRouter: () => ({ push: vi.fn() }),
}));

import NotificationBell from './NotificationBell';
import NexyfabNotificationBell from '@/app/components/NexyfabNotificationBell';
import SidebarNotificationBell from '@/components/nexyfab/NotificationBell';

class FakeEventSource {
  static created = 0;
  onerror: (() => void) | null = null;
  constructor(_url: string) { FakeEventSource.created += 1; }
  addEventListener(): void {}
  close(): void {}
}

function notificationsResponse(): Response {
  return new Response(JSON.stringify({ notifications: [], unreadCount: 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('notification auth gating', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      token: null,
      sessionStatus: 'anonymous',
      isLoading: false,
      error: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notificationsResponse()));
    FakeEventSource.created = 0;
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders guest bells without calling the protected notifications API', async () => {
    render(<>
      <NotificationBell lang="en" />
      <NexyfabNotificationBell />
      <SidebarNotificationBell lang="en" token="stale-token" />
    </>);
    await act(async () => Promise.resolve());

    expect(fetch).not.toHaveBeenCalled();
    expect(FakeEventSource.created).toBe(0);
  });

  it('starts loading notifications after the session becomes authenticated', async () => {
    render(<>
      <NotificationBell lang="en" />
      <NexyfabNotificationBell />
      <SidebarNotificationBell lang="en" token="member-token" />
    </>);

    act(() => useAuthStore.setState({
      sessionStatus: 'authenticated',
      user: { id: 'user-1', email: 'user@example.com', name: 'User', plan: 'free', projectCount: 0 },
    }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(vi.mocked(fetch).mock.calls.every(call => String(call[0]) === '/api/nexyfab/notifications')).toBe(true);
    expect(FakeEventSource.created).toBe(1);
  });
});
