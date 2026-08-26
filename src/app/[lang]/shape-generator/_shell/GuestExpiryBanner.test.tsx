// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';
import { GUEST_NUDGE_AUTO_DISMISS_MS, GuestExpiryBanner } from './GuestExpiryBanner';

describe('GuestExpiryBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ user: null, token: null, sessionStatus: 'anonymous' });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('never intercepts CAD controls and removes the nudge after a readable interval', () => {
    render(<GuestExpiryBanner lang="ko" />);

    const nudge = screen.getByTestId('guest-mode-nudge');
    expect(nudge.style.pointerEvents).toBe('none');
    expect(screen.getByRole('button', { name: '지금 가입' }).style.pointerEvents).toBe('auto');
    expect(screen.getByRole('button', { name: '닫기' }).style.pointerEvents).toBe('auto');

    act(() => vi.advanceTimersByTime(GUEST_NUDGE_AUTO_DISMISS_MS));
    expect(screen.queryByTestId('guest-mode-nudge')).toBeNull();
  });
});
