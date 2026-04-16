import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock ioredis so require('ioredis') doesn't fail and Redis path is skipped
vi.mock('ioredis', () => ({ default: vi.fn() }));

// We need a fresh module for each test to reset the in-memory Map
describe('rateLimit', () => {
  let rateLimit: typeof import('../rate-limit').rateLimit;

  beforeEach(async () => {
    // Clear module cache to reset in-memory counts Map
    vi.resetModules();
    // Ensure no REDIS_URL so it stays in-memory mode
    delete process.env.REDIS_URL;
    const mod = await import('../rate-limit');
    rateLimit = mod.rateLimit;
  });

  it('allows requests under the limit', () => {
    const result = rateLimit('test-key-1', 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('decrements remaining with each request', () => {
    rateLimit('test-key-2', 3, 60_000);
    const r2 = rateLimit('test-key-2', 3, 60_000);
    expect(r2.remaining).toBe(1);
    const r3 = rateLimit('test-key-2', 3, 60_000);
    expect(r3.remaining).toBe(0);
    expect(r3.allowed).toBe(true);
  });

  it('blocks requests over the limit', () => {
    rateLimit('test-key-3', 2, 60_000);
    rateLimit('test-key-3', 2, 60_000);
    const blocked = rateLimit('test-key-3', 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after window expires', () => {
    // Use a very short window
    const result1 = rateLimit('test-key-4', 1, 1); // 1ms window
    expect(result1.allowed).toBe(true);

    // The entry should expire almost immediately; advance time
    vi.useFakeTimers();
    vi.advanceTimersByTime(10);

    const result2 = rateLimit('test-key-4', 1, 1);
    expect(result2.allowed).toBe(true);

    vi.useRealTimers();
  });

  it('tracks separate keys independently', () => {
    rateLimit('key-a', 1, 60_000);
    const blockedA = rateLimit('key-a', 1, 60_000);
    const allowedB = rateLimit('key-b', 1, 60_000);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });
});
