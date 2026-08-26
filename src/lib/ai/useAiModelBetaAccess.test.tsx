// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('useAiModelBetaAccess', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('unlocks the client catalog from runtime access when the build flag is stale', async () => {
    vi.stubEnv('NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS', '0');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const { useAiModelBetaAccess } = await import('./useAiModelBetaAccess');

    const { result } = renderHook(() => useAiModelBetaAccess());
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/nexyfab/ai-model-access/', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });
});
