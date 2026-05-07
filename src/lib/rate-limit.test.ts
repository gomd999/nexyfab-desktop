import { describe, it, expect, beforeEach, vi } from 'vitest';

// rate-limit 모듈을 매 테스트마다 새로 로드
describe('rateLimit', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should allow requests within limit', async () => {
    const { rateLimit } = await import('./rate-limit');
    const result = rateLimit('test-key', 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('should block after exceeding limit', async () => {
    const { rateLimit } = await import('./rate-limit');
    rateLimit('block-test', 2, 60_000);
    rateLimit('block-test', 2, 60_000);
    const result = rateLimit('block-test', 2, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should reset after window expires', async () => {
    vi.useFakeTimers();
    const { rateLimit } = await import('./rate-limit');
    rateLimit('expire-test', 1, 1_000);
    rateLimit('expire-test', 1, 1_000); // blocked

    vi.advanceTimersByTime(1_001);

    const result = rateLimit('expire-test', 1, 1_000);
    expect(result.allowed).toBe(true);
    vi.useRealTimers();
  });

  it('should track different keys independently', async () => {
    const { rateLimit } = await import('./rate-limit');
    rateLimit('key-a', 1, 60_000);
    const resultB = rateLimit('key-b', 1, 60_000);
    expect(resultB.allowed).toBe(true);
  });
});
