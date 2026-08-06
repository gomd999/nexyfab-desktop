import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOpenScadExecutable } from './resolveOpenScadExecutable';

afterEach(() => vi.unstubAllEnvs());

describe('resolveOpenScadExecutable', () => {
  it('keeps an explicit deployment path authoritative', () => {
    vi.stubEnv('OPENSCAD_BIN', 'D:\\tools\\openscad.com');
    expect(resolveOpenScadExecutable()).toBe('D:\\tools\\openscad.com');
  });
});
