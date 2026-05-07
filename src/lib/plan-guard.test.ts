import { describe, it, expect } from 'vitest';
import { meetsPlan } from './plan-guard';

describe('meetsPlan', () => {
  it('free plan meets free requirement', () => {
    expect(meetsPlan('free', 'free')).toBe(true);
  });

  it('free plan does not meet pro requirement', () => {
    expect(meetsPlan('free', 'pro')).toBe(false);
  });

  it('pro plan meets free and pro requirements', () => {
    expect(meetsPlan('pro', 'free')).toBe(true);
    expect(meetsPlan('pro', 'pro')).toBe(true);
  });

  it('pro plan does not meet team requirement', () => {
    expect(meetsPlan('pro', 'team')).toBe(false);
  });

  it('enterprise plan meets all requirements', () => {
    expect(meetsPlan('enterprise', 'free')).toBe(true);
    expect(meetsPlan('enterprise', 'pro')).toBe(true);
    expect(meetsPlan('enterprise', 'team')).toBe(true);
    expect(meetsPlan('enterprise', 'enterprise')).toBe(true);
  });

  it('handles unknown plan gracefully (treated as free)', () => {
    // unknown plan falls back to rank 0 (=free), so meets 'free' but not 'pro'
    expect(meetsPlan('unknown' as any, 'free')).toBe(true);
    expect(meetsPlan('unknown' as any, 'pro')).toBe(false);
  });
});
