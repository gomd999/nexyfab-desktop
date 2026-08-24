import { describe, expect, it } from 'vitest';
import { canonicalCadConsumerDraftJson } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import { hashXcafCanonicalProjection, hashXcafGeometrySummary, hashXcafObjectId, hashXcafRevisionBinding, hashXcafSemantic, hashXcafDomain } from './xcafHash';

describe('XCAF hash domains', () => {
  it('is deterministic while separating equal values by domain', () => {
    const value = { b: 2, a: 1 };
    expect(hashXcafGeometrySummary(value)).toBe(hashXcafGeometrySummary({ a: 1, b: 2 }));
    expect(hashXcafGeometrySummary(value)).not.toBe(hashXcafSemantic(value));
    expect(hashXcafSemantic(value)).not.toBe(hashXcafCanonicalProjection(value));
    expect(hashXcafRevisionBinding(value)).not.toBe(hashXcafCanonicalProjection(value));
  });

  it('uses the canonical JSON contract and bounded IDs', () => {
    expect(canonicalCadConsumerDraftJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
    const id = hashXcafObjectId({ seed: 'x' });
    expect(id).toMatch(/^xcaf\.object\.[a-f0-9]{32}$/);
    expect(() => hashXcafObjectId({ seed: 'x' }, 8)).toThrow('xcaf_hash_characters_invalid');
    expect(() => hashXcafDomain('geometry-summary', { bad: undefined })).toThrow();
  });
});
