import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('GET /api/nexyfab/ai-model-access', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('publishes runtime no-payment beta access without exposing credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS', '1');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      schema: 'nexyfab.ai-model-access.v1',
      enabled: true,
      mode: 'no_payment_beta_all_models',
    });
  });

  it('falls back to plan entitlement when beta access is disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS', '0');
    const response = await GET();
    expect(await response.json()).toMatchObject({
      enabled: false,
      mode: 'plan_entitlement',
    });
  });
});
