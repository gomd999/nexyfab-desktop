import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedIntent, setCachedIntent, _resetIntentCacheForTests } from '../intentCache';

describe('intentCache (in-memory LRU path)', () => {
  beforeEach(() => {
    // Force in-memory by clearing REDIS_URL — vitest sets process.env per-test.
    delete process.env.REDIS_URL;
    _resetIntentCacheForTests();
  });

  it('returns null on miss', async () => {
    const r = await getCachedIntent('nonexistent prompt');
    expect(r).toBeNull();
  });

  it('round-trips a value', async () => {
    await setCachedIntent('M8 hex bolt', {
      intent: { shapeId: 'bolt', params: { shaftDiameter: 8 } },
      scad: '// bolt scad',
      warnings: [],
      summary: 'M8 hex-head bolt',
    });
    const r = await getCachedIntent('M8 hex bolt');
    expect(r).not.toBeNull();
    expect(r?.scad).toBe('// bolt scad');
    expect(r?.summary).toBe('M8 hex-head bolt');
    expect(typeof r?.createdAt).toBe('number');
  });

  it('treats whitespace-trimmed prompts as identical (key normalization)', async () => {
    await setCachedIntent('  spacing test  ', {
      intent: {},
      scad: '// scad',
      warnings: [],
    });
    const r = await getCachedIntent('spacing test');
    expect(r).not.toBeNull();
  });

  it('different prompts get different cache slots', async () => {
    await setCachedIntent('prompt one', { intent: {}, scad: 'one', warnings: [] });
    await setCachedIntent('prompt two', { intent: {}, scad: 'two', warnings: [] });
    expect((await getCachedIntent('prompt one'))?.scad).toBe('one');
    expect((await getCachedIntent('prompt two'))?.scad).toBe('two');
  });
});
