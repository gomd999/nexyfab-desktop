import { describe, expect, it } from 'vitest';
import { resolveAssemblyFocusPartIds } from './assemblyFocusEvent';

describe('assembly evidence focus resolution', () => {
  it('prefers the latest AI source-to-document map over a colliding existing id', () => {
    const result = resolveAssemblyFocusPartIds(['motor', 'arm'], new Set(['motor', 'motor_2', 'arm_2']), new Map([['motor', 'motor_2'], ['arm', 'arm_2']]));
    expect(result).toEqual({ selectedPartIds: ['motor_2', 'arm_2'], missingPartIds: [] });
  });

  it('deduplicates requests and reports missing source ids without mutation', () => {
    const result = resolveAssemblyFocusPartIds(['a', 'a', '', 'missing'], new Set(['a']), new Map());
    expect(result).toEqual({ selectedPartIds: ['a'], missingPartIds: ['missing'] });
  });
});
