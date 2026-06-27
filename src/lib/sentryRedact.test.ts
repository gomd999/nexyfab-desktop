/**
 * Sentry PII redaction — security-critical guard: tokens/emails must never reach
 * Sentry. Tests the shared scrubbers used by both instrumentation beforeSend hooks.
 */
import { describe, it, expect } from 'vitest';
import { scrubString, scrubDeep, scrubEvent } from './sentryRedact';

const JWT = 'eyJhbGciOiJIUzI1Ni19.eyJzdWIiOiIxMjM0NTY3ODkw.SflKxwRJSMeKKF2QT4fwpMeJf36';

describe('scrubString', () => {
  it('redacts JWTs, emails, and Bearer tokens', () => {
    expect(scrubString(`token=${JWT}`)).toContain('[REDACTED_JWT]');
    expect(scrubString(`token=${JWT}`)).not.toContain('eyJhbG');
    expect(scrubString('contact alice@example.com now')).toBe('contact [REDACTED_EMAIL] now');
    expect(scrubString('Authorization: Bearer abcdef0123456789ABCDEF')).toContain('Bearer [REDACTED]');
  });
  it('passes through clean strings and non-strings unchanged', () => {
    expect(scrubString('hello world 42')).toBe('hello world 42');
    expect(scrubString(42)).toBe(42);
    expect(scrubString(null)).toBe(null);
  });
});

describe('scrubDeep', () => {
  it('redacts nested objects and arrays', () => {
    const out = scrubDeep({ a: { b: [`x ${JWT}`, 'bob@corp.io'] }, n: 5 }) as { a: { b: string[] }; n: number };
    expect(out.a.b[0]).toContain('[REDACTED_JWT]');
    expect(out.a.b[1]).toBe('[REDACTED_EMAIL]');
    expect(out.n).toBe(5);
  });
  it('stops at depth 4 (no infinite recursion on cycles)', () => {
    expect(() => scrubDeep({ a: { b: { c: { d: { e: { f: 'x' } } } } } })).not.toThrow();
  });
});

describe('scrubEvent', () => {
  it('scrubs message/extra, strips user to id, drops cookies, redacts query', () => {
    const ev = scrubEvent({
      message: `failed for jane@x.com`,
      extra: { headers: `Bearer abcdef0123456789ABCDEF` },
      user: { id: 'u1', email: 'jane@x.com', ip_address: '1.2.3.4' },
      request: { cookies: { session: 'secret' }, query_string: `t=${JWT}` },
    });
    expect(ev.message).toContain('[REDACTED_EMAIL]');
    expect(JSON.stringify(ev.extra)).toContain('Bearer [REDACTED]');
    expect(ev.user).toEqual({ id: 'u1' });            // email + ip dropped
    expect(ev.request!.cookies).toBeUndefined();
    expect(ev.request!.query_string).toContain('[REDACTED_JWT]');
  });
  it('never throws on a malformed event', () => {
     
    expect(() => scrubEvent({} as any)).not.toThrow();
  });
});
