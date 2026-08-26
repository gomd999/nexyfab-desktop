import { describe, expect, it } from 'vitest';
import { isDevShellAllowed } from './ShapeGeneratorApp';

describe('shape generator development shell gate', () => {
  it('blocks the mock shell in production', () => {
    expect(isDevShellAllowed('production')).toBe(false);
  });

  it.each(['development', 'test', undefined])('allows the mock shell in %s', nodeEnv => {
    expect(isDevShellAllowed(nodeEnv)).toBe(true);
  });
});
