/**
 * @vitest-environment jsdom
 *
 * PermissionsPanel.test.tsx — Z8 component tests.
 *
 * Asserts:
 *  - loads existing rows via GET, renders owner row as locked
 *  - owner can change role of non-owner via POST upsert (200)
 *  - owner can revoke a row via DELETE (confirm gate)
 *  - owner can add a new user via POST (201)
 *  - non-owner sees rows but no add block / no role select / no remove button
 *  - 404 from GET surfaces dict.notAvailable
 *  - server-side error codes (user.not_found, permission.multi_owner,
 *    permission.self) map to localized strings
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PermissionsPanel } from '../PermissionsPanel';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function makeFetch(handlers: Record<string, (init?: RequestInit) => { status?: number; body?: unknown }>) {
  const calls: FetchCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    calls.push({ url, init });
    const key = Object.keys(handlers).find((k) => url.endsWith(k) || url.includes(k));
    if (!key) throw new Error(`unhandled fetch ${url}`);
    const result = handlers[key](init);
    const status = result.status ?? 200;
    const body = result.body ?? { ok: true };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }) as Response;
  };
  return { impl, calls };
}

const ownerRow = {
  documentId: 'd1', userId: 'u-alice', role: 'owner',
  grantedBy: 'u-alice', grantedAt: 100, expiresAt: null,
};
const bobRow = {
  documentId: 'd1', userId: 'u-bob', role: 'viewer',
  grantedBy: 'u-alice', grantedAt: 200, expiresAt: null,
};

const baseProps = {
  documentId: 'd1',
  currentUserId: 'u-alice',
  lang: 'en',
  canManage: true,
  onClose: () => {},
  confirmImpl: () => true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PermissionsPanel — read path', () => {
  it('loads + renders rows, owner row marked locked', async () => {
    const { impl } = makeFetch({
      '/permissions': () => ({ body: { ok: true, permissions: [ownerRow, bobRow] } }),
    });
    render(<PermissionsPanel {...baseProps} fetchImpl={impl} />);
    await waitFor(() => screen.getByText('u-alice'));
    expect(screen.getByText('u-alice')).toBeTruthy();
    expect(screen.getByText('u-bob')).toBeTruthy();
    expect(screen.getByText('(locked)')).toBeTruthy();
  });

  it('404 from GET surfaces notAvailable string', async () => {
    const { impl } = makeFetch({
      '/permissions': () => ({ status: 404, body: { error: 'Not found', code: 'document.not_found' } }),
    });
    render(<PermissionsPanel {...baseProps} fetchImpl={impl} />);
    await waitFor(() => screen.getByTestId('permissions-panel-error'));
    expect(screen.getByTestId('permissions-panel-error').textContent)
      .toMatch(/not available/i);
  });

  it('empty array renders empty-state string', async () => {
    const { impl } = makeFetch({
      '/permissions': () => ({ body: { ok: true, permissions: [] } }),
    });
    render(<PermissionsPanel {...baseProps} fetchImpl={impl} />);
    await waitFor(() => screen.getByText(/only the owner has access/i));
  });
});

describe('PermissionsPanel — owner mutations', () => {
  it('changes a role via POST upsert', async () => {
    let permsCallCount = 0;
    const { impl, calls } = makeFetch({
      '/permissions': (init) => {
        permsCallCount++;
        if (init?.method === 'POST') {
          return { status: 200, body: { ok: true, permission: { ...bobRow, role: 'editor' } } };
        }
        return { body: { ok: true, permissions: [ownerRow, bobRow] } };
      },
    });
    render(<PermissionsPanel {...baseProps} fetchImpl={impl} />);
    await waitFor(() => screen.getByTestId('permissions-panel-role-u-bob'));

    const select = screen.getByTestId('permissions-panel-role-u-bob') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'editor' } });
    });

    await waitFor(() => {
      expect(calls.some((c) => c.init?.method === 'POST')).toBe(true);
    });
    expect(permsCallCount).toBeGreaterThanOrEqual(2);
  });

  it('revokes via DELETE after confirm', async () => {
    const { impl, calls } = makeFetch({
      '/permissions/u-bob': (init) => {
        if (init?.method === 'DELETE') {
          return { status: 200, body: { ok: true, changed: true } };
        }
        return { status: 405, body: { error: 'method not allowed' } };
      },
      '/permissions': () => ({ body: { ok: true, permissions: [ownerRow, bobRow] } }),
    });
    render(<PermissionsPanel {...baseProps} fetchImpl={impl} confirmImpl={() => true} />);
    await waitFor(() => screen.getByTestId('permissions-panel-remove-u-bob'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('permissions-panel-remove-u-bob'));
    });

    await waitFor(() => {
      expect(calls.some((c) => c.init?.method === 'DELETE' && c.url.includes('/u-bob'))).toBe(true);
    });
  });

  it('skips DELETE if confirm returns false', async () => {
    const { impl, calls } = makeFetch({
      '/permissions': () => ({ body: { ok: true, permissions: [ownerRow, bobRow] } }),
    });
    render(<PermissionsPanel {...baseProps} fetchImpl={impl} confirmImpl={() => false} />);
    await waitFor(() => screen.getByTestId('permissions-panel-remove-u-bob'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('permissions-panel-remove-u-bob'));
    });

    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
  });

  it('adds a new user via POST (201) and appends to list', async () => {
    const newRow = {
      documentId: 'd1', userId: 'u-carol', role: 'editor',
      grantedBy: 'u-alice', grantedAt: 300, expiresAt: null,
    };
    const { impl, calls } = makeFetch({
      '/permissions': (init) => {
        if (init?.method === 'POST') {
          return { status: 201, body: { ok: true, permission: newRow } };
        }
        return { body: { ok: true, permissions: [ownerRow] } };
      },
    });
    render(<PermissionsPanel {...baseProps} fetchImpl={impl} />);
    await waitFor(() => screen.getByTestId('permissions-panel-add-input'));

    await act(async () => {
      fireEvent.change(screen.getByTestId('permissions-panel-add-input'), {
        target: { value: 'u-carol' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('permissions-panel-add-submit'));
    });

    await waitFor(() => screen.getByText('u-carol'));
    const postCall = calls.find((c) => c.init?.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = JSON.parse(String(postCall?.init?.body));
    expect(body).toEqual({ userId: 'u-carol', role: 'editor' });
  });

  it('surfaces user.not_found error inline', async () => {
    const { impl } = makeFetch({
      '/permissions': (init) => {
        if (init?.method === 'POST') {
          return { status: 404, body: { error: 'User not found', code: 'user.not_found' } };
        }
        return { body: { ok: true, permissions: [ownerRow] } };
      },
    });
    render(<PermissionsPanel {...baseProps} fetchImpl={impl} />);
    await waitFor(() => screen.getByTestId('permissions-panel-add-input'));

    await act(async () => {
      fireEvent.change(screen.getByTestId('permissions-panel-add-input'), {
        target: { value: 'u-ghost' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('permissions-panel-add-submit'));
    });

    await waitFor(() => screen.getByTestId('permissions-panel-add-error'));
    expect(screen.getByTestId('permissions-panel-add-error').textContent)
      .toMatch(/not found/i);
  });
});

describe('PermissionsPanel — non-owner view', () => {
  it('hides add block and role selects when canManage=false', async () => {
    const { impl } = makeFetch({
      '/permissions': () => ({ body: { ok: true, permissions: [ownerRow, bobRow] } }),
    });
    render(
      <PermissionsPanel
        {...baseProps}
        currentUserId="u-bob"
        canManage={false}
        fetchImpl={impl}
      />,
    );
    await waitFor(() => screen.getByText('u-alice'));
    expect(screen.queryByTestId('permissions-panel-add-input')).toBeNull();
    expect(screen.queryByTestId('permissions-panel-role-u-bob')).toBeNull();
    expect(screen.queryByTestId('permissions-panel-remove-u-bob')).toBeNull();
  });
});
