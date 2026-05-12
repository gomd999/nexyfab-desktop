import { describe, it, expect } from 'vitest';
import { scrubValue } from '../error-capture';

describe('scrubValue', () => {
  it('redacts JWT-shaped strings', () => {
    const out = scrubValue({
      msg: 'token: eyAAAAAAAAAAAAAAA.eyBBBBBBBBBBBBBBB.signature_xxxxxxxxx still here',
    }) as Record<string, string>;
    expect(out.msg).toContain('[REDACTED_JWT]');
    expect(out.msg).not.toContain('eyAAAAAAAAA');
  });

  it('redacts email-shaped strings', () => {
    const out = scrubValue({ note: 'user is leak@example.com' }) as Record<string, string>;
    expect(out.note).toContain('[REDACTED_EMAIL]');
    expect(out.note).not.toContain('leak@example.com');
  });

  it('redacts Bearer tokens in messages', () => {
    const out = scrubValue({ auth: 'Authorization: Bearer abcdef0123456789ABCDEF' }) as Record<string, string>;
    expect(out.auth).toContain('Bearer [REDACTED]');
  });

  it('redacts entire value for keys matching SCRUB_KEYS', () => {
    const out = scrubValue({
      Authorization: 'whatever',
      cookie: 'sid=xyz',
      apiKey: 'k_abc',
      sessionId: 'sess-1',
      Password: 'pw',
      kept: 'fine',
    }) as Record<string, string>;
    expect(out.Authorization).toBe('[REDACTED]');
    expect(out.cookie).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.sessionId).toBe('[REDACTED]');
    expect(out.Password).toBe('[REDACTED]');
    expect(out.kept).toBe('fine');
  });

  it('recurses into nested objects + arrays', () => {
    const out = scrubValue({
      meta: { user: 'a@b.com', list: ['Bearer abcdef0123456789ABCDEF', 'plain'] },
    }) as { meta: { user: string; list: string[] } };
    expect(out.meta.user).toBe('[REDACTED_EMAIL]');
    expect(out.meta.list[0]).toContain('Bearer [REDACTED]');
    expect(out.meta.list[1]).toBe('plain');
  });

  it('handles cycles without recursing forever', () => {
    interface Cyc { a: number; self?: unknown }
    const a: Cyc = { a: 1 };
    a.self = a;
    const out = scrubValue(a) as { a: number; self: string };
    expect(out.a).toBe(1);
    expect(out.self).toBe('[CYCLE]');
  });

  it('truncates very deep trees', () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 12; i++) deep = { next: deep };
    const out = scrubValue(deep);
    expect(JSON.stringify(out)).toContain('[TRUNCATED]');
  });

  it('passes through primitives unchanged', () => {
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
    expect(scrubValue(null)).toBe(null);
    expect(scrubValue(undefined)).toBe(undefined);
  });

  it('preserves non-redacted strings verbatim', () => {
    expect(scrubValue('Hello world — no PII here')).toBe('Hello world — no PII here');
  });
});
