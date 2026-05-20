import { describe, it, expect } from 'vitest';
import {
  analyzeLines,
  rollupSeverity,
  suggestFixes,
  summarize,
  DEFAULT_EXPECTATIONS,
  type DrawingLine,
} from './lineWeightBiasDetector';

function line(id: string, type: DrawingLine['type'], weight: number, length: number = 10): DrawingLine {
  return { id, type, weightMm: weight, lengthMm: length };
}

describe('analyzeLines', () => {
  it('empty input → no issues', () => {
    const r = analyzeLines([]);
    expect(r.issues).toEqual([]);
  });

  it('correct weight → no issues', () => {
    const r = analyzeLines([line('l1', 'visible', 0.5)]);
    expect(r.issues).toEqual([]);
  });

  it('outside tolerance → warn', () => {
    const r = analyzeLines([line('l1', 'visible', 0.6)]);
    expect(r.issues[0]!.severity).toBe('warn');
  });

  it('far outside tolerance → critical', () => {
    const r = analyzeLines([line('l1', 'visible', 1.0)]);
    expect(r.issues[0]!.severity).toBe('critical');
  });

  it('counts by type', () => {
    const r = analyzeLines([line('l1', 'visible', 0.5), line('l2', 'hidden', 0.25)]);
    expect(r.countsByType.visible).toBe(1);
    expect(r.countsByType.hidden).toBe(1);
  });

  it('uniform weight flagged', () => {
    const r = analyzeLines([line('l1', 'visible', 0.5), line('l2', 'hidden', 0.5), line('l3', 'leader', 0.5)]);
    expect(r.bias.uniform).toBe(true);
  });

  it('mixed weights → not uniform', () => {
    const r = analyzeLines([line('l1', 'visible', 0.5), line('l2', 'hidden', 0.25)]);
    expect(r.bias.uniform).toBe(false);
  });

  it('dominant weight is weighted by length', () => {
    const r = analyzeLines([line('a', 'visible', 0.5, 100), line('b', 'hidden', 0.25, 10)]);
    expect(r.bias.dominantWeight).toBe(0.5);
  });

  it('cutting-plane requires thick weight', () => {
    const r = analyzeLines([line('cp', 'cutting-plane', 0.25)]);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('rollupSeverity', () => {
  it('counts by severity', () => {
    const r = analyzeLines([line('l1', 'visible', 1.0), line('l2', 'hidden', 0.3)]);
    const roll = rollupSeverity(r);
    expect(roll.critical + roll.warn).toBeGreaterThan(0);
  });
});

describe('suggestFixes', () => {
  it('recommended weight matches expectation', () => {
    const r = analyzeLines([line('l1', 'visible', 1.0)]);
    const fixes = suggestFixes(r);
    expect(fixes[0]!.recommendedWeightMm).toBe(0.5);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const lines = [line('l1', 'visible', 0.5), line('l2', 'hidden', 0.3)];
    const r = analyzeLines(lines);
    const s = summarize(lines, r);
    expect(s.lineCount).toBe(2);
    expect(s.issueCount).toBe(r.issues.length);
  });
});

describe('DEFAULT_EXPECTATIONS', () => {
  it('cutting-plane is thickest', () => {
    const cp = DEFAULT_EXPECTATIONS.find(e => e.type === 'cutting-plane')!;
    expect(cp.expectedMm).toBeGreaterThan(0.5);
  });
});
