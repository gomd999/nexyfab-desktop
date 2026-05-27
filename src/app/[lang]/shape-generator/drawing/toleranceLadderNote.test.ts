import { describe, it, expect } from 'vitest';
import {
  buildLadderNote,
  tolerance,
  applyLadderToDimensions,
  validateLadder,
  summarize,
  DEFAULT_LADDER,
  type LadderStep,
} from './toleranceLadderNote';

describe('DEFAULT_LADDER', () => {
  it('contains multiple ranges', () => {
    expect(DEFAULT_LADDER.length).toBeGreaterThan(3);
  });
});

describe('buildLadderNote', () => {
  it('default note has prefix + lines', () => {
    const r = buildLadderNote();
    expect(r.text).toContain('UNLESS OTHERWISE SPECIFIED');
    expect(r.lineCount).toBeGreaterThan(DEFAULT_LADDER.length);
  });

  it('custom prefix respected', () => {
    const r = buildLadderNote(DEFAULT_LADDER, { angularDeg: 1, includeRa: false, defaultRaMicron: 3.2, prefixLine: 'CUSTOM PREFIX:' });
    expect(r.text).toContain('CUSTOM PREFIX');
  });

  it('includeRa adds finish line', () => {
    const r = buildLadderNote(DEFAULT_LADDER, { angularDeg: 1, includeRa: true, defaultRaMicron: 1.6 });
    expect(r.text).toContain('Ra 1.6');
  });

  it('lines aligned with consistent indentation', () => {
    const r = buildLadderNote();
    const lines = r.text.split('\n');
    // Most lines start with 4 spaces indent.
    expect(lines.filter(l => l.startsWith('    ')).length).toBeGreaterThan(2);
  });

  it('angular tolerance formatted', () => {
    const r = buildLadderNote(DEFAULT_LADDER, { angularDeg: 0.5, includeRa: false, defaultRaMicron: 3.2 });
    expect(r.text).toContain('±0.5°');
  });
});

describe('tolerance', () => {
  it('5 mm → 0.10', () => {
    expect(tolerance(5)).toBe(0.10);
  });

  it('50 mm → 0.30', () => {
    expect(tolerance(50)).toBe(0.30);
  });

  it('500 mm → 1.00 (above last step)', () => {
    expect(tolerance(500)).toBe(1.00);
  });

  it('absolute value used', () => {
    expect(tolerance(-25)).toBe(0.20);
  });
});

describe('applyLadderToDimensions', () => {
  it('attaches tolerance', () => {
    const dims = [{ id: 'd1', nominalMm: 25 }, { id: 'd2', nominalMm: 100 }];
    const r = applyLadderToDimensions(dims);
    expect(r[0]!.toleranceMm).toBe(0.20);
    expect(r[1]!.toleranceMm).toBe(0.30);
  });
});

describe('validateLadder', () => {
  it('default ladder is valid', () => {
    expect(validateLadder(DEFAULT_LADDER)).toEqual([]);
  });

  it('overlap detected', () => {
    const bad: LadderStep[] = [
      { minMm: 0, maxMm: 30, toleranceMm: 0.1 },
      { minMm: 10, maxMm: 60, toleranceMm: 0.2 },
    ];
    expect(validateLadder(bad).some(i => i.message.includes('overlap'))).toBe(true);
  });

  it('gap detected', () => {
    const bad: LadderStep[] = [
      { minMm: 0, maxMm: 10, toleranceMm: 0.1 },
      { minMm: 30, maxMm: 60, toleranceMm: 0.2 },
    ];
    expect(validateLadder(bad).some(i => i.message.includes('Gap'))).toBe(true);
  });

  it('non-monotone tolerance flagged', () => {
    const bad: LadderStep[] = [
      { minMm: 0, maxMm: 10, toleranceMm: 0.5 },
      { minMm: 10, maxMm: 60, toleranceMm: 0.1 },
    ];
    expect(validateLadder(bad).some(i => i.message.includes('non-monotone'))).toBe(true);
  });

  it('empty ladder flagged', () => {
    expect(validateLadder([])[0]!.message).toContain('Empty');
  });
});

describe('summarize', () => {
  it('reports step count + largest tol', () => {
    const r = buildLadderNote();
    const s = summarize(r, DEFAULT_LADDER);
    expect(s.stepCount).toBe(DEFAULT_LADDER.length);
    expect(s.largestToleranceMm).toBe(1.0);
  });
});
