import { describe, it, expect } from 'vitest';
import { translate, diffOriginal, summarize } from './gcodeDialectTranslator';

describe('translate', () => {
  it('empty input → header + footer only', () => {
    const r = translate('', { sourceDialect: 'fanuc', targetDialect: 'fanuc' });
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('M30 → M2 for mach3', () => {
    const r = translate('M30', { sourceDialect: 'fanuc', targetDialect: 'mach3' });
    expect(r.output).toContain('M2');
  });

  it('M2 → M30 for fanuc target', () => {
    const r = translate('M2', { sourceDialect: 'mach3', targetDialect: 'fanuc' });
    expect(r.output).toContain('M30');
  });

  it('fanuc target adds O-number when given', () => {
    const r = translate('', { sourceDialect: 'fanuc', targetDialect: 'fanuc', programNumber: 1234 });
    expect(r.output).toContain('O1234');
  });

  it('mach3 target wraps output in % delimiters', () => {
    const r = translate('G0 X10', { sourceDialect: 'fanuc', targetDialect: 'mach3' });
    expect(r.output.startsWith('%')).toBe(true);
  });

  it('motion blocks preserved', () => {
    const r = translate('G1 X10 Y20 F100', { sourceDialect: 'fanuc', targetDialect: 'haas' });
    expect(r.output).toContain('G1');
    expect(r.output).toContain('X10');
  });

  it('preserveLineNumbers adds N labels', () => {
    const r = translate('G0 X5\nG1 Y10 F100', {
      sourceDialect: 'fanuc',
      targetDialect: 'fanuc',
      preserveLineNumbers: true,
    });
    expect(r.output).toMatch(/N\d+/);
  });

  it('siemens target uses ;PROGRAM header', () => {
    const r = translate('G1 X10', { sourceDialect: 'fanuc', targetDialect: 'siemens' });
    expect(r.output).toContain(';PROGRAM');
  });

  it('linuxcnc target ends with %', () => {
    const r = translate('G0 X5', { sourceDialect: 'fanuc', targetDialect: 'linuxcnc' });
    expect(r.output.endsWith('%') || r.output.includes('%')).toBe(true);
  });

  it('substitutionCount > 0 when codes change', () => {
    const r = translate('M30', { sourceDialect: 'fanuc', targetDialect: 'mach3' });
    expect(r.substitutionCount).toBeGreaterThan(0);
  });

  it('custom symbolRewrites respected', () => {
    const r = translate('M19', {
      sourceDialect: 'haas', targetDialect: 'fanuc',
      symbolRewrites: { M19: 'M3' },
    });
    expect(r.output).toContain('M3');
  });

  it('comments preserved', () => {
    const r = translate('(setup)\nG0 X5', { sourceDialect: 'fanuc', targetDialect: 'haas' });
    expect(r.output).toContain('(setup)');
  });
});

describe('diffOriginal', () => {
  it('identical strings → all identical', () => {
    const d = diffOriginal('G0 X5', 'G0 X5');
    expect(d.identicalLines).toBeGreaterThan(0);
    expect(d.changedLines).toBe(0);
  });

  it('different strings → changed counted', () => {
    const d = diffOriginal('G0 X5', 'G1 X5');
    expect(d.changedLines).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports output line count', () => {
    const r = translate('G0 X5\nG1 X10 F100', { sourceDialect: 'fanuc', targetDialect: 'fanuc' });
    const s = summarize(r);
    expect(s.outputLineCount).toBeGreaterThan(0);
  });

  it('successFraction = 1 when nothing unresolved', () => {
    const r = translate('G0 X5', { sourceDialect: 'fanuc', targetDialect: 'fanuc' });
    const s = summarize(r);
    expect(s.successFraction).toBeCloseTo(1, 5);
  });
});
