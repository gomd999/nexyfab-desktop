import { describe, it, expect } from 'vitest';
import { isAllowedStepFilename } from '@/lib/brep-bridge/validation';

describe('isAllowedStepFilename', () => {
  it('allows .step / .stp basename only', () => {
    expect(isAllowedStepFilename('part.step')).toBe(true);
    expect(isAllowedStepFilename('Part.STP')).toBe(true);
  });

  it('rejects path traversal and dirs', () => {
    expect(isAllowedStepFilename('../x.step')).toBe(false);
    expect(isAllowedStepFilename('a/b.step')).toBe(false);
  });

  it('rejects wrong extension', () => {
    expect(isAllowedStepFilename('x.stl')).toBe(false);
  });
});
