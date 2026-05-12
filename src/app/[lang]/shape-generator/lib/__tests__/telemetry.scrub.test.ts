/**
 * Client telemetry PII scrub (Q9).
 *
 * Telemetry is fire-and-forget — once a payload leaves the browser we
 * can't take it back. These tests pin the redaction rules so a
 * future "let's log full context to debug" commit can't silently
 * leak emails / tokens / file paths.
 */

import { describe, it, expect } from 'vitest';
import { _testing } from '../telemetry';

const { scrubPii, scrubContext } = _testing;

describe('telemetry scrubPii', () => {
  it('redacts JWT-shaped strings', () => {
    const s = 'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(scrubPii(s)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(scrubPii(s)).toContain('[REDACTED_JWT]');
  });

  it('redacts emails', () => {
    expect(scrubPii('user gomd999@naver.com triggered error')).toContain('[REDACTED_EMAIL]');
    expect(scrubPii('user gomd999@naver.com triggered error')).not.toContain('gomd999');
  });

  it('redacts Bearer tokens', () => {
    expect(scrubPii('Authorization: Bearer abcdef0123456789xyz')).toContain('Bearer [REDACTED]');
  });

  it('scrubs Windows user paths', () => {
    expect(scrubPii('C:\\Users\\johndoe\\Documents\\part.nfab')).toBe('C:\\Users\\[USER]\\Documents\\part.nfab');
  });

  it('scrubs Unix user paths', () => {
    expect(scrubPii('/home/alice/projects/foo.nfab')).toBe('/home/[USER]/projects/foo.nfab');
    expect(scrubPii('/Users/alice/projects/foo.nfab')).toBe('/Users/[USER]/projects/foo.nfab');
  });

  it('leaves clean strings untouched', () => {
    expect(scrubPii('CSG empty result for fillet feature')).toBe('CSG empty result for fillet feature');
  });

  it('handles empty/null inputs', () => {
    expect(scrubPii('')).toBe('');
  });
});

describe('telemetry scrubContext', () => {
  it('redacts SCRUB_KEYS values entirely', () => {
    const out = scrubContext({ token: 'abc123', email: 'a@b.com', value: 5 });
    expect(out.token).toBe('[REDACTED]');
    expect(out.email).toBe('[REDACTED]');
    expect(out.value).toBe(5);
  });

  it('redacts string values for non-scrub keys via scrubPii', () => {
    const out = scrubContext({ message: 'failure for user@example.com' });
    expect(out.message).toContain('[REDACTED_EMAIL]');
  });

  it('recursively scrubs nested objects', () => {
    const out = scrubContext({
      outer: {
        token: 'secret',
        path: 'C:\\Users\\bob\\file.txt',
      },
    }) as Record<string, Record<string, string>>;
    expect(out.outer.token).toBe('[REDACTED]');
    expect(out.outer.path).toBe('C:\\Users\\[USER]\\file.txt');
  });

  it('truncates deeply nested objects', () => {
    const deep: Record<string, unknown> = { v: 1 };
    let cur = deep;
    for (let i = 0; i < 10; i++) {
      const next: Record<string, unknown> = { v: i };
      cur.next = next;
      cur = next;
    }
    const out = scrubContext(deep);
    // Walk down at most 4 levels — beyond that should be truncated.
    let pointer: Record<string, unknown> | undefined = out;
    let depth = 0;
    while (pointer && pointer.next && typeof pointer.next === 'object' && depth < 8) {
      pointer = pointer.next as Record<string, unknown>;
      depth++;
    }
    // Truncated marker exists somewhere down the chain
    expect(JSON.stringify(out)).toContain('_truncated');
  });

  it('preserves number/boolean values', () => {
    const out = scrubContext({ n: 5, b: true, neg: -1 });
    expect(out.n).toBe(5);
    expect(out.b).toBe(true);
    expect(out.neg).toBe(-1);
  });
});
