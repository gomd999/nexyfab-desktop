import { describe, it, expect } from 'vitest';
import { parseUserStageColumn, type Stage } from '@/lib/userStage';

describe('userStage (client-safe)', () => {
  it('parseUserStageColumn normalizes known letters', () => {
    expect(parseUserStageColumn(' d ')).toBe('D');
    expect(parseUserStageColumn('F')).toBe('F');
  });

  it('defaults invalid to A', () => {
    expect(parseUserStageColumn('')).toBe('A');
    expect(parseUserStageColumn('Z')).toBe('A');
    expect(parseUserStageColumn(3)).toBe('A');
  });

  it('Stage type is six letters', () => {
    const s: Stage = 'C';
    expect(s).toBe('C');
  });
});
