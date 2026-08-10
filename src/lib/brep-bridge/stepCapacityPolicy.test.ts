import { describe, expect, it } from 'vitest';
import { decideStepProcessingRoute } from './stepCapacityPolicy';

const MB = 1024 * 1024;

describe('decideStepProcessingRoute', () => {
  it('routes authenticated small files to synchronous server processing', () => {
    expect(decideStepProcessingRoute(3 * MB, { authenticated: true, serverEnabled: true }).route)
      .toBe('server-sync-inline');
  });

  it('routes authenticated medium files to the asynchronous inline server job', () => {
    expect(decideStepProcessingRoute(32 * MB, { authenticated: true, serverEnabled: true }).route)
      .toBe('server-async-inline');
  });

  it('keeps a 50 MB file in the bounded browser path when inline server capacity is exceeded', () => {
    expect(decideStepProcessingRoute(50 * MB, { authenticated: true, serverEnabled: true }).route)
      .toBe('browser-worker');
  });

  it('does not send large files to browser WASM or inline base64', () => {
    expect(decideStepProcessingRoute(51 * MB, { authenticated: true, serverEnabled: true }).route)
      .toBe('large-job-required');
    expect(decideStepProcessingRoute(417 * MB, { authenticated: true, serverEnabled: true }).route)
      .toBe('large-job-required');
  });

  it('rejects invalid and over-product-limit sizes', () => {
    expect(decideStepProcessingRoute(0, { authenticated: false, serverEnabled: false }).route)
      .toBe('unsupported-size');
    expect(decideStepProcessingRoute(513 * MB, { authenticated: true, serverEnabled: true }).route)
      .toBe('unsupported-size');
  });
});
