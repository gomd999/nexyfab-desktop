/**
 * Q10 — Stage 2 (determinism) + Stage 3 (cache speed-up) tests.
 *
 * Stage 2: same intent → byte-identical SCAD output across calls; minor
 * key reordering or float jitter must not change the result.
 *
 * Stage 3: cached wrapper short-circuits repeat hits with measurable
 * speed-up and bounded memory growth.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  intentToScadCached,
  intentCacheKey,
  getCacheStats,
  resetIntentCache,
} from '../intentToScadCache';
import { intentToScad } from '../intentToScad';

describe('Stage 2 — intent → SCAD determinism', () => {
  it('same intent → byte-identical SCAD across 5 calls', () => {
    const intent = { shapeId: 'box', params: { width: 30, height: 20, depth: 10 } };
    const outputs = [];
    for (let i = 0; i < 5; i++) outputs.push(intentToScad(intent));
    for (let i = 1; i < outputs.length; i++) {
      expect(outputs[i].ok).toBe(true);
      expect(outputs[i]).toEqual(outputs[0]);
    }
  });

  it('intent with reordered keys produces same canonical cache key', () => {
    const a = intentCacheKey({ shapeId: 'box', params: { height: 20, width: 30, depth: 10 } });
    const b = intentCacheKey({ shapeId: 'box', params: { width: 30, depth: 10, height: 20 } });
    expect(a).toBe(b);
  });

  it('float jitter (≤ 1e-6) does not break cache key', () => {
    const a = intentCacheKey({ shapeId: 'box', params: { width: 30, height: 20, depth: 10 } });
    const b = intentCacheKey({ shapeId: 'box', params: { width: 30.0000003, height: 20, depth: 10 } });
    expect(a).toBe(b);
  });

  it('different params → different cache key', () => {
    const a = intentCacheKey({ shapeId: 'box', params: { width: 30, height: 20, depth: 10 } });
    const b = intentCacheKey({ shapeId: 'box', params: { width: 31, height: 20, depth: 10 } });
    expect(a).not.toBe(b);
  });

  it('NaN / Infinity in params are normalized so cache stays sane', () => {
    const a = intentCacheKey({ shapeId: 'box', params: { width: NaN, height: 20, depth: 10 } });
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('Stage 3 — intent cache hits', () => {
  beforeEach(() => resetIntentCache());

  it('first call is a miss, second is a hit', () => {
    intentToScadCached({ shapeId: 'box', params: { width: 30, height: 20, depth: 10 } });
    let stats = getCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);

    intentToScadCached({ shapeId: 'box', params: { width: 30, height: 20, depth: 10 } });
    stats = getCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
  });

  it('cached result is identical to fresh call', () => {
    const intent = { shapeId: 'cylinder', params: { diameter: 40, height: 25 } };
    const fresh = intentToScad(intent);
    const cached = intentToScadCached(intent);
    expect(cached).toEqual(fresh);
  });

  it('LRU eviction keeps cache size bounded under 1000 distinct intents', () => {
    for (let i = 0; i < 1000; i++) {
      intentToScadCached({ shapeId: 'box', params: { width: i + 1, height: 20, depth: 10 } });
    }
    const stats = getCacheStats();
    expect(stats.size).toBeLessThanOrEqual(256);
    expect(stats.misses).toBe(1000);
  });

  it('repeated calls do not allocate a new converter result each time', () => {
    // Speed is hard to assert reliably across CI runners — the SCAD
    // converter is sub-ms and clock jitter dominates. Instead pin the
    // observable contract: 100 cached calls produce 99 hits and 1 miss.
    const intent = { shapeId: 'box', params: { width: 30, height: 20, depth: 10 } };
    intentToScadCached(intent); // first miss
    for (let i = 0; i < 99; i++) intentToScadCached(intent);
    const stats = getCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(99);
    expect(stats.hitRate).toBeCloseTo(0.99, 2);
  });

  it('hit rate is measurable for ops dashboards', () => {
    intentToScadCached({ shapeId: 'box', params: { width: 30 } });
    intentToScadCached({ shapeId: 'box', params: { width: 30 } });
    intentToScadCached({ shapeId: 'box', params: { width: 30 } });
    const stats = getCacheStats();
    expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
  });
});
