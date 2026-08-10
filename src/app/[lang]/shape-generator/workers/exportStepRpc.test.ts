import { describe, expect, it, vi } from 'vitest';
import { handleExportStepRequest } from './exportStepRpc';

describe('worker STEP export RPC', () => {
  it('preserves requestId and returns exact STEP text', async () => {
    const exporter = vi.fn(async (handle: string) => `ISO-10303-21;\n/* ${handle} */\nEND-ISO-10303-21;`);
    const result = await handleExportStepRequest({ requestId: 7, handle: 'occt:9' }, exporter);
    expect(exporter).toHaveBeenCalledWith('occt:9');
    expect(result).toEqual({
      type: 'EXPORT_STEP_RESULT',
      requestId: 7,
      stepText: 'ISO-10303-21;\n/* occt:9 */\nEND-ISO-10303-21;',
    });
  });

  it('fails closed for malformed requests and exporter failures', async () => {
    expect(await handleExportStepRequest({ requestId: -1, handle: '' }, vi.fn())).toEqual({
      type: 'EXPORT_STEP_RESULT', requestId: -1, stepText: null,
    });
    expect(await handleExportStepRequest(
      { requestId: 8, handle: 'occt:missing' },
      async () => { throw new Error('missing'); },
    )).toEqual({ type: 'EXPORT_STEP_RESULT', requestId: 8, stepText: null });
  });
});
