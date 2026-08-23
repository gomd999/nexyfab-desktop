// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canonicalEvidenceJson, evidenceHashMatches, serverEvidenceSha256 } from './serverEvidence';

describe('server release evidence hashing', () => {
  it('is stable across object key order and produces a real SHA-256', () => {
    const left = { b: [2, 3], a: { value: 1 } };
    const right = { a: { value: 1 }, b: [2, 3] };
    expect(canonicalEvidenceJson(left)).toBe(canonicalEvidenceJson(right));
    expect(serverEvidenceSha256(left)).toBe(serverEvidenceSha256(right));
    expect(serverEvidenceSha256(left)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('detects mutation and rejects non-JSON evidence', () => {
    const source = { partId: 'p1', volumeMm3: 10 };
    const hash = serverEvidenceSha256(source);
    expect(evidenceHashMatches(source, hash)).toBe(true);
    expect(evidenceHashMatches({ ...source, volumeMm3: 11 }, hash)).toBe(false);
    expect(() => serverEvidenceSha256({ value: Number.NaN })).toThrow(/non-finite/);
  });
});
