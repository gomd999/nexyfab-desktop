import { describe, it, expect } from 'vitest';
import {
  auditOverrides,
  stripPointless,
  rollupSeverity,
  summarize,
  type DimensionOverride,
} from './dimensionOverrideList';

function dim(id: string, modelNominal: number, partial: Partial<DimensionOverride> = {}): DimensionOverride {
  return { dimensionId: id, modelNominal, ...partial };
}

describe('auditOverrides', () => {
  it('empty → no issues', () => {
    const r = auditOverrides([]);
    expect(r.issues).toEqual([]);
  });

  it('value override matching model → pointless info', () => {
    const r = auditOverrides([dim('d1', 10, { overrideValue: 10 })]);
    expect(r.pointlessCount).toBe(1);
    expect(r.issues[0]!.severity).toBe('info');
  });

  it('value override diverges → critical', () => {
    const r = auditOverrides([dim('d1', 10, { overrideValue: 10.5 })]);
    expect(r.divergenceCount).toBe(1);
    expect(r.issues[0]!.severity).toBe('critical');
  });

  it('text-replacement → warn', () => {
    const r = auditOverrides([dim('d1', 10, { overrideText: 'MATCH DRILLED' })]);
    expect(r.issues[0]!.kind).toBe('text-replacement');
    expect(r.issues[0]!.severity).toBe('warn');
  });

  it('prefix override → info', () => {
    const r = auditOverrides([dim('d1', 10, { overridePrefix: 'Ø' })]);
    expect(r.issues[0]!.kind).toBe('prefix');
    expect(r.issues[0]!.severity).toBe('info');
  });

  it('suffix override → info', () => {
    const r = auditOverrides([dim('d1', 10, { overrideSuffix: ' TYP' })]);
    expect(r.issues[0]!.kind).toBe('suffix');
  });

  it('tolerance override divergent → warn', () => {
    const r = auditOverrides([dim('d1', 10, { overrideTolerancePlus: 0.5, modelTolerancePlus: 0.1, modelToleranceMinus: 0.1 })]);
    expect(r.issues.some(i => i.kind === 'tolerance' && i.severity === 'warn')).toBe(true);
  });

  it('flagPointless=false suppresses pointless flag', () => {
    const r = auditOverrides([dim('d1', 10, { overrideValue: 10 })], { valueToleranceMm: 0.001, flagPointless: false });
    expect(r.pointlessCount).toBe(0);
  });

  it('override count tallies', () => {
    const r = auditOverrides([
      dim('d1', 10, { overrideValue: 11 }),
      dim('d2', 5, { overridePrefix: 'Ø' }),
      dim('d3', 3),
    ]);
    expect(r.overrideCount).toBe(2);
  });
});

describe('stripPointless', () => {
  it('removes matching value override', () => {
    const out = stripPointless([dim('d1', 10, { overrideValue: 10 })]);
    expect(out[0]!.overrideValue).toBeUndefined();
  });

  it('keeps divergent override', () => {
    const out = stripPointless([dim('d1', 10, { overrideValue: 10.5 })]);
    expect(out[0]!.overrideValue).toBe(10.5);
  });
});

describe('rollupSeverity', () => {
  it('counts severities', () => {
    const r = auditOverrides([
      dim('d1', 10, { overrideValue: 10.5 }), // critical
      dim('d2', 5, { overrideText: 'X' }),    // warn
      dim('d3', 3, { overridePrefix: 'Ø' }),  // info
    ]);
    const roll = rollupSeverity(r);
    expect(roll.criticalCount).toBe(1);
    expect(roll.warnCount).toBe(1);
    expect(roll.infoCount).toBe(1);
  });
});

describe('summarize', () => {
  it('reports critical issues', () => {
    const r = auditOverrides([dim('d1', 10, { overrideValue: 10.5 })]);
    const s = summarize(r);
    expect(s.criticalIssues).toBe(1);
  });
});
