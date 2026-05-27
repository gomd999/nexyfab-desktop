import { describe, it, expect } from 'vitest';
import { withOcctRetry, withOcctRetrySync } from './occtRetry';

describe('withOcctRetrySync · first attempt succeeds', () => {
  it('returns immediately with attempts.length=1', () => {
    const r = withOcctRetrySync((tol) => `ok at ${tol}`, { baseTolerance: 0.01 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe('ok at 0.01');
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].error).toBeNull();
  });
});

describe('withOcctRetrySync · retry on failure', () => {
  it('retries with relaxed tolerance and succeeds on attempt 2', () => {
    let calls = 0;
    const r = withOcctRetrySync((tol) => {
      calls++;
      if (tol < 0.05) throw new Error('tight');
      return tol;
    }, { baseTolerance: 0.01, relaxFactor: 10 });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0].error?.message).toBe('tight');
    expect(r.attempts[1].error).toBeNull();
    expect(r.value).toBeCloseTo(0.1, 5);
  });

  it('reports all attempts and the final error when max attempts exhausted', () => {
    const r = withOcctRetrySync(() => {
      throw new Error('permanent');
    }, { baseTolerance: 0.001, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(r.attempts).toHaveLength(3);
    expect(r.finalError?.message).toBe('permanent');
  });

  it('tolerance multiplies by relaxFactor each attempt', () => {
    const tolerances: number[] = [];
    withOcctRetrySync((tol) => {
      tolerances.push(tol);
      throw new Error('fail');
    }, { baseTolerance: 0.001, relaxFactor: 5, maxAttempts: 4 });
    expect(tolerances).toEqual([0.001, 0.005, 0.025, 0.125]);
  });

  it('default relaxFactor = 10 and default maxAttempts = 3', () => {
    const tolerances: number[] = [];
    const r = withOcctRetrySync((tol) => {
      tolerances.push(tol);
      throw new Error('fail');
    }, { baseTolerance: 0.001 });
    expect(tolerances).toEqual([0.001, 0.01, 0.1]);
    expect(r.attempts).toHaveLength(3);
  });

  it('wraps a non-Error throw value into a real Error', () => {
    const r = withOcctRetrySync(() => {
      throw 'plain string';
    }, { baseTolerance: 0.01, maxAttempts: 1 });
    expect(r.finalError).toBeInstanceOf(Error);
    expect(r.finalError?.message).toBe('plain string');
  });

  it('caps attempts at the configured maximum (no off-by-one)', () => {
    const r = withOcctRetrySync(() => {
      throw new Error('x');
    }, { baseTolerance: 0.01, maxAttempts: 5 });
    expect(r.attempts).toHaveLength(5);
  });

  it('treats maxAttempts < 1 as 1 (sanity floor)', () => {
    const r = withOcctRetrySync(() => 42, { baseTolerance: 0.01, maxAttempts: 0 });
    expect(r.attempts).toHaveLength(1); // floor to 1
    expect(r.ok).toBe(true);
  });
});

describe('withOcctRetry · async variant', () => {
  it('awaits async operations correctly', async () => {
    const r = await withOcctRetry(async (tol) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return tol * 2;
    }, { baseTolerance: 0.01 });
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(0.02, 5);
  });

  it('retries async operations on rejection', async () => {
    let calls = 0;
    const r = await withOcctRetry(async (tol) => {
      calls++;
      if (tol < 0.05) throw new Error('tight');
      return 'ok';
    }, { baseTolerance: 0.01, relaxFactor: 10 });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
