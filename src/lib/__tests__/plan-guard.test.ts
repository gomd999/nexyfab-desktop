import { describe, it, expect } from 'vitest';
import { meetsPlan } from '../plan-guard';

describe('meetsPlan', () => {
  it('free meets free only', () => {
    expect(meetsPlan('free', 'free')).toBe(true);
    expect(meetsPlan('free', 'pro')).toBe(false);
    expect(meetsPlan('free', 'team')).toBe(false);
    expect(meetsPlan('free', 'enterprise')).toBe(false);
  });

  it('pro meets free and pro', () => {
    expect(meetsPlan('pro', 'free')).toBe(true);
    expect(meetsPlan('pro', 'pro')).toBe(true);
    expect(meetsPlan('pro', 'team')).toBe(false);
    expect(meetsPlan('pro', 'enterprise')).toBe(false);
  });

  it('team meets free, pro, and team', () => {
    expect(meetsPlan('team', 'free')).toBe(true);
    expect(meetsPlan('team', 'pro')).toBe(true);
    expect(meetsPlan('team', 'team')).toBe(true);
    expect(meetsPlan('team', 'enterprise')).toBe(false);
  });

  it('enterprise meets all plans', () => {
    expect(meetsPlan('enterprise', 'free')).toBe(true);
    expect(meetsPlan('enterprise', 'pro')).toBe(true);
    expect(meetsPlan('enterprise', 'team')).toBe(true);
    expect(meetsPlan('enterprise', 'enterprise')).toBe(true);
  });

  it('unknown plan defaults to rank 0 (free)', () => {
    expect(meetsPlan('unknown', 'free')).toBe(true);
    expect(meetsPlan('unknown', 'pro')).toBe(false);
  });
});
