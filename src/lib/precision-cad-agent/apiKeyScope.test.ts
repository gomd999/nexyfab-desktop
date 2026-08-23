import { describe, expect, it } from 'vitest';
import { hasPrecisionCadProjectScope } from './apiKeyScope';

describe('precision CAD project API-key scopes', () => {
  it('keeps cookie/JWT sessions on the project ACL path', () => {
    expect(hasPrecisionCadProjectScope({}, 'read:projects')).toBe(true);
    expect(hasPrecisionCadProjectScope({}, 'write:projects')).toBe(true);
  });

  it('requires explicit read/write scopes for bearer API keys', () => {
    const read = { apiKey: { id: 'read-key', scopes: ['read:projects'] } };
    const write = { apiKey: { id: 'write-key', scopes: ['write:projects'] } };
    expect(hasPrecisionCadProjectScope(read, 'read:projects')).toBe(true);
    expect(hasPrecisionCadProjectScope(read, 'write:projects')).toBe(false);
    expect(hasPrecisionCadProjectScope(write, 'read:projects')).toBe(false);
    expect(hasPrecisionCadProjectScope(write, 'write:projects')).toBe(true);
  });
});
