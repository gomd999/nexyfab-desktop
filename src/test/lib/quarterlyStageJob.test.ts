import { describe, it, expect } from 'vitest';
import { completedCalendarQuarterKeyKst } from '@/lib/quarterly-stage-job';

describe('completedCalendarQuarterKeyKst', () => {
  it('4월 KST → 직전 분기는 올해 Q1', () => {
    const ms = Date.parse('2026-04-01T03:00:00+09:00');
    expect(completedCalendarQuarterKeyKst(ms)).toBe('2026-Q1');
  });

  it('1월 KST → 직전 분기는 전년 Q4', () => {
    const ms = Date.parse('2026-01-05T12:00:00+09:00');
    expect(completedCalendarQuarterKeyKst(ms)).toBe('2025-Q4');
  });

  it('7월 KST → 직전 분기는 올해 Q2', () => {
    const ms = Date.parse('2026-07-10T12:00:00+09:00');
    expect(completedCalendarQuarterKeyKst(ms)).toBe('2026-Q2');
  });
});
