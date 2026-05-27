import { describe, it, expect } from 'vitest';
import {
  auditNaming,
  stats,
  summarize,
  DEFAULT_POLICY,
  type FileEntry,
} from './fileNamingCompliance';

function file(id: string, name: string): FileEntry {
  return { id, name };
}

describe('auditNaming with DEFAULT_POLICY', () => {
  it('compliant name → no violation', () => {
    const violations = auditNaming([file('1', 'PRJ-1234-DRG-0042-RV03.step')]);
    expect(violations).toEqual([]);
  });

  it('compliant without rev → no violation (rev is optional)', () => {
    const violations = auditNaming([file('1', 'PRJ-1234-DRG-0042.step')]);
    expect(violations).toEqual([]);
  });

  it('flags pattern mismatch', () => {
    const violations = auditNaming([file('1', 'PART-001.step')]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.issues.some(i => i.kind === 'pattern-mismatch')).toBe(true);
  });

  it('flags lowercase', () => {
    const violations = auditNaming([file('1', 'prj-1234-drg-0042.step')]);
    expect(violations[0]!.issues.some(i => i.kind === 'lowercase')).toBe(true);
  });

  it('flags illegal chars', () => {
    const violations = auditNaming([file('1', 'PRJ 1234 DRG 0042.step')]);
    expect(violations[0]!.issues.some(i => i.kind === 'illegal-chars')).toBe(true);
  });

  it('flags bad extension', () => {
    const violations = auditNaming([file('1', 'PRJ-1234-DRG-0042.exe')]);
    expect(violations[0]!.issues.some(i => i.kind === 'bad-extension')).toBe(true);
  });

  it('flags missing extension', () => {
    const violations = auditNaming([file('1', 'PRJ-1234-DRG-0042')]);
    expect(violations[0]!.issues.some(i => i.kind === 'missing-extension')).toBe(true);
  });

  it('flags too-long names', () => {
    const longName = 'PRJ-1234-DRG-' + '0'.repeat(100) + '.step';
    const violations = auditNaming([file('1', longName)]);
    expect(violations[0]!.issues.some(i => i.kind === 'too-long')).toBe(true);
  });

  it('suggested rename is uppercase + clean', () => {
    const violations = auditNaming([file('1', 'prj 1234 drg 0042.step')]);
    expect(violations[0]!.suggestedRename).toMatch(/^[A-Z0-9_-]+\.(step|stp|iges|igs|dwg|dxf|prt|sldprt|sldasm|pdf)$/);
  });

  it('honours custom policy', () => {
    const customPolicy = { ...DEFAULT_POLICY, pattern: /^XYZ-\d+$/ };
    const violations = auditNaming([file('1', 'XYZ-99.step')], customPolicy);
    expect(violations).toEqual([]);
  });
});

describe('stats', () => {
  it('all compliant → 100%', () => {
    const s = stats([file('1', 'PRJ-1234-DRG-0042.step')]);
    expect(s.complianceRate).toBe(1);
    expect(s.violationCount).toBe(0);
  });

  it('breakdown by issue kind', () => {
    const files = [
      file('1', 'PART-001.exe'),
      file('2', 'prj-1234-drg-0042.step'),
    ];
    const s = stats(files);
    expect(s.byIssueKind['bad-extension']).toBe(1);
    expect(s.byIssueKind['lowercase']).toBe(1);
  });

  it('empty input → 100% compliance', () => {
    expect(stats([]).complianceRate).toBe(1);
  });
});

describe('summarize', () => {
  it('worstFile has most issues', () => {
    const files = [
      file('1', 'prj 1234 drg 0042.exe'), // multi issue
      file('2', 'PRJ-1234-DRG-0042-RV03.step'), // compliant
    ];
    const s = summarize(files);
    expect(s.worstFile).toBe('prj 1234 drg 0042.exe');
  });

  it('totalFiles is the count given', () => {
    const s = summarize([file('1', 'PRJ-1234-DRG-0042.step'), file('2', 'PRJ-1234-DRG-0043.step')]);
    expect(s.totalFiles).toBe(2);
  });

  it('complianceRate is correct ratio', () => {
    const s = summarize([
      file('1', 'PRJ-1234-DRG-0042.step'),
      file('2', 'bad.exe'),
    ]);
    expect(s.complianceRate).toBeCloseTo(0.5, 2);
  });
});
