/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/hooks/useAuth';

vi.mock('next/navigation', () => ({
  useParams: () => ({ lang: 'en' }),
}));

import SSOSettingsPage from './page';

const configResponse = {
  config: {
    provider: 'saml',
    enabled: true,
    entityId: 'https://sp.example.test',
  },
};

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 'enterprise-user',
      email: 'enterprise@example.test',
      name: 'Enterprise User',
      plan: 'enterprise',
      projectCount: 0,
    },
    token: 'test-token',
    sessionStatus: 'authenticated',
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SSO settings commercial HOLD UI', () => {
  it('shows metadata-only status and never offers activation or connection testing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(configResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    render(<SSOSettingsPage />);

    expect(await screen.findByText('Commercial SSO is not yet released')).toBeInTheDocument();
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText('Test Connection')).not.toBeInTheDocument();
    expect(screen.getByText('Unavailable · Metadata staging only')).toBeInTheDocument();
  });

  it('forces staged metadata to remain disabled when saved', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(configResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, config: configResponse.config }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    render(<SSOSettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save disabled metadata' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ provider: 'saml', enabled: false });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/callback'))).toBe(false);
  });
});
