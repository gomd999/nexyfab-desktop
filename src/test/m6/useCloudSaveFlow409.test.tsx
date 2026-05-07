/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { waitFor } from '@testing-library/dom';
import { useCloudSaveFlow } from '@/app/[lang]/shape-generator/useCloudSaveFlow';
import { useCloudProjectAccessStore } from '@/app/[lang]/shape-generator/store/cloudProjectAccessStore';
import { PREF_KEYS } from '@/lib/platform';
import type { AutoSaveState } from '@/app/[lang]/shape-generator/useAutoSave';

const baseState: AutoSaveState = {
  version: 1,
  timestamp: 0,
  selectedId: 's',
  params: {},
  features: [],
  isSketchMode: false,
  activeTab: 'design',
};

describe('useCloudSaveFlow 409', () => {
  beforeEach(() => {
    localStorage.clear();
    useCloudProjectAccessStore.getState().reset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PATCH 409 PROJECT_VERSION_CONFLICT sets versionConflictNeedsReload and error', async () => {
    localStorage.setItem(PREF_KEYS.cloudProjectId, 'pid-409');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/nexyfab/projects/pid-409') && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            code: 'PROJECT_VERSION_CONFLICT',
            error: 'Version conflict',
            serverUpdatedAt: 1_700_000_000_050,
            clientExpected: 1_700_000_000_000,
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCloudSaveFlow(true));
    await act(async () => {
      result.current.adoptProjectId('pid-409', 1_700_000_000_000);
    });
    await act(async () => {
      result.current.syncNow(baseState, 'shape1', 'mat1');
    });
    await waitFor(() => expect(result.current.versionConflictNeedsReload).toBe(true));
    expect(result.current.cloudStatus).toBe('error');
    expect(result.current.cloudError).toMatch(/Version conflict/i);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { ifMatchUpdatedAt?: number };
    expect(body.ifMatchUpdatedAt).toBe(1_700_000_000_000);
  });

  it('after 409, next PATCH sends ifMatchUpdatedAt from serverUpdatedAt; success clears conflict', async () => {
    localStorage.setItem(PREF_KEYS.cloudProjectId, 'pid-409');
    let patchN = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes('/api/nexyfab/projects/pid-409') || init?.method !== 'PATCH') {
        return new Response('{}', { status: 500 });
      }
      patchN += 1;
      if (patchN === 1) {
        return new Response(
          JSON.stringify({
            code: 'PROJECT_VERSION_CONFLICT',
            error: 'Version conflict',
            serverUpdatedAt: 1_700_000_000_050,
            clientExpected: 1_700_000_000_000,
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const body = JSON.parse(init.body as string) as { ifMatchUpdatedAt?: number };
      expect(body.ifMatchUpdatedAt).toBe(1_700_000_000_050);
      return new Response(
        JSON.stringify({ project: { id: 'pid-409', updatedAt: 1_700_000_000_050 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCloudSaveFlow(true));
    await act(async () => {
      result.current.adoptProjectId('pid-409', 1_700_000_000_000);
    });
    await act(async () => {
      result.current.syncNow(baseState, 'shape1', 'mat1');
    });
    await waitFor(() => expect(result.current.versionConflictNeedsReload).toBe(true));

    await act(async () => {
      result.current.syncNow(baseState, 'shape1', 'mat1');
    });
    await waitFor(() => expect(result.current.cloudStatus).toBe('synced'));
    expect(result.current.versionConflictNeedsReload).toBe(false);
    expect(patchN).toBe(2);
  });
});
