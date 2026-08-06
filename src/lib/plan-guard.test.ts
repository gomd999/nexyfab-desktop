import { describe, it, expect } from 'vitest';
import { meetsPlan, PLAN_MONTHLY_LIMITS } from './plan-guard';

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
    expect(meetsPlan('unknown', 'free')).toBe(true);
    expect(meetsPlan('unknown', 'pro')).toBe(false);
  });
});

describe('AI trial limits', () => {
  it('keeps the SCAD agent usable for free trial accounts', () => {
    expect(PLAN_MONTHLY_LIMITS.free.scad_agent).toBe(10);
  });
});
