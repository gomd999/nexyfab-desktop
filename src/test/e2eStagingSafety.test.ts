import { describe, expect, it } from 'vitest';
import { assertStagingMutationSafety } from '../lib/staging-mutation-safety';

describe('staging mutation safety', () => {
  it('unconditionally rejects production', () => {
    expect(() => assertStagingMutationSafety({
      baseURL: 'https://nexyfab.com',
      confirmation: 'NEXYFAB_STAGING_MUTATIONS_ONLY',
      accountEmails: ['e2e-owner@test.nexyfab.com'],
    })).toThrow(/production/);
  });

  it('requires explicit confirmation on a staging host', () => {
    expect(() => assertStagingMutationSafety({
      baseURL: 'https://nexyfab-staging.example.com',
      accountEmails: ['e2e-owner@example.com'],
    })).toThrow(/E2E_STAGING_MUTATION_CONFIRM/);
  });

  it('rejects credentials outside the marked staging tenant', () => {
    expect(() => assertStagingMutationSafety({
      baseURL: 'http://127.0.0.1:3333',
      accountEmails: ['owner@example.com'],
    })).toThrow(/tenant marker/);
  });

  it('allows loopback with marked disposable accounts', () => {
    expect(assertStagingMutationSafety({
      baseURL: 'http://127.0.0.1:3333',
      accountEmails: ['e2e-owner@test.nexyfab.com'],
    }).origin).toBe('http://127.0.0.1:3333');
  });
});
