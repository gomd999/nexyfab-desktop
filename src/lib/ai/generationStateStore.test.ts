// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createGenerationRun, recordGenerationStage } from './generationRunState';
import { createServerGenerationState, MAX_GENERATION_STATE_BYTES, resetGenerationStateStoreForTests, saveServerGenerationState } from './generationStateStore';

describe('server generation state storage bounds', () => {
  beforeEach(() => resetGenerationStateStoreForTests());

  it('stores a normal server checkpoint and preserves its integrity', async () => {
    const state = recordGenerationStage(createGenerationRun('normal-state'), { stage: 'intent', input: { request: 'PT100' }, output: { requirements: ['typed route'] }, status: 'passed' });
    await expect(createServerGenerationState('owner:normal', state)).resolves.toMatchObject({ runId: 'normal-state', checkpointOutputs: { intent: { requirements: ['typed route'] } } });
  });

  it('rejects oversized checkpoint payloads before Redis or memory persistence', async () => {
    const state = createGenerationRun('oversized-state');
    state.checkpointOutputs = { intent: { text: 'x'.repeat(MAX_GENERATION_STATE_BYTES + 1) } };
    await expect(createServerGenerationState('owner:large', state)).rejects.toThrow('GENERATION_STATE_TOO_LARGE');
  });

  it('rejects ambiguous non-finite evidence instead of serializing it as null', async () => {
    const state = createGenerationRun('non-finite-state');
    state.checkpointOutputs = { intent: { lengthMm: Number.NaN } };
    await expect(createServerGenerationState('owner:nan', state)).rejects.toThrow(/non-finite/);
  });

  it('applies the same bound to compare-and-swap updates', async () => {
    const initial = createGenerationRun('save-bound');
    await createServerGenerationState('owner:save', initial);
    const next = structuredClone(initial);
    next.revision = 1;
    next.checkpointOutputs = { intent: { text: 'x'.repeat(MAX_GENERATION_STATE_BYTES + 1) } };
    await expect(saveServerGenerationState('owner:save', next, 0)).rejects.toThrow('GENERATION_STATE_TOO_LARGE');
  });

  it('never treats Redis or memory as authoritative commercial state', async () => {
    process.env.NEXYFAB_COMMERCIAL_MODE = '1';
    process.env.REDIS_URL = 'redis://configured-but-not-authoritative.invalid';
    try {
      await expect(createServerGenerationState('user:commercial', createGenerationRun('commercial-run'))).rejects.toThrow('GENERATION_STATE_POSTGRES_AUTHORITATIVE_REQUIRED');
    } finally {
      delete process.env.NEXYFAB_COMMERCIAL_MODE;
      delete process.env.REDIS_URL;
    }
  });
});
