import { describe, expect, it } from 'vitest';
import { parsePromotionArgs } from './promote-domain-accuracy-candidates';

describe('domain candidate promotion CLI', () => {
  it('requires candidate and approval manifests', () => {
    expect(() => parsePromotionArgs([])).toThrow('--candidates');
    expect(() => parsePromotionArgs(['--candidates', 'candidates.json'])).toThrow('--approvals');
  });
  it('parses both manifest paths', () => {
    expect(parsePromotionArgs(['--candidates', 'c.json', '--approvals', 'a.json'])).toEqual({ candidatesFile: 'c.json', approvalsFile: 'a.json' });
  });
});

