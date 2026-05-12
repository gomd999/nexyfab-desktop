/**
 * Crash budget classifier (Q9) — pin the thresholds so a future tweak
 * goes through code review.
 */

import { describe, it, expect } from 'vitest';
import { CRASH_BUDGETS, classifyAgainstBudget, rateFor } from '../crashBudget';

describe('CRASH_BUDGETS', () => {
  it('all budgets follow green < yellow < red ordering', () => {
    for (const [key, b] of Object.entries(CRASH_BUDGETS)) {
      expect(b.green).toBeLessThan(b.yellow);
      expect(b.yellow).toBeLessThan(b.red);
      expect(b.windowEvents).toBeGreaterThan(0);
      expect(b.description).toMatch(/.{8,}/); // at least an 8-char description
      void key;
    }
  });

  it('fatal_session red threshold is ≤3% (industry-typical for CAD)', () => {
    const b = CRASH_BUDGETS.fatal_session;
    expect(b.red / b.windowEvents).toBeLessThanOrEqual(0.03);
  });

  it('save_error green threshold is ≤0.5% (data-loss-adjacent)', () => {
    const b = CRASH_BUDGETS.save_error;
    expect(b.green / b.windowEvents).toBeLessThanOrEqual(0.005);
  });
});

describe('classifyAgainstBudget', () => {
  it('zero count → green', () => {
    expect(classifyAgainstBudget('fatal_session', 0)).toBe('green');
  });

  it('exact green threshold → green', () => {
    expect(classifyAgainstBudget('fatal_session', CRASH_BUDGETS.fatal_session.green)).toBe('green');
  });

  it('one above green → yellow', () => {
    expect(classifyAgainstBudget('fatal_session', CRASH_BUDGETS.fatal_session.green + 1)).toBe('yellow');
  });

  it('exact yellow threshold → yellow', () => {
    expect(classifyAgainstBudget('fatal_session', CRASH_BUDGETS.fatal_session.yellow)).toBe('yellow');
  });

  it('one above yellow → red', () => {
    expect(classifyAgainstBudget('fatal_session', CRASH_BUDGETS.fatal_session.yellow + 1)).toBe('red');
  });

  it('massive count → red', () => {
    expect(classifyAgainstBudget('fatal_session', 99999)).toBe('red');
  });
});

describe('rateFor', () => {
  it('returns 0 for zero count', () => {
    expect(rateFor('save_error', 0)).toBe(0);
  });

  it('returns count/window', () => {
    expect(rateFor('save_error', 50)).toBeCloseTo(0.05, 4);
  });
});
