import { describe, it, expect } from 'vitest';
import {
  tryProviders,
  AllProvidersFailedError,
  LatencyTracker,
  withRegressionGuard,
} from './latencyGuard';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('tryProviders', () => {
  it('returns first successful provider', async () => {
    const r = await tryProviders(
      [
        { name: 'a', invoke: async () => 'A' },
        { name: 'b', invoke: async () => 'B' },
      ],
      { attemptMs: 100 },
    );
    expect(r).toBe('A');
  });

  it('falls through to next provider on failure', async () => {
    const r = await tryProviders(
      [
        { name: 'a', invoke: async () => { throw new Error('boom'); } },
        { name: 'b', invoke: async () => 'B' },
      ],
      { attemptMs: 100 },
    );
    expect(r).toBe('B');
  });

  it('aborts long calls via timeout', async () => {
    const r = await tryProviders(
      [
        {
          name: 'a',
          invoke: (signal) => new Promise<string>((_, rej) => {
            signal.addEventListener('abort', () => rej(new Error('aborted')));
          }),
        },
        { name: 'b', invoke: async () => 'fallback' },
      ],
      { attemptMs: 50 },
    );
    expect(r).toBe('fallback');
  });

  it('throws AllProvidersFailedError when nothing works', async () => {
    await expect(
      tryProviders(
        [
          { name: 'a', invoke: async () => { throw new Error('1'); } },
          { name: 'b', invoke: async () => { throw new Error('2'); } },
        ],
        { attemptMs: 50 },
      ),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it('records onAttempt for each call', async () => {
    const log: Array<[string, boolean]> = [];
    await tryProviders(
      [
        { name: 'a', invoke: async () => { throw new Error('x'); } },
        { name: 'b', invoke: async () => 'ok' },
      ],
      { attemptMs: 100 },
      (name, _ms, ok) => { log.push([name, ok]); },
    );
    expect(log).toEqual([['a', false], ['b', true]]);
  });
});

describe('LatencyTracker', () => {
  it('reports p50 / p95 / p99', () => {
    const t = new LatencyTracker();
    for (let i = 1; i <= 100; i++) t.record(i);
    expect(t.p50()).toBeGreaterThan(40);
    expect(t.p50()).toBeLessThan(60);
    expect(t.p95()).toBeGreaterThan(90);
    expect(t.p99()).toBeGreaterThan(95);
  });

  it('windows old samples out', () => {
    const t = new LatencyTracker(10);
    for (let i = 0; i < 50; i++) t.record(i);
    expect(t.count()).toBe(10);
  });

  it('returns 0 when empty', () => {
    const t = new LatencyTracker();
    expect(t.p50()).toBe(0);
  });
});

describe('withRegressionGuard', () => {
  it('fires onRegression when p95 drifts past baseline+threshold', async () => {
    const tracker = new LatencyTracker();
    let fired = false;
    // Pre-fill 60 fast samples.
    for (let i = 0; i < 60; i++) tracker.record(50);
    for (let i = 0; i < 5; i++) {
      await withRegressionGuard(
        async () => { await sleep(200); return null; },
        { tracker, baselineMs: 50, regressionMs: 50, onRegression: () => { fired = true; } },
      );
    }
    expect(fired).toBe(true);
  });

  it('does not fire below the threshold', async () => {
    const tracker = new LatencyTracker();
    let fired = false;
    for (let i = 0; i < 60; i++) tracker.record(50);
    await withRegressionGuard(
      async () => null,
      { tracker, baselineMs: 50, regressionMs: 500, onRegression: () => { fired = true; } },
    );
    expect(fired).toBe(false);
  });
});
