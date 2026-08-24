import { describe, expect, it } from 'vitest';
import { directManipulationDigest } from './directManipulationDigest';

describe('direct manipulation artifact digest', () => {
  it('is deterministic across object key order and changes with content', () => {
    const first = directManipulationDigest({ intent: { delta: 2, unit: 'mm' }, revision: 'rev-1' });
    const reordered = directManipulationDigest({ revision: 'rev-1', intent: { unit: 'mm', delta: 2 } });
    const changed = directManipulationDigest({ revision: 'rev-1', intent: { unit: 'mm', delta: 3 } });
    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
