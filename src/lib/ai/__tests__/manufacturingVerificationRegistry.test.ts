import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearManufacturingVerificationRegistryForTests,
  isVerifiedManufacturingHandle,
  registerVerifiedManufacturingHandle,
  revokeVerifiedManufacturingHandle,
} from '../manufacturingVerificationRegistry';

describe('manufacturing verification registry', () => {
  beforeEach(clearManufacturingVerificationRegistryForTests);

  it('accepts only registered handles', () => {
    expect(isVerifiedManufacturingHandle('occt:1', 100)).toBe(false);
    registerVerifiedManufacturingHandle('occt:1', 100);
    expect(isVerifiedManufacturingHandle('occt:1', 101)).toBe(true);
    expect(isVerifiedManufacturingHandle('occt:2', 101)).toBe(false);
  });

  it('can revoke a verdict after a failed recheck', () => {
    registerVerifiedManufacturingHandle('occt:1', 100);
    revokeVerifiedManufacturingHandle('occt:1');
    expect(isVerifiedManufacturingHandle('occt:1', 101)).toBe(false);
  });

  it('expires verdicts', () => {
    registerVerifiedManufacturingHandle('occt:1', 100);
    expect(isVerifiedManufacturingHandle('occt:1', 100 + 31 * 60 * 1000)).toBe(false);
  });
});
