/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';
import StudioChatDock from './StudioChatDock';

describe('StudioChatDock session consumption', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      token: null,
      sessionStatus: 'anonymous',
      isLoading: false,
      error: null,
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses the central anonymous state without issuing another session request', () => {
    render(<StudioChatDock lang="en" />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses an already-hydrated member plan without issuing another session request', () => {
    useAuthStore.setState({
      sessionStatus: 'authenticated',
      user: {
        id: 'user-1', email: 'user@example.com', name: 'User', plan: 'pro', projectCount: 0,
      },
    });
    render(<StudioChatDock lang="en" />);
    expect(fetch).not.toHaveBeenCalled();
  });
});
