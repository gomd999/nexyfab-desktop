import { describe, it, expect } from 'vitest';
import { checkOrigin } from '../csrf';

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/test', { headers });
}

describe('checkOrigin', () => {
  it('passes when origin matches host (same-origin)', () => {
    const req = makeRequest({
      origin: 'https://example.com',
      host: 'example.com',
    });
    expect(checkOrigin(req)).toBe(true);
  });

  it('passes when no origin header (server-to-server)', () => {
    const req = makeRequest({ host: 'example.com' });
    expect(checkOrigin(req)).toBe(true);
  });

  it('fails when origin does not match host', () => {
    const req = makeRequest({
      origin: 'https://evil.com',
      host: 'example.com',
    });
    expect(checkOrigin(req)).toBe(false);
  });

  it('fails when sec-fetch-site is cross-site', () => {
    const req = makeRequest({
      'sec-fetch-site': 'cross-site',
      origin: 'https://example.com',
      host: 'example.com',
    });
    expect(checkOrigin(req)).toBe(false);
  });

  it('passes when sec-fetch-site is same-origin', () => {
    const req = makeRequest({
      'sec-fetch-site': 'same-origin',
      origin: 'https://example.com',
      host: 'example.com',
    });
    expect(checkOrigin(req)).toBe(true);
  });

  it('passes when sec-fetch-site is none (e.g. direct navigation)', () => {
    const req = makeRequest({
      'sec-fetch-site': 'none',
      origin: 'https://example.com',
      host: 'example.com',
    });
    expect(checkOrigin(req)).toBe(true);
  });

  it('allows localhost dev origins', () => {
    const req = makeRequest({
      origin: 'http://localhost:3000',
      host: 'example.com',
    });
    expect(checkOrigin(req)).toBe(true);
  });

  it('fails on malformed origin URL', () => {
    const req = makeRequest({
      origin: 'not-a-url',
      host: 'example.com',
    });
    expect(checkOrigin(req)).toBe(false);
  });
});
